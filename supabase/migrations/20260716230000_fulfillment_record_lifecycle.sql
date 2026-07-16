-- ============================================================================
-- Every Official Order gets exactly one fulfillment record, at the commit point
-- (Bible §18, §22.9; Owner decision 2026-07-16)
-- ----------------------------------------------------------------------------
-- THE DEFECT
-- Nothing ever created a fulfillment_records row. Not approve_and_send_invoice,
-- not a migration, not any TypeScript. The fulfillment queue was therefore
-- always "Nothing to fulfill", and prepareFulfillment() — which UPDATEs by
-- official_order_id — matched zero rows and returned NO ERROR. An operator
-- pressed Prepare, saw success, and nothing happened.
--
-- A silent no-op is worse than a visible failure: the operator believes the work
-- is done and moves on.
--
-- THE LIFECYCLE POINT (Owner decision)
-- The record is born at Approve & Send Invoice, and nowhere earlier:
--
--   Pending Claim     is not an order
--   Confirmed Claim   is only a reservation
--   Invoice Draft     is not official
--   Approve & Send    IS the commit point — the Official Order, its order and
--                     invoice numbers, the shared 3-day hold, and the committed
--                     inventory all become authoritative here
--
-- So fulfillment tracking begins exactly when there is something official to
-- fulfil, and never before.
--
-- WHAT THE RECORD MEANS
-- Only that tracking now exists. Its status is 'for_preparation' — the approved
-- initial state, which is the queue, not a claim of progress. It is explicitly
-- NOT prepared, released, shipped, picked up, or completed, and it carries no
-- method, no courier, and no tracking number. Those are set by
-- prepareFulfillment(), which is a separate act behind a separate permission.
--
-- ATOMICITY
-- The insert goes INSIDE the existing atomic function, beside the order insert.
-- A plpgsql function body is one transaction: if the fulfillment insert fails,
-- the Official Order, its numbers, the claim links and the reservation
-- commitment all roll back with it. An order that exists without fulfillment
-- tracking is exactly the partial state this prevents — and it is why this is
-- not a best-effort second request from the client.
--
-- IDEMPOTENCY
-- Enforced by the database, not by the UI, at two levels that already exist:
--   * official_orders_one_per_draft UNIQUE (invoice_draft_id) — two concurrent
--     Approve & Send calls cannot both create an order, so only one ever reaches
--     the fulfillment insert.
--   * fulfillment_one_per_order UNIQUE (official_order_id) — already present in
--     Phase 1. It is the backstop: a second insert raises 23505 and takes the
--     whole transaction with it rather than producing a duplicate.
-- The function's existing early return for an already-'sent' draft means a
-- retried Approve & Send never reaches the insert at all.
--
-- No `on conflict do nothing` here, deliberately. Swallowing a duplicate would
-- hide a real invariant violation; the constraint should be allowed to speak.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Who is allowed to create fulfillment tracking?
--
-- The existing policy is right and is left alone:
--
--   fulfillment_insert  INSERT  has_permission('fulfillment_preparation')
--                               OR has_permission('existing_record_entry')
--
-- That governs a USER deliberately creating a fulfillment record — preparing
-- one, or importing a historical one. It is not what happens at Approve & Send.
--
-- Approve & Send is performed by someone holding `invoice_preparation`, and
-- they may hold neither of the above. The record created there is not a user
-- exercising fulfillment authority; it is the SYSTEM stating that an order which
-- just became official now has tracking. Two different acts, two different
-- authorities.
--
-- Widening fulfillment_insert to include invoice_preparation would be the wrong
-- fix twice over: it would let an invoice preparer mint fulfillment records for
-- arbitrary orders at any time, and it would make one permission silently imply
-- another — the exact thing §5.13 forbids.
--
-- So this is the narrow SECURITY DEFINER helper the situation actually calls
-- for. It is:
--   * in app_private, which PostgREST does not expose
--   * search_path pinned (the classic definer hijack vector)
--   * explicitly re-authorized: invoice_preparation, checked inside
--   * minimal: it inserts one row with lifecycle-safe defaults and returns void
--   * granted to authenticated only, never anon
--   * unable to set method, courier, tracking, release, or preparation
--
-- It cannot be used to fabricate progress: the only status it can write is
-- 'for_preparation'.
-- ---------------------------------------------------------------------------
create or replace function app_private.create_fulfillment_tracking(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Re-checked at execution, inside the definer. The caller must be the person
  -- entitled to make an order official — not someone entitled to prepare it.
  if not app_private.has_permission('invoice_preparation') then
    raise exception
      'Not authorized: creating fulfillment tracking requires the invoice_preparation permission.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Every other column keeps its schema default: method null, no courier, no
  -- tracking, nothing released, nothing prepared. Creating tracking states only
  -- that tracking exists.
  insert into public.fulfillment_records (official_order_id, status)
  values (p_order_id, 'for_preparation');
end;
$$;

comment on function app_private.create_fulfillment_tracking(uuid) is
  'Creates the single fulfillment record for a newly official order, from inside approve_and_send_invoice. SECURITY DEFINER because the fulfillment_insert policy governs USER-initiated inserts (fulfillment_preparation / existing_record_entry) and Approve & Send is performed under invoice_preparation — a different act by a different authority. Re-checks invoice_preparation itself; can only ever write status for_preparation.';

revoke all on function app_private.create_fulfillment_tracking(uuid) from public, anon;
grant execute on function app_private.create_fulfillment_tracking(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Approve & Send Invoice now creates the fulfillment record, atomically.
--
-- The body is reproduced verbatim from 20260715160000 with ONE addition, marked
-- below. Nothing else changed: the permission check, the dedup path, the claim
-- guards, the number allocation, the reservation commitment and the returned
-- payload are all identical.
-- ---------------------------------------------------------------------------
create or replace function public.approve_and_send_invoice(p_invoice_draft_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_draft public.invoice_drafts%rowtype;
  v_order public.official_orders%rowtype;
  v_staff_id uuid;
  v_claim_count integer;
  v_bad_claim record;
  v_hold timestamptz;
begin
  if not app_private.has_permission('invoice_preparation') then
    raise exception
      'Not authorized: approving and sending an invoice requires the invoice_preparation permission. No record was changed.'
      using errcode = 'insufficient_privilege';
  end if;

  select sp.id into v_staff_id
  from public.staff_profiles sp
  where sp.auth_user_id = (select auth.uid());

  select * into v_draft
  from public.invoice_drafts
  where id = p_invoice_draft_id
  for update;

  if v_draft.id is null then
    raise exception 'That Invoice Draft could not be found.' using errcode = 'no_data_found';
  end if;

  -- Already sent: return what exists. A retry must not create a second order,
  -- and must not create a second fulfillment record either.
  if v_draft.status = 'sent' then
    select * into v_order
    from public.official_orders
    where invoice_draft_id = p_invoice_draft_id;

    return jsonb_build_object(
      'official_order_id', v_order.id,
      'order_number', v_order.order_number,
      'invoice_number', v_order.invoice_number,
      'hold_expires_at', v_order.hold_expires_at,
      'claim_count', (select count(*) from public.official_order_claims
                      where official_order_id = v_order.id),
      'deduplicated', true
    );
  end if;

  if v_draft.status = 'dissolved' then
    raise exception 'That Invoice Draft was dissolved and cannot be approved.'
      using errcode = 'check_violation';
  end if;

  select count(*)::int into v_claim_count
  from public.invoice_draft_claims
  where invoice_draft_id = p_invoice_draft_id and is_active;

  if v_claim_count = 0 then
    raise exception 'That Invoice Draft has no claims. There is nothing to invoice.'
      using errcode = 'check_violation';
  end if;

  select c.claim_reference, c.status into v_bad_claim
  from public.invoice_draft_claims idc
  join public.claims c on c.id = idc.claim_id
  where idc.invoice_draft_id = p_invoice_draft_id
    and idc.is_active
    and c.status <> 'confirmed_claim'
  limit 1;

  if v_bad_claim.claim_reference is not null then
    raise exception
      'Claim % is %, not a Confirmed Claim. Only Confirmed Claims can be invoiced.',
      v_bad_claim.claim_reference, v_bad_claim.status
      using errcode = 'check_violation';
  end if;

  select c.claim_reference into v_bad_claim
  from public.invoice_draft_claims idc
  join public.claims c on c.id = idc.claim_id
  where idc.invoice_draft_id = p_invoice_draft_id
    and idc.is_active
    and not exists (
      select 1 from public.inventory_reservations r where r.claim_id = c.id
    )
  limit 1;

  if v_bad_claim.claim_reference is not null then
    raise exception
      'Claim % holds no reservation. A claim without a reservation cannot be invoiced.',
      v_bad_claim.claim_reference
      using errcode = 'check_violation';
  end if;

  select c.claim_reference into v_bad_claim
  from public.invoice_draft_claims idc
  join public.claims c on c.id = idc.claim_id
  join public.official_order_claims ooc on ooc.claim_id = c.id
  where idc.invoice_draft_id = p_invoice_draft_id
    and idc.is_active
  limit 1;

  if v_bad_claim.claim_reference is not null then
    raise exception
      'Claim % already belongs to an Official Order.',
      v_bad_claim.claim_reference
      using errcode = 'check_violation';
  end if;

  v_hold := now() + interval '3 days';

  -- ONE order. order_number and invoice_number come from their sequences by
  -- DEFAULT, so they are allocated by the database, never by the application,
  -- and never regenerated on a message retry.
  insert into public.official_orders (invoice_draft_id, customer_id, status,
                                      hold_expires_at, created_by)
  values (p_invoice_draft_id, v_draft.customer_id, 'invoiced', v_hold, v_staff_id)
  returning * into v_order;

  -- ==========================================================================
  -- THE ADDITION: fulfillment tracking begins here, and only here.
  --
  -- Every column not named below keeps its schema default on purpose:
  --   status  -> 'for_preparation'  (the queue; NOT prepared, NOT released)
  --   method  -> null               (shipping vs pickup is chosen at Prepare)
  --   released_at / released_by -> null
  --
  -- No courier, no tracking number, no release, no dispatch. Creating the record
  -- states only that this order now has fulfillment tracking. Any other default
  -- would be the system claiming work that nobody has done.
  --
  -- Inside the transaction: if this fails, the order above rolls back with it.
  -- fulfillment_one_per_order UNIQUE (official_order_id) is the backstop.
  --
  -- Via the app_private helper (see §0) because the fulfillment_insert policy
  -- governs USER-initiated inserts under fulfillment_preparation, and the caller
  -- here holds invoice_preparation. The helper re-checks that permission itself
  -- and can only write status 'for_preparation'.
  -- ==========================================================================
  perform app_private.create_fulfillment_tracking(v_order.id);

  -- Link every claim. UNIQUE(claim_id) means a claim can never reach two orders.
  insert into public.official_order_claims (official_order_id, claim_id)
  select v_order.id, idc.claim_id
  from public.invoice_draft_claims idc
  where idc.invoice_draft_id = p_invoice_draft_id and idc.is_active;

  -- Provisional -> committed. The quantity is untouched, so nothing is deducted
  -- a second time; enforce_no_second_deduction() refuses if that ever changes.
  update public.inventory_reservations r
  set state = 'committed', committed_at = now()
  from public.invoice_draft_claims idc
  where idc.invoice_draft_id = p_invoice_draft_id
    and idc.is_active
    and r.claim_id = idc.claim_id
    and r.state = 'provisional';

  -- Marking the draft sent flips is_active off via the Phase 1 trigger, which
  -- releases the claims from the "one active draft" index.
  update public.invoice_drafts
  set status = 'sent', sent_at = now()
  where id = p_invoice_draft_id;

  return jsonb_build_object(
    'official_order_id', v_order.id,
    'order_number', v_order.order_number,
    'invoice_number', v_order.invoice_number,
    'hold_expires_at', v_hold,
    'claim_count', v_claim_count,
    'deduplicated', false
  );
end;
$$;

comment on function public.approve_and_send_invoice(uuid) is
  'The commit point (Bible §22.9). Atomically creates ONE Official Order, its order/invoice numbers, its claim links, its committed reservations, and exactly ONE fulfillment record in status for_preparation. A retry returns the existing order and creates nothing.';

revoke all on function public.approve_and_send_invoice(uuid) from anon;
grant execute on function public.approve_and_send_invoice(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Backfill: every EXISTING Official Order that has no fulfillment record.
--
-- Idempotent by construction — `where not exists` means re-running it is a
-- no-op, and fulfillment_one_per_order would refuse a duplicate anyway.
--
-- Historical orders receive the SAME lifecycle-safe initial state as new ones:
-- for_preparation, no method, no courier, no tracking, no release. Nothing is
-- fabricated. An order that was really shipped last month will read
-- 'for_preparation' here, and that is correct: this system has no record of
-- that shipment, and inventing one would be worse than admitting it.
--
-- Cancelled orders are included deliberately. The unique constraint says EVERY
-- Official Order has exactly one record, and a cancelled order is still an
-- Official Order; excluding it would leave a hole that the rule forbids and that
-- prepareFulfillment() would later report as missing.
-- ---------------------------------------------------------------------------
insert into public.fulfillment_records (official_order_id, status)
select o.id, 'for_preparation'
from public.official_orders o
where not exists (
  select 1 from public.fulfillment_records f where f.official_order_id = o.id
);

-- The backfill is auditable: one system-attributed event recording how many
-- orders were repaired. actor_kind='system' because no staff member did this —
-- claiming otherwise would put a person's name against a migration (Bible §31).
insert into public.audit_events (actor_auth_uid, actor_kind, actor_label, action,
                                 entity_type, outcome, reason, context)
select null, 'system', 'migration 20260716230000',
       'fulfillment.backfill', 'fulfillment_record', 'succeeded',
       'Backfilled fulfillment records for Official Orders created before the record was part of the Approve & Send transaction.',
       jsonb_build_object(
         'orders_total', (select count(*) from public.official_orders),
         'records_total', (select count(*) from public.fulfillment_records),
         'initial_status', 'for_preparation',
         'fabricated_courier_or_tracking', false
       )
where exists (select 1 from public.official_orders);

-- ---------------------------------------------------------------------------
-- 3. The invariant, stated as a constraint the database can enforce going
--    forward: every Official Order has exactly one fulfillment record.
--
-- UNIQUE(official_order_id) on fulfillment_records already gives "at most one".
-- "At least one" is guaranteed by the atomic function above; a trigger that
-- refused an order without a record would have to fire before the record could
-- possibly exist. So this is asserted by test rather than by constraint, and the
-- test is what catches a future path that creates an order some other way.
-- ---------------------------------------------------------------------------
do $$
declare
  v_orphans integer;
begin
  select count(*) into v_orphans
  from public.official_orders o
  where not exists (
    select 1 from public.fulfillment_records f where f.official_order_id = o.id
  );

  if v_orphans > 0 then
    raise exception
      'Backfill incomplete: % Official Order(s) still have no fulfillment record.',
      v_orphans;
  end if;
end $$;
