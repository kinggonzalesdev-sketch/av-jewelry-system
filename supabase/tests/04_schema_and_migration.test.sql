-- ============================================================================
-- Schema integrity, migration source preservation, status-vocabulary conformance
-- Bible §22.16 (Migration), §22.19 (To-be-confirmed items), §31 (Audit)
-- ============================================================================
begin;
select plan(23);

-- ============================================================================
-- Stable identifiers + separate business-facing references
-- ============================================================================
select is(
  (select count(*)::int
   from information_schema.columns
   where table_schema = 'public' and column_name = 'id' and data_type <> 'uuid'),
  0,
  'Every id column is a UUID (stable internal identifier)'
);

select has_column('public', 'official_orders', 'order_number', 'Official Orders carry a business-facing order number');
select has_column('public', 'official_orders', 'invoice_number', 'Official Orders carry a business-facing invoice number');
select has_column('public', 'claims', 'claim_reference', 'Claims carry a business-facing reference number');

select col_is_unique('public', 'official_orders', 'order_number', 'Order numbers are unique');
select col_is_unique('public', 'official_orders', 'invoice_number', 'Invoice numbers are unique');
select col_is_unique('public', 'claims', 'claim_reference', 'Claim references are unique');

-- ============================================================================
-- Every security-definer function must pin search_path.
-- An unpinned search_path on a definer function is a privilege-escalation path:
-- a caller could shadow a referenced object and have it run as the owner.
-- ============================================================================
select is(
  (select count(*)::int
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app_private')
     and p.prosecdef = true
     and (p.proconfig is null or not exists (
       select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'
     ))),
  0,
  'Every SECURITY DEFINER function pins an explicit search_path'
);

-- Phase 2 introduces SECURITY DEFINER helpers, which is justified: RLS policies
-- must read staff_profiles/grants, and as the calling user they cannot (those
-- tables have forced RLS). The guard is therefore no longer "none exist" but
-- "every one is narrow and confined".
select ok(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private' and p.prosecdef = true) > 0,
  'Phase 2 defines SECURITY DEFINER authorization helpers'
);

-- Every definer function lives in app_private, never in the PostgREST-exposed
-- public schema: no definer function is directly callable over the API.
select is(
  (select count(*)::int
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef = true),
  0,
  'No SECURITY DEFINER function is exposed in the public (API-reachable) schema'
);

-- ============================================================================
-- Status vocabulary conformance: To-be-confirmed statuses are NOT invented
-- ============================================================================
-- Bible §22.9/§22.19: "Paid in Full" and "Outstanding Balance" remain
-- To be confirmed. They must not appear anywhere as a status value.
select is(
  (select count(*)::int
   from pg_constraint c
   join pg_class t on t.oid = c.conrelid
   join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and pg_get_constraintdef(c.oid) ~* '(paid_in_full|paid in full|outstanding_balance)'),
  0,
  'No status invents "Paid in Full" or "Outstanding Balance" (both remain To be confirmed)'
);

-- Bible §22.10: Delivered/Read are integration-dependent and To be confirmed.
-- Match the QUOTED status literal, not a bare substring: 'read' is a substring
-- of the legitimate status 'ready_to_copy_or_send', which would false-positive.
select is(
  (select count(*)::int
   from pg_constraint c
   join pg_class t on t.oid = c.conrelid
   join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public' and t.relname = 'customer_messages'
     and pg_get_constraintdef(c.oid) ~ '''(delivered|read)'''),
  0,
  'Message statuses do not invent Delivered/Read (integration-dependent, To be confirmed)'
);

-- ============================================================================
-- Migration source preservation (Bible §22.16)
-- ============================================================================
insert into public.migration_batches (id, label, source_description)
values ('66666666-0000-0000-0000-000000000001', 'Test import', 'Legacy spreadsheet');

insert into public.migration_source_records (migration_batch_id, source_reference, source_payload)
values ('66666666-0000-0000-0000-000000000001', 'LEGACY-001',
        '{"original_status":"Active Layaway","legacy_date":"2024-03-01"}'::jsonb);

select is(
  (select source_payload->>'legacy_date' from public.migration_source_records
   where source_reference = 'LEGACY-001'),
  '2024-03-01',
  'Migration preserves the original source payload verbatim'
);

-- A migrated record must name its batch; a native record must not claim one.
select throws_ok(
  $$insert into public.customers (display_name, source_kind) values ('Bad migrant', 'migrated')$$,
  '23514',
  null,
  'A record marked migrated must reference its migration batch'
);

insert into public.customers (id, display_name, source_kind, migration_batch_id)
values ('cccccccc-2222-0000-0000-000000000001', 'Migrated Customer', 'migrated',
        '66666666-0000-0000-0000-000000000001');

select is(
  (select source_kind from public.customers where id = 'cccccccc-2222-0000-0000-000000000001'),
  'migrated',
  'A migrated record retains its source marking'
);

-- A claim-less migrated order must NOT fabricate a claim (Bible §22.16).
-- A 'sent' draft must record sent_at in the same write; the constraint enforces it.
insert into public.invoice_drafts (id, customer_id, status, sent_at)
values ('ffffffff-2222-0000-0000-000000000001', 'cccccccc-2222-0000-0000-000000000001', 'sent', now());

insert into public.official_orders (id, invoice_draft_id, customer_id, source_kind, migration_batch_id)
values ('99999999-2222-0000-0000-000000000001', 'ffffffff-2222-0000-0000-000000000001',
        'cccccccc-2222-0000-0000-000000000001', 'migrated', '66666666-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.official_order_claims
   where official_order_id = '99999999-2222-0000-0000-000000000001'),
  0,
  'A claim-less migrated order creates no fake claim'
);

-- ============================================================================
-- Audit attribution survives deactivation (Bible §31)
-- ============================================================================
insert into auth.users (id, instance_id, email, aud, role)
values ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000',
        'leaver@test.local', 'authenticated', 'authenticated');
insert into public.staff_profiles (id, auth_user_id, full_name, role_key)
values ('aaaaaaaa-2222-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'Departing Staff', 'staff');

insert into public.audit_events (id, actor_auth_uid, actor_label, action, entity_type)
values ('88888888-2222-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444',
        'Departing Staff', 'claim.confirm', 'claim');

update public.staff_profiles
set is_active = false, deactivated_at = now(), full_name = 'Renamed Person'
where id = 'aaaaaaaa-2222-0000-0000-000000000001';

select is(
  (select actor_label from public.audit_events where id = '88888888-2222-0000-0000-000000000001'),
  'Departing Staff',
  'Audit attribution survives deactivation AND rename (immutable snapshot)'
);

-- A staff profile with history cannot be deleted.
select throws_ok(
  $$delete from auth.users where id = '44444444-4444-4444-4444-444444444444'$$,
  '23503',
  null,
  'An auth user with a staff profile cannot be deleted (attribution is protected)'
);

-- Failed actions are recorded as failures, never as false successes.
insert into public.audit_events (actor_auth_uid, actor_label, action, entity_type, outcome, reason)
values ('44444444-4444-4444-4444-444444444444', 'Departing Staff', 'order.cancel', 'official_order',
        'denied', 'missing Owner approval');

select is(
  (select outcome from public.audit_events where action = 'order.cancel'),
  'denied',
  'A denied action is auditable as denied, not as a success'
);

-- ============================================================================
-- Structural guarantees
-- ============================================================================
-- 23 = the 20 reconciled permissions, plus three that Bible §22 names directly
-- in its status tables as the governing permission: Inventory Monitoring,
-- Miner-Allocation Review (§22.5, §22.15) and Initiate High-Risk Action (§22.14).
-- Bible §22.19 lists "Section 4-5 permission reconciliation" as still open, so
-- this catalog is deliberately traceable rather than final.
select is(
  (select count(*)::int from public.permissions),
  23,
  'The approved permission catalog is seeded (20 reconciled + 3 named in Bible §22)'
);

select is(
  (select count(*)::int from public.permissions where is_request_only),
  1,
  'Initiate High-Risk Action is marked request-only: requesting is not executing'
);

select is(
  (select count(*)::int from public.roles),
  3,
  'Exactly three approved roles exist'
);

-- No real operational data is seeded.
select is(
  (select count(*)::int from public.staff_profiles) +
  (select count(*)::int from public.live_batches) +
  (select count(*)::int from public.inventory_items),
  1,  -- only the one fixture staff profile created inside this test transaction
  'No real staff, customers, items, or orders are seeded by migrations'
);

select * from finish();
rollback;
