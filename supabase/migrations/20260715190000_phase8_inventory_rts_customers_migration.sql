-- ============================================================================
-- Phase 8 — Inventory Ops, Returned-to-Stock, Customers & Migration
-- (Bible §19, §10, §6.20, §8.10)
-- ----------------------------------------------------------------------------
-- Phase 1 already owns returned_to_stock_reviews, migration_batches,
-- customer_aliases, and customer_duplicate_references.
--
-- Phase 8 adds the guards that make the invariants STRUCTURAL:
--   1. stock returns to available ONLY through an approved RTS review
--   2. a forfeited item is EXCLUDED from automatic return
--   3. customers are NEVER auto-merged
--   4. migration preserves its source and never fabricates a claim
--
-- NOT here: no automatic transfer, no automatic allocation, no automatic
-- return, no auto-merge.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- RTS review outcome plumbing. PROVISIONAL (§19.26): RTS outcome authority,
-- freed-unit / waitlist selection authority, and unsold / forfeited-item
-- disposition are not client-final. The roadmap marks them "before production",
-- not blocking, so the structure exists and the policy stays open.
-- ----------------------------------------------------------------------------
alter table public.returned_to_stock_reviews
  -- What the approved return DID with the freed unit. Never automatic: the
  -- reviewer records the decision, the system does not infer it (§19.26).
  add column freed_unit_outcome text
    check (freed_unit_outcome is null or freed_unit_outcome in (
      'returned_to_available',
      'offered_to_second_miner_for_review',
      'sent_to_waitlist_for_review',
      'held_unavailable'
    )),
  add column freed_unit_note text;

comment on column public.returned_to_stock_reviews.freed_unit_outcome is
  'What happened to the freed unit. "offered_to_second_miner_for_review" and "sent_to_waitlist_for_review" are REVIEWS, not allocations — nothing is auto-assigned (Bible §19). Provisional authority (§19.26).';

-- A decided review records who decided and when (Bible §31).
alter table public.returned_to_stock_reviews
  add constraint rts_decided_attribution_ck check (
    status = 'in_review'
    or (reviewed_at is not null and reviewed_by is not null)
  );

-- ----------------------------------------------------------------------------
-- THE RETURN RULE (Bible §19, §22.3).
--
-- Availability returns to stock ONLY through an APPROVED Returned-to-Stock
-- Review. Phase 1 already forbids reinstating a released reservation; this
-- closes the other door: an item cannot simply be flipped back to 'available'.
--
-- A forfeited item is EXCLUDED from automatic return entirely — its disposition
-- is a separate, unresolved business decision (§19.26), so it may only be held.
-- ----------------------------------------------------------------------------
create or replace function app_private.enforce_return_to_available()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_approved integer;
  v_forfeited integer;
begin
  -- Only guard the transition back INTO an available state.
  if new.availability_status not in ('available', 'returned_to_available')
     or old.availability_status = new.availability_status then
    return new;
  end if;

  -- A brand-new item legitimately starts available; that is an INSERT, not this.
  if old.availability_status = 'held_unavailable'
     or old.availability_status in ('provisionally_reserved', 'committed',
                                    'sold_released', 'in_returned_to_stock_review') then

    -- Was this item forfeited? A forfeited item never auto-returns (§19).
    select count(*)::int into v_forfeited
    from public.layaway_arrangements l
    join public.official_orders o on o.id = l.official_order_id
    join public.official_order_claims ooc on ooc.official_order_id = o.id
    join public.claims c on c.id = ooc.claim_id
    where c.inventory_item_id = new.id
      and l.status = 'forfeited';

    if v_forfeited > 0 then
      raise exception
        'That item was forfeited. A forfeited item is excluded from automatic stock return — its disposition is a separate decision (Bible §19).'
        using errcode = 'check_violation';
    end if;

    select count(*)::int into v_approved
    from public.returned_to_stock_reviews r
    where r.inventory_item_id = new.id
      and r.status = 'approved_return';

    if v_approved = 0 then
      raise exception
        'Stock returns to available ONLY through an approved Returned-to-Stock Review (Bible §19, §22.3). No review has approved this item.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function app_private.enforce_return_to_available() is
  'Bible §19/§22.3: availability returns only via an APPROVED Returned-to-Stock Review. A forfeited item is excluded from automatic return.';

create trigger inventory_items_enforce_return
  before update on public.inventory_items
  for each row execute function app_private.enforce_return_to_available();

-- ----------------------------------------------------------------------------
-- An RTS review DECIDES; it does not allocate (Bible §19).
--
-- "Offer to the 2nd miner" and "send to the waitlist" are REVIEWS. Nothing here
-- assigns the unit to anybody — automatic promotion and automatic allocation
-- are exactly what the Bible forbids.
-- ----------------------------------------------------------------------------
create or replace function app_private.enforce_rts_review_is_manual()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status <> 'in_review' and old.status = 'in_review' then
    if new.freed_unit_outcome is null then
      raise exception
        'A decided Returned-to-Stock Review must record what happened to the freed unit. Nothing is inferred (Bible §19).'
        using errcode = 'check_violation';
    end if;

    -- Rejecting holds the unit. It cannot quietly return to available.
    if new.status = 'rejected_held'
       and new.freed_unit_outcome <> 'held_unavailable' then
      raise exception
        'A rejected review holds the unit. It cannot return to available (Bible §19).'
        using errcode = 'check_violation';
    end if;
  end if;

  -- A decision is final: re-deciding would let a rejection become an approval.
  if old.status <> 'in_review' and new.status is distinct from old.status then
    raise exception
      'That Returned-to-Stock Review was already decided as %. A decision is final.',
      old.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function app_private.enforce_rts_review_is_manual() is
  'Bible §19: an RTS review decides and records; it never auto-promotes a 2nd miner or auto-allocates from the waitlist. A rejected review holds the unit.';

create trigger rts_enforce_manual_review
  before update on public.returned_to_stock_reviews
  for each row execute function app_private.enforce_rts_review_is_manual();

-- ----------------------------------------------------------------------------
-- NO AUTOMATIC CUSTOMER MERGE (Bible §22.15, §10).
--
-- Reviewing a possible duplicate records a JUDGEMENT. Even concluding
-- "reviewed_duplicate" merges nothing: the merge mechanics are deferred, and a
-- silent merge would rewrite whose order is whose.
-- ----------------------------------------------------------------------------
create or replace function app_private.enforce_no_auto_customer_merge()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status <> 'open' and old.status = 'open' then
    if new.reviewed_by is null or new.reviewed_at is null then
      raise exception
        'A duplicate review must record who reviewed it and when (Bible §31).'
        using errcode = 'check_violation';
    end if;
  end if;

  -- A decided reference is final.
  if old.status <> 'open' and new.status is distinct from old.status then
    raise exception 'That duplicate reference was already reviewed as %.', old.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function app_private.enforce_no_auto_customer_merge() is
  'Bible §22.15: recording a duplicate judgement merges NOTHING. Merge mechanics are deferred; a silent merge would rewrite whose order is whose.';

create trigger customer_dupes_no_auto_merge
  before update on public.customer_duplicate_references
  for each row execute function app_private.enforce_no_auto_customer_merge();

-- ----------------------------------------------------------------------------
-- MIGRATION PRESERVES ITS SOURCE (Bible §22.16, §12.3).
--
-- A migrated record must carry its batch, and a native record must not pretend
-- to be migrated. Migration stays SEPARATE from live intake — Phase 3 already
-- guarantees a migrated claim cannot wear a capture source marker.
-- ----------------------------------------------------------------------------
alter table public.claims
  add constraint claims_migration_provenance_ck check (
    (source_kind = 'migrated') = (migration_batch_id is not null)
  );

alter table public.inventory_items
  add constraint inventory_items_migration_provenance_ck check (
    (source_kind = 'migrated') = (migration_batch_id is not null)
  );

alter table public.customers
  add constraint customers_migration_provenance_ck check (
    (source_kind = 'migrated') = (migration_batch_id is not null)
  );

-- A migration batch records WHO imported it (Bible §31) once it is finished.
alter table public.migration_batches
  add constraint migration_batches_attribution_ck check (
    status = 'in_progress' or imported_by is not null
  );

comment on constraint claims_migration_provenance_ck on public.claims is
  'Bible §22.16: a migrated record carries its batch, and a native record cannot pretend to be migrated. Provenance survives.';

-- ----------------------------------------------------------------------------
-- Inventory monitoring view (Bible §20.3): available vs remaining.
--
-- Available is DERIVED from reservations — never a stored counter, because a
-- stored counter drifts and drift here means double-selling.
-- ----------------------------------------------------------------------------
create or replace function public.inventory_monitor()
returns table (
  inventory_item_id uuid,
  item_code text,
  item_name text,
  availability_status text,
  quantity_total integer,
  available_quantity integer,
  reserved_quantity integer,
  in_rts_review boolean,
  is_forfeited boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    i.id,
    i.item_code,
    i.item_name,
    i.availability_status,
    i.quantity_total,
    app_private.available_quantity(i.id),
    i.quantity_total - app_private.available_quantity(i.id),
    exists (
      select 1 from public.returned_to_stock_reviews r
      where r.inventory_item_id = i.id and r.status = 'in_review'
    ),
    exists (
      select 1
      from public.layaway_arrangements l
      join public.official_orders o on o.id = l.official_order_id
      join public.official_order_claims ooc on ooc.official_order_id = o.id
      join public.claims c on c.id = ooc.claim_id
      where c.inventory_item_id = i.id and l.status = 'forfeited'
    )
  from public.inventory_items i;
$$;

comment on function public.inventory_monitor() is
  'Bible §20.3: available vs remaining. Available is derived from reservations, never a stored counter — a counter drifts, and drift means double-selling.';

revoke all on function public.inventory_monitor() from anon;
grant execute on function public.inventory_monitor() to authenticated;

-- ----------------------------------------------------------------------------
-- Provisional / deferred records.
-- ----------------------------------------------------------------------------
insert into app_private.provisional_fields (table_name, column_name, bible_reference, note) values
  ('returned_to_stock_reviews', 'freed_unit_outcome', '§19.26',
   'RTS outcome authority and freed-unit / waitlist selection authority are not client-final. The outcome is recorded manually; nothing is auto-allocated.'),
  ('returned_to_stock_reviews', 'freed_unit_note', '§19.26',
   'Unsold-item and forfeited-item disposition remain unresolved before production.'),
  ('customer_duplicate_references', 'status', '§22.15',
   'Duplicate-merge mechanics are DEFERRED post-V1. Reviewing records a judgement and merges nothing.');
