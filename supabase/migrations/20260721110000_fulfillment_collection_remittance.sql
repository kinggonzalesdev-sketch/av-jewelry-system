-- ============================================================================
-- #3 deeper — rider-vs-LBC collection split + collected-vs-remitted (Bible §14,
-- §18.25). Extends Money-in-Transit from one "in transit to collect" figure into
-- an honest picture of WHERE the money is: still to collect (by who carries it —
-- our own rider vs LBC), and already collected but not yet remitted to the shop.
-- ----------------------------------------------------------------------------
-- These are the courier/remittance fields the earlier slice deferred. All still
-- PROVISIONAL (§18.25): the channel list (rider/lbc) and the exact remittance
-- policy are not client-final — a proposed, honestly-recorded set.
--
-- Money stays numeric in SQL; the report casts every sum to a string. Nothing is
-- inferred: a channel and a collected amount are recorded by a person, never
-- guessed from the total.
-- ============================================================================

alter table public.fulfillment_records
  -- Who carries the COD money to collect it. Null until known.
  add column collection_channel text,
  -- Collection: recorded when the money is actually taken from the customer.
  add column collected_at timestamptz,
  add column collected_by uuid references public.staff_profiles (id) on delete restrict,
  -- The real peso amount collected (numeric in SQL). Not the order total — what
  -- was actually handed over. Required exactly when a collection is recorded.
  add column collected_amount numeric(12, 2),
  -- Remittance: recorded when the collected cash reaches the shop/bank.
  add column remitted_at timestamptz,
  add column remitted_by uuid references public.staff_profiles (id) on delete restrict,

  -- The channel vocabulary (provisional).
  add constraint fulfillment_collection_channel_ck check (
    collection_channel is null or collection_channel in ('rider', 'lbc')
  ),
  -- A collection is a coherent fact: who + amount + channel travel together,
  -- and money is only ever collected on a COD order.
  add constraint fulfillment_collected_pairing_ck check (
    (collected_at is null) = (collected_by is null)
  ),
  add constraint fulfillment_collected_amount_ck check (
    (collected_at is null) = (collected_amount is null)
    and (collected_amount is null or collected_amount >= 0)
  ),
  add constraint fulfillment_collected_requires_cod_ck check (
    collected_at is null or is_cod
  ),
  add constraint fulfillment_collected_requires_channel_ck check (
    collected_at is null or collection_channel is not null
  ),
  -- Remittance follows collection: you cannot remit what was never collected,
  -- who-remitted travels with when-remitted, and remittance is never before
  -- collection.
  add constraint fulfillment_remitted_pairing_ck check (
    (remitted_at is null) = (remitted_by is null)
  ),
  add constraint fulfillment_remitted_after_collected_ck check (
    remitted_at is null
    or (collected_at is not null and remitted_at >= collected_at)
  );

comment on column public.fulfillment_records.collection_channel is
  'Provisional (§18.25) — who collects the COD money: our own rider or LBC. Not client-final.';
comment on column public.fulfillment_records.collected_amount is
  'The real peso amount collected on delivery (numeric in SQL). Recorded, never inferred from the order total.';

create index fulfillment_collection_open_idx
  on public.fulfillment_records (collection_channel)
  where is_cod and collected_at is null;

create index fulfillment_collected_unremitted_idx
  on public.fulfillment_records (remitted_at)
  where collected_at is not null and remitted_at is null;

-- ----------------------------------------------------------------------------
-- report_money_in_transit — finer, still all-SQL, still a string per bucket.
-- ----------------------------------------------------------------------------
-- Buckets (each disjoint, so no figure is double-counted):
--   awaiting_verification  — submitted payment evidence not yet verified.
--   customer_pending       — outstanding on orders awaiting their required payment.
--   in_transit_to_collect  — outstanding on COD orders dispatched, NOT yet
--                            collected, not completed. The "still out there" total.
--   rider_to_collect       — the rider-carried part of in_transit_to_collect.
--   lbc_to_collect         — the LBC-carried part of in_transit_to_collect.
--                            (rider + lbc may be < the total when a dispatched
--                            COD order has no channel recorded yet — honest.)
--   collected_unremitted   — cash already collected but not yet remitted to the
--                            shop (the actual amounts collected, summed).
create or replace function public.report_money_in_transit()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'awaiting_verification', coalesce((
      select sum(p.amount)
      from public.payments p
      where p.status = 'submitted_unverified'
        and p.voided_at is null
        and p.reversed_at is null
    ), 0)::text,
    'customer_pending', coalesce((
      select sum(app_private.outstanding_balance(o.id))
      from public.official_orders o
      where o.status = 'awaiting_required_payment'
    ), 0)::text,
    'in_transit_to_collect', coalesce((
      select sum(app_private.outstanding_balance(o.id))
      from public.official_orders o
      join public.fulfillment_records f on f.official_order_id = o.id
      where f.is_cod = true
        and f.dispatched_at is not null
        and f.completed_at is null
        and f.collected_at is null
        and o.status not in ('completed', 'cancelled')
    ), 0)::text,
    'rider_to_collect', coalesce((
      select sum(app_private.outstanding_balance(o.id))
      from public.official_orders o
      join public.fulfillment_records f on f.official_order_id = o.id
      where f.is_cod = true
        and f.dispatched_at is not null
        and f.completed_at is null
        and f.collected_at is null
        and f.collection_channel = 'rider'
        and o.status not in ('completed', 'cancelled')
    ), 0)::text,
    'lbc_to_collect', coalesce((
      select sum(app_private.outstanding_balance(o.id))
      from public.official_orders o
      join public.fulfillment_records f on f.official_order_id = o.id
      where f.is_cod = true
        and f.dispatched_at is not null
        and f.completed_at is null
        and f.collected_at is null
        and f.collection_channel = 'lbc'
        and o.status not in ('completed', 'cancelled')
    ), 0)::text,
    'collected_unremitted', coalesce((
      select sum(f.collected_amount)
      from public.fulfillment_records f
      where f.collected_at is not null
        and f.remitted_at is null
    ), 0)::text
  );
$$;

comment on function public.report_money_in_transit() is
  'Money-in-Transit aggregation (Bible §14 solution G). Rider-vs-LBC to-collect split + collected-but-not-remitted. All sums numeric in SQL, each bucket a string. security invoker: RLS scopes what the caller may read.';

revoke all on function public.report_money_in_transit() from public;
grant execute on function public.report_money_in_transit() to authenticated;

insert into app_private.provisional_fields (table_name, column_name, bible_reference, note) values
  ('fulfillment_records', 'collection_channel', '§18.25',
   'Proposed collection-channel vocabulary (rider/lbc). Not client-final — awaiting confirmation before pilot.'),
  ('fulfillment_records', 'collected_amount', '§18.25',
   'Collection/remittance model is provisional. Amount is recorded on delivery; exact reconciliation with recorded payments is a later slice.')
on conflict (table_name, column_name) do nothing;
