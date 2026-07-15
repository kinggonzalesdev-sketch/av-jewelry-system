-- ============================================================================
-- Phase 6 — Payment & Layaway (Bible §16, §17)
-- Encodes docs/PHASE-6-APPROVED-DECISIONS.md exactly.
-- ============================================================================
begin;
select plan(33);

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users (id, instance_id, email, aud, role)
values ('66666666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000000',
        'phase6-staff@test.local', 'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key)
values ('aaaaaaaa-0000-0000-0000-000000000061', '66666666-6666-6666-6666-666666666666',
        'Phase6 Fixture Staff', 'staff');

insert into public.customers (id, display_name)
values ('cccccccc-0000-0000-0000-000000000061', 'Phase6 Customer');

-- Item priced 10,000.00, 2.500 g.
insert into public.inventory_items (id, item_code, item_name, is_unique_item, quantity_total,
                                    grams_per_piece, total_price_per_piece)
values ('11111111-0000-0000-0000-000000000061', 'P6-A', 'Ring 21K', true, 1, 2.500, 10000.00);

insert into public.claims (id, inventory_item_id, customer_id, status, quantity,
                           payment_arrangement, fulfillment_arrangement)
values ('dddddddd-0000-0000-0000-000000000061', '11111111-0000-0000-0000-000000000061',
        'cccccccc-0000-0000-0000-000000000061', 'pending_claim', 1, 'layaway', 'pickup');

update public.claims set status = 'confirmed_claim', confirmed_at = now()
where id = 'dddddddd-0000-0000-0000-000000000061';

-- Committed by Phase 5's Approve & Send. A committed reservation records WHEN
-- it committed (Phase 1 constraint), so the fixture supplies it.
insert into public.inventory_reservations (inventory_item_id, claim_id, quantity, state, committed_at)
values ('11111111-0000-0000-0000-000000000061', 'dddddddd-0000-0000-0000-000000000061',
        1, 'committed', now());

-- A sent draft records when it was sent (Phase 1 constraint), so both are set
-- in the same statement.
insert into public.invoice_drafts (id, customer_id, status, sent_at,
                                   payment_arrangement, fulfillment_arrangement)
values ('ffffffff-0000-0000-0000-000000000061', 'cccccccc-0000-0000-0000-000000000061',
        'sent', now(), 'layaway', 'pickup');

insert into public.official_orders (id, invoice_draft_id, customer_id, status)
values ('7fffffff-0000-0000-0000-000000000061', 'ffffffff-0000-0000-0000-000000000061',
        'cccccccc-0000-0000-0000-000000000061', 'invoiced');

insert into public.official_order_claims (official_order_id, claim_id)
values ('7fffffff-0000-0000-0000-000000000061', 'dddddddd-0000-0000-0000-000000000061');

-- ============================================================================
-- APPROVED DECISION §5 — Layaway fee = 150 x grams x months, half-up to 2dp
-- ============================================================================
-- Worked example 1: 2.5g x 1pc x 2 months x 150 = 750.00
select is(
  app_private.layaway_fee(2.500, 2),
  750.00::numeric,
  'Approved worked example: 2.5g x 2 months x PHP150 = PHP750.00'
);

-- Worked example 2: (2x1) + (1.5x2) = 5g; 5 x 3 x 150 = 2250.00
select is(
  app_private.layaway_fee(5.000, 3),
  2250.00::numeric,
  'Approved worked example: 5g (multi-item) x 3 months x PHP150 = PHP2,250.00'
);

select is(
  app_private.layaway_fee(2.500, 1),
  375.00::numeric,
  'One-month fee'
);

select is(
  app_private.layaway_fee(2.500, 3),
  1125.00::numeric,
  'Three-month fee'
);

-- Grams are NOT pre-rounded: 0.335g x 1 x 150 = 50.25 exactly.
select is(
  app_private.layaway_fee(0.335, 1),
  50.25::numeric,
  'Grams are not rounded before calculating'
);

-- Half-up on the FINAL value only: 0.001 x 3 x 150 = 0.45
select is(
  app_private.layaway_fee(0.001, 3),
  0.45::numeric,
  'Only the final fee is rounded, half-up'
);

-- Money is numeric, never float. 0.1+0.2 = 0.3 exactly here.
select is(
  (0.1::numeric + 0.2::numeric),
  0.3::numeric,
  'Money arithmetic is exact decimal, not floating point'
);

-- ============================================================================
-- Activate the layaway: 2.5g, 2 months -> fee 750; payable 10,750; DP 2,150
-- ============================================================================
insert into public.layaway_arrangements
  (id, official_order_id, status, months, total_grams, layaway_fee,
   started_at, final_due_date, deposit_percent, grace_period_days)
values ('9abcdef0-0000-0000-0000-000000000061', '7fffffff-0000-0000-0000-000000000061',
        'overdue', 2, 2.500, app_private.layaway_fee(2.500, 2),
        now(), current_date + 60, 20.00, 10);

select is(
  app_private.layaway_amount_payable('7fffffff-0000-0000-0000-000000000061'),
  10750.00::numeric,
  'Layaway Amount Payable = item total + approved layaway fee'
);

select is(
  app_private.required_down_payment('7fffffff-0000-0000-0000-000000000061'),
  2150.00::numeric,
  'Required Down Payment = 20% of Layaway Amount Payable, fee included'
);

-- ============================================================================
-- §1/§2 — evidence submitted alone counts for NOTHING
-- ============================================================================
insert into public.payments (id, official_order_id, amount, status, payment_method,
                             reference_number, provider, transacted_at)
values ('4bcdef01-0000-0000-0000-000000000061', '7fffffff-0000-0000-0000-000000000061',
        2150.00, 'submitted_unverified', 'e_wallet', 'GC-REF-0001', 'GCash', now());

insert into public.payment_evidence (payment_id, storage_path)
values ('4bcdef01-0000-0000-0000-000000000061', 'private/payments/p6-proof-1.jpg');

select is(
  app_private.verified_net_payments('7fffffff-0000-0000-0000-000000000061'),
  0::numeric,
  'Submitted evidence alone contributes nothing to verified payments'
);

select is(
  app_private.outstanding_balance('7fffffff-0000-0000-0000-000000000061'),
  10750.00::numeric,
  'Unverified evidence does not reduce the Outstanding Balance'
);

-- ============================================================================
-- §6 — 20% activation threshold requires a VERIFIED deposit
-- ============================================================================
select throws_ok(
  $$update public.layaway_arrangements set status = 'active'
      where id = '9abcdef0-0000-0000-0000-000000000061'$$,
  '23514',
  null,
  'Layaway cannot activate without a verified down payment'
);

-- Verify the deposit.
update public.payments set status = 'verified' where id = '4bcdef01-0000-0000-0000-000000000061';
insert into public.payment_verifications (payment_id, outcome, verified_amount, verified_by)
values ('4bcdef01-0000-0000-0000-000000000061', 'verified', 2150.00,
        'aaaaaaaa-0000-0000-0000-000000000061');

select is(
  app_private.verified_net_payments('7fffffff-0000-0000-0000-000000000061'),
  2150.00::numeric,
  'A verified payment counts toward verified net payments'
);

select ok(
  app_private.verified_net_payments('7fffffff-0000-0000-0000-000000000061')
    >= app_private.required_down_payment('7fffffff-0000-0000-0000-000000000061'),
  'The verified deposit meets the 20% activation threshold'
);

select lives_ok(
  $$update public.layaway_arrangements
      set status = 'active',
          deposit_verified_payment_id = '4bcdef01-0000-0000-0000-000000000061'
      where id = '9abcdef0-0000-0000-0000-000000000061'$$,
  'Layaway activates once the verified deposit meets 20%'
);

-- ============================================================================
-- §4 — partial / underpayment
-- ============================================================================
select is(
  app_private.outstanding_balance('7fffffff-0000-0000-0000-000000000061'),
  8600.00::numeric,
  'A verified partial payment reduces the balance by exactly the verified amount'
);

select is(
  app_private.is_paid_in_full('7fffffff-0000-0000-0000-000000000061'),
  false,
  'A partial payment never marks the order Paid in Full'
);

-- ============================================================================
-- §3 — duplicate reference numbers are FLAGGED, not rejected
-- ============================================================================
select lives_ok(
  $$insert into public.payments (official_order_id, amount, status, payment_method,
                                 reference_number, provider, transacted_at)
    values ('7fffffff-0000-0000-0000-000000000061', 100.00, 'submitted_unverified',
            'e_wallet', 'GC-REF-0001', 'GCash', now())$$,
  'A duplicate reference number is accepted for review, not silently rejected'
);

select is(
  (select payment_count::int from public.duplicate_payment_references()
    where reference_number = 'GC-REF-0001'),
  2,
  'The duplicate reference is flagged for review'
);

-- ============================================================================
-- §3 — cash requires receiving staff identity and a reference number
-- ============================================================================
select throws_ok(
  $$insert into public.payments (official_order_id, amount, status, payment_method)
    values ('7fffffff-0000-0000-0000-000000000061', 500.00, 'submitted_unverified', 'cash')$$,
  '23514',
  null,
  'Cash without the receiving staff and reference number is refused'
);

-- ============================================================================
-- §4 — correction: unverified by staff, VERIFIED needs Owner approval
-- ============================================================================
insert into public.payments (id, official_order_id, amount, status, payment_method,
                             reference_number, provider, transacted_at)
values ('4bcdef01-0000-0000-0000-000000000062', '7fffffff-0000-0000-0000-000000000061',
        1000.00, 'submitted_unverified', 'bank_transfer', 'BT-REF-0002', 'BDO', now());

select lives_ok(
  $$update public.payments set amount = 1200.00
      where id = '4bcdef01-0000-0000-0000-000000000062'$$,
  'An UNVERIFIED payment may be corrected by an authorized staff member'
);

select throws_ok(
  $$update public.payments set amount = 9999.00
      where id = '4bcdef01-0000-0000-0000-000000000061'$$,
  '42501',
  null,
  'Correcting a VERIFIED payment without Owner approval is refused'
);

-- The approval must be a REAL referenced Owner Approval Request, not a free-text
-- token — the FK is what makes "Owner-approved" mean something.
-- An approved request records WHO decided and WHEN (Phase 1 constraint): an
-- approval with no decider is not an approval.
insert into public.owner_approval_requests
  (id, action_kind, status, entity_type, entity_id, reason, requested_by,
   decided_at, decided_by)
values ('0a11e5ed-0000-0000-0000-000000000061', 'wrong_payment_to_order_correction',
        'approved', 'payment', '4bcdef01-0000-0000-0000-000000000061',
        'Owner-approved correction: bank fee adjustment',
        'aaaaaaaa-0000-0000-0000-000000000061',
        now(), 'aaaaaaaa-0000-0000-0000-000000000061');

select lives_ok(
  $$update public.payments
      set amount = 2160.00,
          reassignment_approval_request_id = '0a11e5ed-0000-0000-0000-000000000061',
          reassignment_reason = 'Owner-approved correction: bank fee adjustment'
      where id = '4bcdef01-0000-0000-0000-000000000061'$$,
  'A VERIFIED payment may be corrected with Owner approval and a reason'
);

-- ============================================================================
-- §1/§2 — exact full payment, overpayment credit
-- ============================================================================
-- Reset to a clean, exactly-paid state.
update public.payments set amount = 2150.00 where id = '4bcdef01-0000-0000-0000-000000000061';

insert into public.payments (id, official_order_id, amount, status, payment_method,
                             reference_number, provider, transacted_at)
values ('4bcdef01-0000-0000-0000-000000000063', '7fffffff-0000-0000-0000-000000000061',
        8600.00, 'verified', 'bank_transfer', 'BT-REF-0003', 'BDO', now());
insert into public.payment_verifications (payment_id, outcome, verified_amount, verified_by)
values ('4bcdef01-0000-0000-0000-000000000063', 'verified', 8600.00,
        'aaaaaaaa-0000-0000-0000-000000000061');

select is(
  app_private.outstanding_balance('7fffffff-0000-0000-0000-000000000061'),
  0.00::numeric,
  'Exact full verified payment brings the Outstanding Balance to zero'
);

select is(
  app_private.is_paid_in_full('7fffffff-0000-0000-0000-000000000061'),
  true,
  'Verified net >= payable marks the order Paid in Full'
);

-- Overpay by 500.
insert into public.payments (id, official_order_id, amount, status, payment_method,
                             reference_number, provider, transacted_at)
values ('4bcdef01-0000-0000-0000-000000000064', '7fffffff-0000-0000-0000-000000000061',
        500.00, 'verified', 'e_wallet', 'GC-REF-0004', 'Maya', now());
insert into public.payment_verifications (payment_id, outcome, verified_amount, verified_by)
values ('4bcdef01-0000-0000-0000-000000000064', 'verified', 500.00,
        'aaaaaaaa-0000-0000-0000-000000000061');

select is(
  app_private.outstanding_balance('7fffffff-0000-0000-0000-000000000061'),
  0.00::numeric,
  'An overpayment never produces a negative Outstanding Balance'
);

select is(
  app_private.overpayment_credit('7fffffff-0000-0000-0000-000000000061'),
  500.00::numeric,
  'The verified excess is reported as Overpayment Credit'
);

-- ============================================================================
-- §1 — completion rules
-- ============================================================================
select throws_ok(
  $$update public.layaway_arrangements set status = 'completed', completed_at = now()
      where id = '9abcdef0-0000-0000-0000-000000000061'$$,
  '23514',
  null,
  'A Layaway cannot complete while an overpayment credit is unresolved'
);

-- Resolve the overpayment by voiding the excess (an authorized correction).
update public.payments set voided_at = now(), voided_reason = 'Owner-approved: excess refunded offline'
where id = '4bcdef01-0000-0000-0000-000000000064';

-- An unresolved correction also blocks completion.
update public.payments set correction_pending = true
where id = '4bcdef01-0000-0000-0000-000000000063';

select throws_ok(
  $$update public.layaway_arrangements set status = 'completed', completed_at = now()
      where id = '9abcdef0-0000-0000-0000-000000000061'$$,
  '23514',
  null,
  'A Layaway cannot complete while a payment correction is unresolved'
);

update public.payments set correction_pending = false
where id = '4bcdef01-0000-0000-0000-000000000063';

select lives_ok(
  $$update public.layaway_arrangements set status = 'completed', completed_at = now()
      where id = '9abcdef0-0000-0000-0000-000000000061'$$,
  'A Layaway completes at zero balance with no unresolved correction or overpayment'
);

-- ============================================================================
-- §6 — grace period, forfeiture, and stock
-- ============================================================================
select is(
  app_private.layaway_grace_ends('9abcdef0-0000-0000-0000-000000000061'),
  (current_date + 60 + 10),
  'Grace ends exactly 10 calendar days after the final due date'
);

-- Forfeiture stays Owner-approved (Phase 1 constraint) — no automatic path.
select throws_ok(
  $$update public.layaway_arrangements set status = 'forfeited'
      where id = '9abcdef0-0000-0000-0000-000000000061'$$,
  '23514',
  null,
  'Forfeiture without an Owner approval reference and reason is refused'
);

select is(
  (select state from public.inventory_reservations
    where claim_id = 'dddddddd-0000-0000-0000-000000000061'),
  'committed',
  'Nothing in payment or layaway handling returns stock automatically'
);

select * from finish();
rollback;
