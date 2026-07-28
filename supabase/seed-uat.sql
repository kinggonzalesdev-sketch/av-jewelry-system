-- ============================================================================
-- UAT synthetic dataset — STAGING / LOCAL ONLY
-- ----------------------------------------------------------------------------
-- Implements docs/UAT-SETUP-ACCOUNTS-DATA-DEVICES.md §2.
--
-- ⚠️  NEVER run this against production. Every record here is invented.
--     Bible §30.3 r16 / §34.2 r17: test data must not contaminate production.
--
-- This file is deliberately NOT named seed.sql, so `supabase db reset` does not
-- run it automatically. Run it explicitly, AFTER the auth accounts exist:
--
--     bash supabase/seed-uat-accounts.sh          # creates the 6 auth users
--     psql "$DB_URL" -f supabase/seed-uat.sql     # loads this dataset
--
-- It contains NO passwords. Staff profiles are linked to auth users by email
-- lookup, so credentials live only in the account script's environment.
--
-- This file is UNCOMMITTED on purpose (it is not part of the approved Phase 11
-- commit list). Do not commit it without asking.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Staff profiles — linked to the auth users created by seed-uat-accounts.sh
-- ---------------------------------------------------------------------------
-- Profile ids are generated: every reference below resolves by email, so no
-- hand-written UUID is needed and none can drift out of sync.
insert into public.staff_profiles (auth_user_id, full_name, role_key, is_active)
select u.id, v.full_name, v.role_key, true
from (values
  ('uat-owner@uat.local',         'UAT Owner',          'owner'),
  ('uat-admin@uat.local',         'UAT Selected Admin', 'selected_admin'),
  ('uat-staff-full@uat.local',    'UAT Staff Full',     'staff'),
  ('uat-staff-2@uat.local',       'UAT Staff Two',      'staff'),
  ('uat-staff-limited@uat.local', 'UAT Staff Limited',  'staff'),
  ('uat-staff-noperm@uat.local',  'UAT Staff NoPerm',   'staff')
) as v(email, full_name, role_key)
join auth.users u on u.email = v.email
where not exists (
  select 1 from public.staff_profiles sp where sp.auth_user_id = u.id
);

-- ---------------------------------------------------------------------------
-- 2. Permission grants
-- ----------------------------------------------------------------------------
-- UAT-OWNER receives NO grants here, and does not need any: the Owner holds
-- EVERY permission by the owner-level rule in app_private.has_permission
-- (migration 20260716240000_owner_holds_all_permissions). The Owner is the main
-- administrator (Bible §5). Role title is still not authority for Selected Admin
-- or Staff (§5.13) — they hold only the explicit grants below.
-- UAT-STAFF-NOPERM receives nothing either: UAT-14 depends on it.
-- ---------------------------------------------------------------------------
insert into public.staff_permission_grants (staff_profile_id, permission_key)
select sp.id, g.permission_key
from (values
  -- UAT-ADMIN: the highest NON-Owner authority. Never enough to self-approve.
  ('uat-admin@uat.local',      'claim_review'),
  ('uat-admin@uat.local',      'existing_record_entry'),
  ('uat-admin@uat.local',      'initiate_high_risk_action'),

  -- UAT-STAFF-FULL: the everyday operator.
  ('uat-staff-full@uat.local', 'claim_capture'),
  ('uat-staff-full@uat.local', 'claim_review'),
  ('uat-staff-full@uat.local', 'confirm_claim_print_label'),
  ('uat-staff-full@uat.local', 'invoice_preparation'),
  ('uat-staff-full@uat.local', 'message_preparation'),
  ('uat-staff-full@uat.local', 'message_sending'),
  ('uat-staff-full@uat.local', 'payment_verification'),
  ('uat-staff-full@uat.local', 'fulfillment_preparation'),
  ('uat-staff-full@uat.local', 'fulfillment_release'),
  ('uat-staff-full@uat.local', 'layaway_monitoring'),
  ('uat-staff-full@uat.local', 'inventory_monitoring'),
  ('uat-staff-full@uat.local', 'miner_allocation_review'),
  ('uat-staff-full@uat.local', 'live_batch_operation'),
  ('uat-staff-full@uat.local', 'live_batch_closure'),
  ('uat-staff-full@uat.local', 'current_flex_item_control'),
  ('uat-staff-full@uat.local', 'post_live_item_entry'),
  ('uat-staff-full@uat.local', 'retry_reprint_label'),
  ('uat-staff-full@uat.local', 'void_cancel_label_job'),
  ('uat-staff-full@uat.local', 'initiate_high_risk_action'),

  -- UAT-STAFF-2: enough to race UAT-STAFF-FULL on one claim (UAT-05).
  ('uat-staff-2@uat.local',    'claim_capture'),
  ('uat-staff-2@uat.local',    'confirm_claim_print_label'),

  -- UAT-STAFF-LIMITED: capture ONLY. Proves capture does not include confirm.
  ('uat-staff-limited@uat.local', 'claim_capture')
) as g(email, permission_key)
join auth.users u on u.email = g.email
join public.staff_profiles sp on sp.auth_user_id = u.id
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Customers (§2.1) — invented people, fake numbers
-- ---------------------------------------------------------------------------
insert into public.customers (id, display_name, contact_number) values
  ('c0000000-0000-0000-0000-000000000001', 'Test Customer Ana Cruz',    '0999-000-0001'),
  ('c0000000-0000-0000-0000-000000000002', 'Test Customer Ben Santos',  '0999-000-0002'),
  ('c0000000-0000-0000-0000-000000000003', 'Test Customer Cara Reyes',  '0999-000-0003'),
  ('c0000000-0000-0000-0000-000000000004', 'Test Customer Dino Lim',    '0999-000-0004'),
  ('c0000000-0000-0000-0000-000000000005', 'Test Customer Elle Tan',    '0999-000-0005'),
  ('c0000000-0000-0000-0000-000000000006', 'Test Customer Fay Ocampo',  '0999-000-0006'),
  ('c0000000-0000-0000-0000-000000000007', 'Test Customer Gil Navarro', '0999-000-0007')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Inventory (§2.2)
-- ----------------------------------------------------------------------------
-- UAT-M01 and UAT-M02 are MULTI-STOCK deliberately. On a UNIQUE item the
-- quantity guard fires before UNIQUE(claim_id), so a "reserved exactly once"
-- proof on a unique item can pass for the wrong reason. UAT-04 and UAT-05 must
-- use UAT-M01.
--
-- STOCK HEADROOM — the totals below are NOT arbitrary. Some claims below ship
-- already confirmed (UAT-07 grouping, the payment cases, the cancellation
-- target), and a confirmed claim holds a reservation, which consumes stock the
-- moment this file runs. The totals are set so the AVAILABLE figure a tester
-- sees at the start of each scenario matches what the checklist tells them to
-- expect:
--
--   UAT-M01  total 7  −2 pre-confirmed (UAT-07 grouping, overpayment)  = 5 available
--                     UAT-04 then confirms qty 2                       → 3   (checklist)
--                     UAT-05 then confirms qty 1                       → 2
--   UAT-M02  total 5  −3 pre-confirmed (grouping, exact pay, cancel)   = 2 available
--                     leaves UAT-12 a unit to sell end-to-end
--
-- Get this wrong and UAT-12 — the decisive manual-fallback scenario — is
-- blocked by "not enough stock", which looks like a product defect and is not.
-- ---------------------------------------------------------------------------
insert into public.inventory_items
  (id, item_code, item_name, is_unique_item, quantity_total, grams_per_piece, total_price_per_piece)
values
  ('11000000-0000-0000-0000-000000000001', 'UAT-U01', 'Test Ring Solitaire',   true,  1,  5.000, 10000.00),
  ('11000000-0000-0000-0000-000000000002', 'UAT-U02', 'Test Necklace Rope',    true,  1,  8.000, 20000.00),
  ('11000000-0000-0000-0000-000000000003', 'UAT-M01', 'Test Bangle Classic',   false, 7, 12.500,  8000.00),
  ('11000000-0000-0000-0000-000000000004', 'UAT-M02', 'Test Earrings Pair',    false, 5,  3.000,  6000.00),
  ('11000000-0000-0000-0000-000000000005', 'UAT-L01', 'Test Layaway Chain',    true,  1,  5.000, 25000.00),
  ('11000000-0000-0000-0000-000000000006', 'UAT-L02', 'Test Layaway Bracelet', true,  1,  6.000, 30000.00)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 5. Claims (§2.4)
-- ----------------------------------------------------------------------------
-- EVERY claim is born Pending, then transitioned. Phase 3 forbids inserting an
-- already-confirmed claim (capture creates a Pending Claim only, §12.3/§13.2),
-- and that rule is Owner-approved — so the fixture obeys it rather than
-- shortcutting it.
-- ---------------------------------------------------------------------------
insert into public.claims
  (id, inventory_item_id, customer_id, status, quantity, payment_arrangement, fulfillment_arrangement)
values
  -- UAT-04: the double-tap. Left PENDING for the tester to confirm.
  ('d0000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000003',
   'c0000000-0000-0000-0000-000000000001', 'pending_claim', 2, 'full_payment', 'shipping'),
  -- UAT-05: two staff, one claim. Left PENDING.
  ('d0000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000003',
   'c0000000-0000-0000-0000-000000000001', 'pending_claim', 1, 'full_payment', 'shipping'),
  -- UAT-07 grouping: three claims for one customer, same arrangements.
  ('d0000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000001', 'pending_claim', 1, 'full_payment', 'shipping'),
  ('d0000000-0000-0000-0000-000000000004', '11000000-0000-0000-0000-000000000003',
   'c0000000-0000-0000-0000-000000000001', 'pending_claim', 1, 'full_payment', 'shipping'),
  ('d0000000-0000-0000-0000-000000000005', '11000000-0000-0000-0000-000000000004',
   'c0000000-0000-0000-0000-000000000001', 'pending_claim', 1, 'full_payment', 'shipping'),
  -- UAT-11: Returned-to-Stock. Unique item, has a 2nd miner waiting.
  ('d0000000-0000-0000-0000-000000000006', '11000000-0000-0000-0000-000000000002',
   'c0000000-0000-0000-0000-000000000001', 'pending_claim', 1, 'full_payment', 'pickup'),
  -- 2nd miner on UAT-U02 (UAT-C02). Stays PENDING — it must never be
  -- auto-promoted when the 1st miner withdraws (§19, §22.5).
  ('d0000000-0000-0000-0000-000000000007', '11000000-0000-0000-0000-000000000002',
   'c0000000-0000-0000-0000-000000000002', 'pending_claim', 1, 'full_payment', 'pickup'),
  -- Exact-payment order (UAT-C02).
  ('d0000000-0000-0000-0000-000000000008', '11000000-0000-0000-0000-000000000004',
   'c0000000-0000-0000-0000-000000000002', 'pending_claim', 1, 'full_payment', 'pickup'),
  -- Overpayment order (UAT-C03).
  ('d0000000-0000-0000-0000-000000000009', '11000000-0000-0000-0000-000000000003',
   'c0000000-0000-0000-0000-000000000003', 'pending_claim', 1, 'full_payment', 'shipping'),
  -- Cancellation target (UAT-C07) — UAT-10 #1.
  ('d0000000-0000-0000-0000-00000000000a', '11000000-0000-0000-0000-000000000004',
   'c0000000-0000-0000-0000-000000000007', 'pending_claim', 1, 'full_payment', 'shipping')
on conflict do nothing;

-- Confirm the ones the scenarios expect to find already confirmed, and reserve
-- them. Order matters: the Phase 1 reservation guard requires the claim to
-- already read 'confirmed_claim'.
update public.claims
set status = 'confirmed_claim', confirmed_at = now(),
    confirmed_by = (select sp.id from public.staff_profiles sp
                    join auth.users u on u.id = sp.auth_user_id
                    where u.email = 'uat-staff-full@uat.local')
where id in (
  'd0000000-0000-0000-0000-000000000003',  -- UAT-07 grouping
  'd0000000-0000-0000-0000-000000000004',
  'd0000000-0000-0000-0000-000000000005',
  'd0000000-0000-0000-0000-000000000006',  -- UAT-11 RTS
  'd0000000-0000-0000-0000-000000000008',  -- exact payment
  'd0000000-0000-0000-0000-000000000009',  -- overpayment
  'd0000000-0000-0000-0000-00000000000a'   -- cancellation
);

insert into public.inventory_reservations (inventory_item_id, claim_id, quantity, state)
values
  ('11000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 1, 'provisional'),
  ('11000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000004', 1, 'provisional'),
  ('11000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005', 1, 'provisional'),
  ('11000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000006', 1, 'provisional'),
  ('11000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000008', 1, 'provisional'),
  ('11000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000009', 1, 'provisional'),
  ('11000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-00000000000a', 1, 'provisional')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 6. Miner positions (§2.3) — UAT-U02 has a 1st and a 2nd. Never a 3rd.
-- ---------------------------------------------------------------------------
insert into public.miner_positions (inventory_item_id, claim_id, position) values
  ('11000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000006', 1),
  ('11000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000007', 2)
on conflict do nothing;

commit;

-- ============================================================================
-- What is deliberately NOT seeded, and why
-- ----------------------------------------------------------------------------
-- Invoice drafts, Official Orders, payments, layaway arrangements, fulfillment
-- records, cancellation requests and RTS reviews are NOT pre-created.
--
-- They are the OUTPUT of the scenarios that test them. Seeding an Official
-- Order would mean UAT-07 never exercises approve_and_send_invoice(); seeding a
-- verified payment would mean UAT-09 never exercises verification. The tester
-- builds them through the UI — that is the test.
--
-- The layaway cases (§2.6) need backdated due dates and cannot be created
-- honestly through the UI in one sitting. Set them up only when running the
-- layaway scenarios, per the setup document, and note the backdating on the
-- checklist.
-- ============================================================================
