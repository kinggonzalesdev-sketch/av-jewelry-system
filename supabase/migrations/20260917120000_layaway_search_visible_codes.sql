-- ============================================================================
-- Layaway search: every VISIBLE Unique Code is searchable (Owner 2026-09-17). NOT APPLIED YET.
-- Apply AFTER 20260916130000 (it redefines layaway_page as last written by 20260913130000).
--
-- THE BUG. Searching the Unique Code shown on a Layaway row, e.g. `SBA-N-7695 3.10g' 16"` for DAN
-- OLLUGRAC, returned "0 total" while the customer name found the row. layaway_page matched the
-- Unique Code ONLY as inventory_items.item_code joined through layaway_ledger.inventory_item_id.
-- That link is:
--   • NULL for every layaway created from an order — create_layaway_from_order inserts
--     inventory_item_id = null (20260801140000) and records the ledger on the ORDER instead
--     (official_orders.converted_layaway_ledger_id). The table shows the code anyway, resolved
--     from the converted order's claimed item (src/lib/payments/layaway-ledger.ts
--     resolveLedgerOrderCodes), so the row showed a code that search could never see;
--   • only the FIRST item of a multi-item New Entry account (create_layaway_account stores
--     v_first_iid); the other items live in layaway_ledger_items and were never searched.
-- Secondary: the match was a raw `ilike` substring. A code stored with a curly quote (’ ″) or a
-- doubled space could not be found by the text the user reads and types.
--
-- THE FIX (search predicate only — sections, due rules, financer filter, date filters, ordering,
-- totals, section counts, summary and financer options are verbatim from 20260913130000):
--   1. Unique Code is matched against EVERY code the row can display: the ledger's linked item,
--      each layaway_ledger_items row (its linked item's CURRENT code, else its stored code), and
--      the items claimed on the order the layaway was converted from; for order-derived
--      arrangements, the items claimed on their order. Codes are joined with a control-character
--      separator so a search can never match ACROSS two codes.
--   2. Both sides go through app_private.layaway_search_norm(): lower case, curly quotes and
--      primes → straight quotes, non-breaking space → space, runs of whitespace → one space,
--      trimmed. Digits and letters are never altered, so "7695" cannot match "7696".
--   3. The user's text is LIKE-escaped (% _ \ are literal), and each field is matched on its own.
--   4. Approved, user-visible fields only: Unique Code, Layaway Code, Account No. (ledger
--      accounts; shown in the row tooltip and the payment/transfer dialogs), Customer Name,
--      Remarks / Financer. Never an id, a UUID, the retired Order Number or Invoice Number, a
--      payment id, or an audit id. Amounts and dates are not text-searched; the page has date
--      filters for those.
-- The code lookups run only when a search term is present (their CTEs are filtered on it), each
-- as ONE pass over a small table joined through existing primary-key / foreign-key indexes. No new
-- index: none is justified without a production query plan, which could not be taken here.
-- The normalizer is deliberately NOT pinned with SET search_path: a SQL function with a SET clause
-- is never inlined, and this repo measured about 30us per non-inlined call (20260820170000). It uses
-- only pg_catalog built-ins, so the pin would add no safety. The migration also refuses to apply when
-- official_orders.converted_layaway_ledger_id is missing, so a schema mismatch fails at apply time
-- instead of breaking every Layaway search at runtime.
-- Rollback: re-run the layaway_page definition from 20260913130000 and
--           drop function app_private.layaway_search_norm(text);
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'official_orders'
      and column_name = 'converted_layaway_ledger_id'
  ) then
    raise exception 'official_orders.converted_layaway_ledger_id is missing; layaway_page would break. Not applied.';
  end if;
end $$;

create or replace function app_private.layaway_search_norm(p_text text)
returns text
language sql
immutable
parallel safe
as $$
  -- MUST stay 1:1 with layawaySearchNorm() in src/lib/payments/layaway-search.ts.
  -- chr(8220) “  chr(8221) ”  chr(8243) ″  → "      chr(8216) ‘  chr(8217) ’  chr(8242) ′ → '
  -- chr(160) non-breaking space → space
  select btrim(regexp_replace(
    lower(translate(
      coalesce(p_text, ''),
      chr(8220) || chr(8221) || chr(8243) || chr(8216) || chr(8217) || chr(8242) || chr(160),
      '"""' || chr(39) || chr(39) || chr(39) || ' '
    )),
    '\s+', ' ', 'g'
  ));
$$;

comment on function app_private.layaway_search_norm(text) is
  'Layaway search normalization (audit 2026-09-17): case, curly quotes/primes, NBSP and repeated spaces. Mirrors layawaySearchNorm() in src/lib/payments/layaway-search.ts.';

revoke all on function app_private.layaway_search_norm(text) from public, anon;

create or replace function public.layaway_page(
  p_search text default ''::text,
  p_section text default 'all'::text,
  p_financer text default ''::text,
  p_date_from text default ''::text,
  p_date_to text default ''::text,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_result jsonb;
  v_today  date := (now() at time zone 'Asia/Manila')::date;
  -- The normalized search term: control characters become spaces FIRST (so a pasted tab collapses
  -- like any space and the term can never contain the code
  -- separator), and its LIKE pattern with % _ \ escaped so they match literally.
  v_needle text := app_private.layaway_search_norm(regexp_replace(coalesce(p_search, ''), '[[:cntrl:]]', ' ', 'g'));
  v_like   text;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;

  v_like := '%' || replace(replace(replace(v_needle, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  with item_codes as (
    -- Multi-item accounts: each item's code exactly as the table shows it: the linked item's
    -- CURRENT code, else the code stored on the item row.
    select li.ledger_id,
           string_agg(coalesce(ii.item_code, li.item_code), chr(1)) as codes
    from public.layaway_ledger_items li
    left join public.inventory_items ii on ii.id = li.inventory_item_id
    where v_needle <> ''
    group by li.ledger_id
  ),
  order_codes as (
    -- Layaways created from an order: the ledger has no item link; the items are the ones
    -- claimed on the order it was converted from (the same codes the table displays).
    select o.converted_layaway_ledger_id as ledger_id,
           string_agg(ii.item_code, chr(1)) as codes
    from public.official_orders o
    join public.official_order_claims ooc on ooc.official_order_id = o.id
    join public.claims c on c.id = ooc.claim_id
    join public.inventory_items ii on ii.id = c.inventory_item_id
    where v_needle <> ''
      and o.converted_layaway_ledger_id is not null
    group by o.converted_layaway_ledger_id
  ),
  arrangement_codes as (
    -- Order-derived arrangements: the items claimed on their order.
    select ooc.official_order_id,
           string_agg(ii.item_code, chr(1)) as codes
    from public.official_order_claims ooc
    join public.claims c on c.id = ooc.claim_id
    join public.inventory_items ii on ii.id = c.inventory_item_id
    where v_needle <> ''
      and ooc.official_order_id in (select a.official_order_id from public.layaway_arrangements a)
    group by ooc.official_order_id
  ),
  acct as (
    select
      'l'::text as source,
      l.id,
      lower(btrim(l.status)) as nstatus,
      l.customer_name,
      l.account_no,
      l.layaway_code,
      l.remarks,
      null::text as financer_name,
      concat_ws(chr(1), inv.item_code, ic.codes, oc.codes) as search_codes,
      l.date_purchased as purchase_date,
      l.created_at,
      coalesce(l.item_amount,0)  as item_amt,
      coalesce(l.interest,0)     as interest_amt,
      coalesce(l.grand_total,0)  as grand_amt,
      coalesce(l.payment,0)      as paid_amt,
      coalesce(l.balance,0)      as balance_amt
    from public.layaway_ledger l
    left join public.inventory_items inv on inv.id = l.inventory_item_id
    left join item_codes ic on ic.ledger_id = l.id
    left join order_codes oc on oc.ledger_id = l.id
    where lower(btrim(l.status)) <> 'needs_review'
      and l.status <> 'transferred'

    union all

    select
      'a'::text as source,
      a.id,
      lower(btrim(a.status)) as nstatus,
      coalesce(cust.display_name,'Unknown') as customer_name,
      '—'::text as account_no,   -- never the retired order number
      a.layaway_code,
      a.remarks,
      fin.name as financer_name,
      ac.codes as search_codes,
      a.started_at::date as purchase_date,
      a.created_at,
      coalesce(public.order_item_total(a.official_order_id),0) as item_amt,
      coalesce(a.layaway_fee,0) as interest_amt,
      coalesce((ob.j->>'total_amount_payable')::numeric,0) as grand_amt,
      coalesce((ob.j->>'verified_net_payments')::numeric,0) as paid_amt,
      coalesce((ob.j->>'outstanding_balance')::numeric,0)   as balance_amt
    from public.layaway_arrangements a
    left join public.official_orders o on o.id = a.official_order_id
    left join public.customers cust on cust.id = o.customer_id
    left join public.financers fin on fin.id = a.financer_id
    left join arrangement_codes ac on ac.official_order_id = a.official_order_id
    left join lateral (select public.order_balance(a.official_order_id) as j) ob on true
  ),
  flagged as (
    select acct.*,
      public.layaway_is_overdue(nstatus, balance_amt, purchase_date, v_today) as is_overdue,
      btrim(coalesce(financer_name, remarks, '')) as financer_of
    from acct
  ),
  searched as (
    select * from flagged
    where (v_needle = ''
       -- CANONICAL LAYAWAY SEARCH ALLOWLIST — mirrored by LAYAWAY_SEARCH_FIELDS in
       -- src/lib/payments/layaway-search.ts. Each field is matched on its own.
       or app_private.layaway_search_norm(search_codes)  like v_like escape '\'   -- Unique Code
       or app_private.layaway_search_norm(layaway_code)  like v_like escape '\'   -- Code
       or (source = 'l'
           and app_private.layaway_search_norm(account_no) like v_like escape '\') -- Account No.
       or app_private.layaway_search_norm(customer_name) like v_like escape '\'   -- Customer Name
       or app_private.layaway_search_norm(financer_name) like v_like escape '\'   -- Financer
       or app_private.layaway_search_norm(remarks)       like v_like escape '\')  -- Remarks
      and (p_date_from = '' or created_at::date >= p_date_from::date)
      and (p_date_to   = '' or created_at::date <= p_date_to::date)
      and (
        p_financer = '' or p_financer = '__all__'
        or (p_financer = '__none__' and financer_of = '')
        or (p_financer not in ('__all__','__none__')
            and lower(regexp_replace(financer_of, '\s+', ' ', 'g')) = p_financer)
      )
  ),
  filtered as (
    select * from searched
    where case
      when p_section = 'near_overdue' then
        source = 'l'
        and nstatus = 'active'
        and balance_amt > 0
        and public.layaway_overdue_date(purchase_date) between v_today + 1 and v_today + 30
      else public.layaway_matches_section(nstatus, balance_amt, paid_amt, grand_amt,
                                          purchase_date, p_section, v_today)
    end
  ),
  page_ids as (
    select source, id,
           row_number() over (order by created_at desc nulls last, id desc) as ord
    from filtered
    order by created_at desc nulls last, id desc
    limit greatest(coalesce(p_limit,25),0) offset greatest(coalesce(p_offset,0),0)
  )
  select jsonb_build_object(
    'ids', coalesce(
      (select jsonb_agg(jsonb_build_object('s', source, 'id', id) order by ord) from page_ids),
      '[]'::jsonb),
    'total', (select count(*) from filtered),
    'sectionCounts', (
      select jsonb_build_object(
        'all',          count(*),
        'active',       count(*) filter (where nstatus not in ('completed','forfeited','cancelled') and not is_overdue),
        'overdue',      count(*) filter (where is_overdue),
        'forfeited',    count(*) filter (where nstatus = 'forfeited'),
        'completed',    count(*) filter (where nstatus = 'completed' and balance_amt <= 0 and paid_amt >= grand_amt),
        -- SAME predicate as the near_overdue section above and as layaway_near_overdue_count().
        'near_overdue', count(*) filter (where source = 'l' and nstatus = 'active' and balance_amt > 0
                                           and public.layaway_overdue_date(purchase_date)
                                               between v_today + 1 and v_today + 30)
      ) from searched
    ),
    'summary', (
      select jsonb_build_object(
        'qty',        count(*),
        'interest',   to_char(coalesce(sum(interest_amt),0), 'FM99999999999990.00'),
        'grandTotal', to_char(coalesce(sum(grand_amt),0),    'FM99999999999990.00'),
        'payment',    to_char(coalesce(sum(paid_amt),0),     'FM99999999999990.00'),
        'balance',    to_char(coalesce(sum(balance_amt),0),  'FM99999999999990.00')
      ) from filtered
    ),
    'financerOptions', (
      select coalesce(jsonb_agg(distinct financer_of), '[]'::jsonb)
      from flagged where financer_of <> ''
    )
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.layaway_page(text, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.layaway_page(text, text, text, text, text, integer, integer) to authenticated, service_role;
