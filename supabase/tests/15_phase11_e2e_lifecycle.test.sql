-- ============================================================================
-- Phase 11 — End-to-end lifecycle, executed as real users
-- (Bible §34.3 stages 7-8; §34.2 rules 1-12; roadmap Phase 11)
-- ----------------------------------------------------------------------------
-- Stages 1-6 proved the PARTS: constraints, policies, permission helpers. This
-- is the first suite that walks the WHOLE PATH the way production walks it —
-- a real JWT, a real server-side permission check, the real atomic functions —
-- from Pending Claim through to Official Order.
--
-- Why it exists: every earlier suite asserts AROUND the two most critical
-- writes in the system. Phase 4/5 unit tests match their SOURCE TEXT with a
-- regex; the Phase 4/5 database tests exercise the constraints that surround
-- them. Until this file, no test ever CALLED confirm_claim_and_print() or
-- approve_and_send_invoice(). Bible §34.2 r1 says a screen existing does not
-- prove the feature works. A function existing does not either, and neither
-- does its source matching a pattern.
--
-- The double-submit assertions here (§34.2 r4) are the roadmap's Phase 4 and
-- Phase 5 exit gates — "two staff confirming one claim -> one reservation",
-- "repeated Approve & Send Invoice -> one order" — actually executed for the
-- first time rather than argued from the schema.
-- ============================================================================
begin;
select plan(35);

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users (id, instance_id, email, aud, role) values
  ('b0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000000',
   'p11-operator@test.local', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000000',
   'p11-bystander@test.local', 'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key, is_active) values
  ('b1000000-0000-0000-0000-0000000000e1', 'b0000000-0000-0000-0000-0000000000e1',
   'P11 Operator', 'staff', true),
  ('b1000000-0000-0000-0000-0000000000e2', 'b0000000-0000-0000-0000-0000000000e2',
   'P11 Bystander', 'staff', true);

-- The operator holds the three grants the happy path needs, and nothing more.
-- The bystander holds claim_capture ONLY: enough to exist in the workflow,
-- never enough to confirm or to invoice. That asymmetry is the point.
insert into public.staff_permission_grants (staff_profile_id, permission_key) values
  ('b1000000-0000-0000-0000-0000000000e1', 'claim_capture'),
  ('b1000000-0000-0000-0000-0000000000e1', 'confirm_claim_print_label'),
  ('b1000000-0000-0000-0000-0000000000e1', 'invoice_preparation'),
  ('b1000000-0000-0000-0000-0000000000e2', 'claim_capture');

insert into public.customers (id, display_name)
values ('c1000000-0000-0000-0000-0000000000e1', 'P11 Lifecycle Customer');

-- Multi-stock on purpose. On a unique item the quantity guard fires before
-- UNIQUE(claim_id), so a one-reservation-per-claim proof on a unique item can
-- pass for the wrong reason (SESSION-HANDOFF §11, Owner-approved precedent).
insert into public.inventory_items (id, item_code, item_name, is_unique_item,
                                    quantity_total, grams_per_piece, total_price_per_piece)
values ('11000000-0000-0000-0000-0000000000e1', 'P11-MULTI', 'Lifecycle Bangle', false,
        5, 12.500, 8000.00);

create or replace function pg_temp.act_as(p_uid text, p_aal text default 'aal1')
returns void language plpgsql as $$
begin
  execute format('set local role authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true);
end $$;

-- ============================================================================
-- STEP 1 — Capture creates a Pending Claim and NOTHING else (Bible §12.3, §13.2)
-- ============================================================================
select pg_temp.act_as('b0000000-0000-0000-0000-0000000000e1');

select lives_ok(
  $$insert into public.claims (id, inventory_item_id, customer_id, quantity,
                               payment_arrangement, fulfillment_arrangement)
    values ('d1000000-0000-0000-0000-0000000000e1', '11000000-0000-0000-0000-0000000000e1',
            'c1000000-0000-0000-0000-0000000000e1', 2, 'full_payment', 'shipping')$$,
  'A permitted operator captures a claim'
);

select is(
  (select status from public.claims where id = 'd1000000-0000-0000-0000-0000000000e1'),
  'pending_claim',
  'Capture creates a Pending Claim — capture never confirms'
);

select is(
  (select count(*)::int from public.inventory_reservations
    where claim_id = 'd1000000-0000-0000-0000-0000000000e1'),
  0,
  'Capture reserves nothing — the reservation point is Confirm, not capture'
);

select is(
  (select count(*)::int from public.label_jobs
    where claim_id = 'd1000000-0000-0000-0000-0000000000e1'),
  0,
  'Capture queues no label'
);

-- Stock is untouched while the claim is merely pending.
select is(
  public.available_quantity_for('11000000-0000-0000-0000-0000000000e1'),
  5,
  'A Pending Claim holds no stock: all 5 units remain available'
);
reset role;

-- ============================================================================
-- STEP 2 — An unauthorized confirm changes NOTHING (Bible §30.3 r18, §34.2 r3)
-- ----------------------------------------------------------------------------
-- The bystander can SEE the claim and holds claim_capture. Visibility is not
-- action authority, and no permission silently includes another.
-- ============================================================================
select pg_temp.act_as('b0000000-0000-0000-0000-0000000000e2');

select throws_ok(
  $$select public.confirm_claim_and_print('d1000000-0000-0000-0000-0000000000e1')$$,
  '42501',
  null,
  'claim_capture does not silently include confirm_claim_print_label'
);
reset role;

-- The refusal must be total: the security failure completed no part of the
-- business action (§30.3 r18 — "must not silently complete a business action").
select is(
  (select status from public.claims where id = 'd1000000-0000-0000-0000-0000000000e1'),
  'pending_claim',
  'The refused confirm left the claim Pending — a denied write changes no record'
);

select is(
  (select count(*)::int from public.inventory_reservations
    where claim_id = 'd1000000-0000-0000-0000-0000000000e1'),
  0,
  'The refused confirm created no reservation'
);

select is(
  public.available_quantity_for('11000000-0000-0000-0000-0000000000e1'),
  5,
  'The refused confirm deducted no stock'
);

-- ============================================================================
-- STEP 3 — Confirm Claim & Print Label: ONE reservation, ONE label job
-- (Bible §22.6, §24; roadmap Phase 4 exit gate)
-- ============================================================================
select pg_temp.act_as('b0000000-0000-0000-0000-0000000000e1');

select is(
  (select public.confirm_claim_and_print('d1000000-0000-0000-0000-0000000000e1',
                                         'bench-printer') ->> 'deduplicated'),
  'false',
  'The first confirm reports itself as a real confirmation, not a replay'
);

select is(
  (select status from public.claims where id = 'd1000000-0000-0000-0000-0000000000e1'),
  'confirmed_claim',
  'Confirm produces a Confirmed Claim'
);

select is(
  (select count(*)::int from public.inventory_reservations
    where claim_id = 'd1000000-0000-0000-0000-0000000000e1'),
  1,
  'Confirm reserves exactly once'
);

select is(
  (select state from public.inventory_reservations
    where claim_id = 'd1000000-0000-0000-0000-0000000000e1'),
  'provisional',
  'The reservation is provisional until the Official Order commits it'
);

select is(
  public.available_quantity_for('11000000-0000-0000-0000-0000000000e1'),
  3,
  'Confirm deducts exactly the claimed quantity: 5 - 2 = 3 available'
);

select is(
  (select count(*)::int from public.label_jobs
    where claim_id = 'd1000000-0000-0000-0000-0000000000e1'),
  1,
  'Confirm queues exactly one label job'
);

select is(
  (select status from public.label_jobs
    where claim_id = 'd1000000-0000-0000-0000-0000000000e1'),
  'pending_print',
  'The label job is QUEUED, not printed — a label job is not a physical print (§24)'
);

-- The label carries a SNAPSHOT, so a reprint next week reproduces this label.
select is(
  (select customer_display_name from public.label_jobs
    where claim_id = 'd1000000-0000-0000-0000-0000000000e1'),
  'P11 Lifecycle Customer',
  'The label job snapshots the customer name rather than joining a mutable row'
);

-- Confirm creates NO order and NO invoice (Bible §6, §15, §22 — invariant #6).
select is(
  (select count(*)::int from public.official_orders),
  0,
  'Confirm & Print creates no Official Order — Approve & Send Invoice is the sole creation point'
);

-- ============================================================================
-- STEP 4 — Double-submit the confirm (Bible §34.2 r4, r10; Phase 4 exit gate)
-- ----------------------------------------------------------------------------
-- This is the double-click. The second call must return the SAME records, not
-- make new ones. Executed here for the first time.
-- ============================================================================
select is(
  (select public.confirm_claim_and_print('d1000000-0000-0000-0000-0000000000e1')
     ->> 'deduplicated'),
  'true',
  'A repeated confirm reports itself as deduplicated'
);

select is(
  (select count(*)::int from public.inventory_reservations
    where claim_id = 'd1000000-0000-0000-0000-0000000000e1'),
  1,
  'A repeated confirm still yields exactly ONE reservation (no double deduction)'
);

select is(
  (select count(*)::int from public.label_jobs
    where claim_id = 'd1000000-0000-0000-0000-0000000000e1'),
  1,
  'A repeated confirm creates no second label job'
);

select is(
  public.available_quantity_for('11000000-0000-0000-0000-0000000000e1'),
  3,
  'A repeated confirm deducts nothing further: still 3 available'
);

-- ============================================================================
-- STEP 5 — Invoice Draft grouping, then Approve & Send Invoice
-- (Bible §15, §22.8-22.9; roadmap Phase 5 exit gate)
-- ============================================================================
insert into public.invoice_drafts (id, customer_id, status, payment_arrangement,
                                   fulfillment_arrangement)
values ('f1000000-0000-0000-0000-0000000000e1', 'c1000000-0000-0000-0000-0000000000e1',
        'draft', 'full_payment', 'shipping');

select lives_ok(
  $$insert into public.invoice_draft_claims (invoice_draft_id, claim_id)
    values ('f1000000-0000-0000-0000-0000000000e1', 'd1000000-0000-0000-0000-0000000000e1')$$,
  'The Confirmed Claim groups into a matching Invoice Draft'
);
reset role;

-- An unauthorized Approve & Send must not mint an order.
select pg_temp.act_as('b0000000-0000-0000-0000-0000000000e2');
select throws_ok(
  $$select public.approve_and_send_invoice('f1000000-0000-0000-0000-0000000000e1')$$,
  '42501',
  null,
  'Approve & Send Invoice requires invoice_preparation — capture authority is not invoice authority'
);
reset role;

select is(
  (select count(*)::int from public.official_orders),
  0,
  'The refused Approve & Send created no Official Order'
);

-- ============================================================================
-- STEP 6 — The commit point: ONE Official Order (Bible §22.9, invariant #5)
-- ============================================================================
select pg_temp.act_as('b0000000-0000-0000-0000-0000000000e1');

select is(
  (select public.approve_and_send_invoice('f1000000-0000-0000-0000-0000000000e1')
     ->> 'deduplicated'),
  'false',
  'The first Approve & Send reports a real send'
);

select is(
  (select count(*)::int from public.official_orders),
  1,
  'Approve & Send creates exactly ONE Official Order'
);

select isnt(
  (select order_number from public.official_orders limit 1),
  null,
  'The order number is allocated by the database, not the application'
);

select isnt(
  (select invoice_number from public.official_orders limit 1),
  null,
  'The invoice number is allocated separately from the order number'
);

select is(
  (select state from public.inventory_reservations
    where claim_id = 'd1000000-0000-0000-0000-0000000000e1'),
  'committed',
  'The Official Order COMMITS the existing reservation'
);

-- The whole point of invariant #3: committing is not a second deduction.
select is(
  public.available_quantity_for('11000000-0000-0000-0000-0000000000e1'),
  3,
  'Committing the reservation deducts NOTHING further: still 3 available (no second deduction)'
);

-- ============================================================================
-- STEP 7 — Double-submit the send (Bible §34.2 r4, r9; Phase 5 exit gate)
-- ----------------------------------------------------------------------------
-- "Repeated Approve & Send Invoice -> one order." Executed, not argued.
-- ============================================================================
select is(
  (select public.approve_and_send_invoice('f1000000-0000-0000-0000-0000000000e1')
     ->> 'deduplicated'),
  'true',
  'A repeated Approve & Send reports itself as deduplicated'
);

select is(
  (select count(*)::int from public.official_orders),
  1,
  'A repeated Approve & Send still yields exactly ONE Official Order'
);

select is(
  (select count(*)::int from public.official_order_claims
    where claim_id = 'd1000000-0000-0000-0000-0000000000e1'),
  1,
  'The claim reaches exactly one Official Order, once'
);

select is(
  public.available_quantity_for('11000000-0000-0000-0000-0000000000e1'),
  3,
  'A repeated send deducts nothing: the full path 5 -> 3 deducted exactly once'
);
reset role;

select * from finish();
rollback;
