-- ============================================================================
-- Payment Verification queue + verify flow, as a REAL Staff caller
-- (Bible §16; docs/PHASE-6-APPROVED-DECISIONS.md §1-§4)
-- ----------------------------------------------------------------------------
-- The queue rendered empty while the overview card beside it counted 1. The
-- cause was NOT a grant and NOT RLS: `payments` has TWO foreign keys to
-- `official_orders` (official_order_id and reassigned_from_order_id), so the
-- PostgREST embed `official_orders(...)` was ambiguous and the whole request
-- failed with PGRST201. The reader discarded the error and mapped null to [].
--
-- The ambiguity itself cannot be asserted from SQL — it belongs to PostgREST —
-- so this file guards the two things SQL owns and that the fix depends on:
--
--   1. the two FKs really do both exist, so the embed MUST stay disambiguated.
--      If someone drops reassigned_from_order_id the hint becomes unnecessary,
--      and if someone adds a THIRD fk the same bug returns on another query.
--   2. the money rules the queue exists to serve, read as the Staff member who
--      will actually be looking at them.
--
-- The PostgREST layer itself is covered by
-- tests/integration/payment-verification-queue.test.ts.
-- ============================================================================
begin;
select plan(15);

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users (id, instance_id, email, aud, role) values
  ('bb000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000',
   'q-staff@test.local', 'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key, is_active)
values ('bb100000-0000-0000-0000-0000000000d1', 'bb000000-0000-0000-0000-0000000000d1',
        'Queue Staff', 'staff', true);

insert into public.staff_permission_grants (staff_profile_id, permission_key) values
  ('bb100000-0000-0000-0000-0000000000d1', 'claim_capture'),
  ('bb100000-0000-0000-0000-0000000000d1', 'confirm_claim_print_label'),
  ('bb100000-0000-0000-0000-0000000000d1', 'invoice_preparation'),
  ('bb100000-0000-0000-0000-0000000000d1', 'payment_verification');

insert into public.customers (id, display_name)
values ('cb000000-0000-0000-0000-0000000000d1', 'Queue Customer');

insert into public.inventory_items
  (id, item_code, item_name, is_unique_item, quantity_total, grams_per_piece,
   total_price_per_piece)
values ('1b000000-0000-0000-0000-0000000000d1', 'Q-M01', 'Queue Bangle', false,
        10, 5.000, 24000.00);

create or replace function pg_temp.act_as(p_uid text)
returns void language plpgsql as $$
begin
  execute format('set local role authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
end $$;

-- ============================================================================
-- THE AMBIGUITY the fix depends on: two FKs, payments -> official_orders
-- ============================================================================
select is(
  (select count(*)::int
   from pg_constraint c
   join pg_class t on t.oid = c.conrelid
   join pg_class f on f.oid = c.confrelid
   where t.relname = 'payments' and f.relname = 'official_orders'
     and c.contype = 'f'),
  2,
  'payments has exactly TWO foreign keys to official_orders — so every PostgREST embed MUST name the constraint'
);

select ok(
  (select count(*) = 1 from pg_constraint c
   join pg_class t on t.oid = c.conrelid
   where t.relname = 'payments' and c.conname = 'payments_official_order_id_fkey'),
  'payments_official_order_id_fkey exists — the constraint the queue names to mean "the order this payment is FOR"'
);

select ok(
  (select count(*) = 1 from pg_constraint c
   join pg_class t on t.oid = c.conrelid
   where t.relname = 'payments' and c.conname = 'payments_reassigned_from_order_id_fkey'),
  'payments_reassigned_from_order_id_fkey exists — the other candidate, and the reason the bare embed was refused'
);

-- ============================================================================
-- Build one real order as the Staff member, through the real functions
-- ============================================================================
select pg_temp.act_as('bb000000-0000-0000-0000-0000000000d1');

insert into public.claims (id, inventory_item_id, customer_id, quantity,
                           payment_arrangement, fulfillment_arrangement)
values ('db000000-0000-0000-0000-0000000000d1', '1b000000-0000-0000-0000-0000000000d1',
        'cb000000-0000-0000-0000-0000000000d1', 1, 'full_payment', 'shipping');

select public.confirm_claim_and_print('db000000-0000-0000-0000-0000000000d1');

insert into public.invoice_drafts (id, customer_id, status, payment_arrangement,
                                   fulfillment_arrangement)
values ('fb000000-0000-0000-0000-0000000000d1', 'cb000000-0000-0000-0000-0000000000d1',
        'draft', 'full_payment', 'shipping');
insert into public.invoice_draft_claims (invoice_draft_id, claim_id)
values ('fb000000-0000-0000-0000-0000000000d1', 'db000000-0000-0000-0000-0000000000d1');

select public.approve_and_send_invoice('fb000000-0000-0000-0000-0000000000d1')
  ->> 'official_order_id' as oid \gset

-- ============================================================================
-- A submitted payment is VISIBLE to the authorized Staff member
-- ============================================================================
insert into public.payments (id, official_order_id, amount, payment_method,
                             reference_number, provider, transacted_at, status)
values ('ab000000-0000-0000-0000-0000000000d1', :'oid', 10000.00, 'bank_transfer',
        'Q-REF-1', 'Test Bank', now(), 'submitted_unverified');

insert into public.payment_evidence (payment_id, storage_path)
values ('ab000000-0000-0000-0000-0000000000d1', 'q-evidence.png');

select is(
  (select count(*)::int from public.payments
    where status = 'submitted_unverified' and voided_at is null),
  1,
  'The submitted payment is visible to the authorized Staff member — the queue has a row to show'
);

select is(
  (select count(*)::int from public.payment_evidence
    where payment_id = 'ab000000-0000-0000-0000-0000000000d1'),
  1,
  'Its evidence is readable — the queue can show the evidence reference'
);

-- Recording is not verifying (§16).
select is(
  (select public.order_balance(:'oid') ->> 'outstanding_balance'),
  '24000.00',
  'Recorded-but-unverified evidence moves NO balance — outstanding is still the full ₱24,000'
);

select is(
  (select count(*)::int from public.payment_verifications
    where payment_id = 'ab000000-0000-0000-0000-0000000000d1'),
  0,
  'Recording created NO verification — there is no silent auto-verification'
);

-- ============================================================================
-- VERIFY: the balance moves by the VERIFIED amount, once
-- ============================================================================
insert into public.payment_verifications (payment_id, outcome, verified_amount, verified_by)
values ('ab000000-0000-0000-0000-0000000000d1', 'verified', 10000.00,
        'bb100000-0000-0000-0000-0000000000d1');
update public.payments set status = 'verified'
where id = 'ab000000-0000-0000-0000-0000000000d1';

select is(
  (select public.order_balance(:'oid') ->> 'verified_net_payments'),
  '10000.00',
  'Only the VERIFIED amount counts as collected'
);

select is(
  (select public.order_balance(:'oid') ->> 'outstanding_balance'),
  '14000.00',
  'Outstanding = ₱24,000 − ₱10,000 = ₱14,000 (approved §2)'
);

select is(
  (select public.order_balance(:'oid') ->> 'paid_in_full'),
  'false',
  'Required Payment Verified is NOT Paid in Full while ₱14,000 remains (approved §1)'
);

-- DOUBLE-SUBMIT: a second verification cannot exist.
select throws_ok(
  $$insert into public.payment_verifications
      (payment_id, outcome, verified_amount, verified_by)
    values ('ab000000-0000-0000-0000-0000000000d1', 'verified', 10000.00,
            'bb100000-0000-0000-0000-0000000000d1')$$,
  '23505',
  null,
  'A payment cannot be verified twice — UNIQUE(payment_id) refuses the retry'
);

select is(
  (select public.order_balance(:'oid') ->> 'outstanding_balance'),
  '14000.00',
  'The refused second verification changed nothing — the verified amount counts ONCE'
);

-- A verified payment leaves the queue; it is decided, not pending.
select is(
  (select count(*)::int from public.payments
    where status = 'submitted_unverified' and voided_at is null),
  0,
  'The verified payment leaves the awaiting-verification queue'
);

-- ============================================================================
-- REJECTION stays auditable (§16, §31)
-- ============================================================================
insert into public.payments (id, official_order_id, amount, payment_method,
                             reference_number, provider, transacted_at, status)
values ('ab000000-0000-0000-0000-0000000000d2', :'oid', 500.00, 'bank_transfer',
        'Q-REF-2', 'Test Bank', now(), 'submitted_unverified');

insert into public.payment_verifications (payment_id, outcome, note, verified_by)
values ('ab000000-0000-0000-0000-0000000000d2', 'rejected', 'Screenshot unreadable.',
        'bb100000-0000-0000-0000-0000000000d1');
update public.payments set status = 'rejected'
where id = 'ab000000-0000-0000-0000-0000000000d2';

select is(
  (select count(*)::int from public.payment_verifications
    where payment_id = 'ab000000-0000-0000-0000-0000000000d2' and outcome = 'rejected'),
  1,
  'Rejected evidence remains on the record — a rejection is a decision, not a deletion'
);

select is(
  (select public.order_balance(:'oid') ->> 'outstanding_balance'),
  '14000.00',
  'Rejected evidence counts toward NO balance'
);
reset role;

select * from finish();
rollback;
