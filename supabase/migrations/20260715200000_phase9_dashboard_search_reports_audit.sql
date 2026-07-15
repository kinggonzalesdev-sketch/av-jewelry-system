-- ============================================================================
-- Phase 9 — Dashboard, Search, Reports, Notifications & Audit Surfacing
-- (Bible §7, §23, §25, §26, §31)
-- ----------------------------------------------------------------------------
-- This phase READS. It creates no business records and changes no state.
--
-- THE RULE THAT SHAPES EVERYTHING HERE — COUNTS ARE NON-ADDITIVE (§7, §4):
--
--   An Active Layaway IS ALREADY an Official Order. A Claim is NOT an order.
--   Adding a "Layaway" tile to an "Orders" tile double-counts the same money,
--   and a dashboard that overstates revenue is a bug you discover from a wrong
--   number in a report, not from a crash.
--
--   So the tiles below are DISJOINT BY CONSTRUCTION: every Official Order falls
--   into exactly one bucket, and a test proves the buckets sum to the total.
--
-- Other invariants: report visibility != action authority · notifications change
-- no records · export is limited to what the caller can already see.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Dashboard counts (§7).
--
-- Deliberately returns DISJOINT buckets plus the total, so a caller cannot
-- accidentally add overlapping tiles. The `total_official_orders` is returned
-- alongside precisely so the sum can be asserted against it.
--
-- security invoker: RLS applies, so a caller counts only what they may see.
-- ----------------------------------------------------------------------------
create or replace function public.dashboard_counts()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with orders as (
    select
      o.id,
      o.status,
      -- An Active Layaway is an attribute OF this order, not a separate order.
      exists (
        select 1 from public.layaway_arrangements l
        where l.official_order_id = o.id
          and l.status in ('active', 'overdue', 'grace_period', 'forfeiture_eligible')
      ) as is_active_layaway
    from public.official_orders o
  )
  select jsonb_build_object(
    -- ---- DISJOINT Official Order buckets. Every order lands in exactly one. --
    'orders_active_layaway', (
      select count(*) from orders where is_active_layaway and status <> 'cancelled'
    ),
    'orders_awaiting_payment', (
      select count(*) from orders
      where not is_active_layaway and status in ('invoiced', 'awaiting_required_payment')
    ),
    'orders_for_fulfillment', (
      select count(*) from orders
      where not is_active_layaway
        and status in ('required_payment_verified', 'for_preparation',
                       'for_shipping_or_pickup', 'approved_for_release',
                       'exceptional_release_pending')
    ),
    'orders_closed', (
      select count(*) from orders
      where not is_active_layaway
        and status in ('dispatched_or_picked_up', 'completed', 'expired_overdue')
    ),
    'orders_cancelled', (
      select count(*) from orders where not is_active_layaway and status = 'cancelled'
    ),
    'total_official_orders', (select count(*) from orders),

    -- ---- Claims are NOT orders (§4). Counted separately, never added in. ----
    'pending_claims', (
      select count(*) from public.claims where status = 'pending_claim'
    ),
    'confirmed_claims_for_invoice', (
      select count(*) from public.claims c
      where c.status = 'confirmed_claim'
        and not exists (
          select 1 from public.official_order_claims ooc where ooc.claim_id = c.id
        )
    ),

    -- ---- Work queues. Advisory counts; they overlap the buckets above and
    -- ---- are labelled as queues precisely so nobody sums them with orders.
    'payments_awaiting_verification', (
      select count(*) from public.payments where status = 'submitted_unverified'
    ),
    'rts_in_review', (
      select count(*) from public.returned_to_stock_reviews where status = 'in_review'
    ),
    'owner_approvals_pending', (
      select count(*) from public.owner_approval_requests
      where status = 'pending_owner_approval'
    )
  );
$$;

comment on function public.dashboard_counts() is
  'Bible §7/§4: DISJOINT Official Order buckets — an Active Layaway is already an Official Order and is never counted twice. Claims are not orders and are counted separately. Queue counts are advisory and must not be summed with the order buckets.';

revoke all on function public.dashboard_counts() from anon;
grant execute on function public.dashboard_counts() to authenticated;

-- ----------------------------------------------------------------------------
-- Global search (§23).
--
-- PERMISSION-SCOPED: security invoker means RLS filters every underlying table,
-- so a caller can only ever find what they were already allowed to read. This
-- function adds no privilege of its own.
--
-- It RETURNS REFERENCES ONLY — never a merge, never a reassignment, and no
-- action. Finding a record is not authority over it (§25: report visibility is
-- not action authority).
-- ----------------------------------------------------------------------------
create or replace function public.global_search(p_query text)
returns table (
  result_kind text,
  entity_id uuid,
  reference text,
  label text,
  detail text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (select '%' || trim(p_query) || '%' as pattern)
  select 'claim', c.id, c.claim_reference, cu.display_name,
         c.status
  from public.claims c
  join public.customers cu on cu.id = c.customer_id
  cross join q
  where length(trim(p_query)) >= 2
    and (c.claim_reference ilike q.pattern or cu.display_name ilike q.pattern)

  union all
  select 'official_order', o.id, o.order_number, cu.display_name, o.status
  from public.official_orders o
  join public.customers cu on cu.id = o.customer_id
  cross join q
  where length(trim(p_query)) >= 2
    and (o.order_number ilike q.pattern
      or o.invoice_number ilike q.pattern
      or cu.display_name ilike q.pattern)

  union all
  select 'customer', cu.id, cu.display_name, cu.display_name,
         coalesce(cu.contact_number, '')
  from public.customers cu
  cross join q
  where length(trim(p_query)) >= 2 and cu.display_name ilike q.pattern

  union all
  select 'inventory_item', i.id, i.item_code, coalesce(i.item_name, i.item_code),
         i.availability_status
  from public.inventory_items i
  cross join q
  where length(trim(p_query)) >= 2
    and (i.item_code ilike q.pattern or i.item_name ilike q.pattern)

  limit 50;
$$;

comment on function public.global_search(text) is
  'Bible §23/§25: permission-scoped search. security invoker means RLS filters every table, so a caller finds only what they may already read. Returns references only — finding a record is not authority over it, and nothing here merges or reassigns.';

revoke all on function public.global_search(text) from anon;
grant execute on function public.global_search(text) to authenticated;

-- ----------------------------------------------------------------------------
-- Notifications are STAFF-FACING and change NO records (§26, §18.20).
--
-- Customers hold no account and are never notified through this. A reminder is
-- a note to a staff member; acknowledging it changes nothing but the note.
--
-- RLS is NOT redefined here: Phase 2 already scopes notifications to their own
-- staff member (notifications_read_self / _insert / _update_self). Re-creating
-- those policies would be duplication, and a second definition is a second
-- thing to drift. Phase 9 adds only the rule Phase 2 lacked — that the note
-- itself is immutable.
-- ----------------------------------------------------------------------------

/**
 * A notification may only ever be acknowledged.
 *
 * Its body, target, and kind are frozen once written: a reminder that can be
 * rewritten after the fact is not a record of anything.
 */
create or replace function app_private.enforce_notification_is_a_note()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind
     or new.entity_type is distinct from old.entity_type
     or new.entity_id is distinct from old.entity_id
     or new.body is distinct from old.body
     or new.due_at is distinct from old.due_at then
    raise exception
      'A notification is a note: only acknowledgement may change (Bible §26). Its body and target are frozen.'
      using errcode = 'check_violation';
  end if;

  if new.acknowledged_at is not null and new.acknowledged_by is null then
    raise exception 'Acknowledging a notification must record who acknowledged it.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function app_private.enforce_notification_is_a_note() is
  'Bible §26: a notification changes no business record, and only its acknowledgement may change. Sent is not Delivered and is not Read — none of which this table claims.';

create trigger notifications_only_acknowledge
  before update on public.notifications
  for each row execute function app_private.enforce_notification_is_a_note();

-- ⚠️  There is deliberately NO delivered_at and NO read_at column here, and none
--     may be added: no delivery channel exists to observe either (§26). Sent is
--     an attestation, Delivered and Read are unobserved.

-- ----------------------------------------------------------------------------
-- Reports (§25). Export is gated by the Export Data / Reports permission.
--
-- security invoker keeps the report inside the caller's RLS scope, so an export
-- can never contain a row the caller could not already read.
-- ----------------------------------------------------------------------------
create or replace function public.report_sales_summary(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  -- Report VISIBILITY is not action authority, but EXPORT is its own permission
  -- (§25). Reading a summary on screen is not the same as taking the data away.
  if not app_private.has_permission('export_data_reports') then
    raise exception
      'Not authorized: reports require the export_data_reports permission.'
      using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    -- Verified money only. Unverified evidence is not revenue.
    'verified_collected', coalesce(sum(
      case when p.status = 'verified'
            and p.voided_at is null
            and p.reversed_at is null
            and p.correction_pending = false
      then coalesce(v.verified_amount, p.amount) else 0 end
    ), 0),
    'payments_recorded', count(*),
    'payments_verified', count(*) filter (where p.status = 'verified'),
    'payments_unverified', count(*) filter (where p.status = 'submitted_unverified')
  )
  into v_result
  from public.payments p
  left join public.payment_verifications v on v.payment_id = p.id
  where p.recorded_at >= p_from and p.recorded_at <= p_to;

  return v_result;
end;
$$;

comment on function public.report_sales_summary(timestamptz, timestamptz) is
  'Bible §25: export is gated by export_data_reports. security invoker keeps the report within the caller''s RLS scope, so it can never contain a row they could not already read. Verified money only — unverified evidence is not revenue.';

revoke all on function public.report_sales_summary(timestamptz, timestamptz) from anon;
grant execute on function public.report_sales_summary(timestamptz, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- Provisional records (§25.16, §31.30) — the roadmap marks these
-- "non-blocking to start", so a proposed set is used and recorded rather than
-- silently settled.
-- ----------------------------------------------------------------------------
insert into app_private.provisional_fields (table_name, column_name, bible_reference, note) values
  ('official_orders', 'status', '§25.16',
   'Dashboard KPI set and the date basis for reports are not client-final. The order buckets are DISJOINT by construction; the grouping is proposed.'),
  ('audit_events', 'action', '§31.30',
   'Audit taxonomy and retention are not client-final. Actions are namespaced (entity.verb) as a proposed convention.'),
  ('notifications', 'kind', '§26',
   'Reminder kinds (Day 1/2/3, layaway due/grace) are a proposed set. Delivery is manual-send only: no channel exists to observe Delivered or Read.');
