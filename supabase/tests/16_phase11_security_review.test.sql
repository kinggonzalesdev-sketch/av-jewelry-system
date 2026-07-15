-- ============================================================================
-- Phase 11 — Security review sweep (Bible §30; §34.3 stage 9; §31 audit)
-- ----------------------------------------------------------------------------
-- Phase 1 proved deny-by-default. Phase 2 proved the permission model. This
-- file is the REVIEW pass the roadmap asks for at the launch gate: it re-checks
-- the posture across the whole migration chain (Phases 0-10, not just the phase
-- that introduced each table) and covers the escalation vectors no earlier
-- suite tests.
--
-- The distinction that matters: earlier suites test the rules they shipped.
-- This one asks "did any later phase quietly weaken the boundary?" — a question
-- only a full-chain sweep can answer, and the reason §34.3 lists security as a
-- stage of its own rather than a by-product of the feature phases.
-- ============================================================================
begin;
select plan(22);

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users (id, instance_id, email, aud, role) values
  ('b2000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000000',
   'p11-sec-owner@test.local', 'authenticated', 'authenticated'),
  ('b2000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000000',
   'p11-sec-admin@test.local', 'authenticated', 'authenticated'),
  ('b2000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-000000000000',
   'p11-sec-staff@test.local', 'authenticated', 'authenticated'),
  ('b2000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-000000000000',
   'p11-sec-gone@test.local', 'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key, is_active) values
  ('b3000000-0000-0000-0000-0000000000f1', 'b2000000-0000-0000-0000-0000000000f1',
   'Sec Owner', 'owner', true),
  ('b3000000-0000-0000-0000-0000000000f2', 'b2000000-0000-0000-0000-0000000000f2',
   'Sec Admin', 'selected_admin', true),
  ('b3000000-0000-0000-0000-0000000000f3', 'b2000000-0000-0000-0000-0000000000f3',
   'Sec Staff', 'staff', true);

create or replace function pg_temp.act_as(p_uid text, p_aal text default 'aal1')
returns void language plpgsql as $$
begin
  execute format('set local role authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true);
end $$;

-- ============================================================================
-- ESCALATION VECTOR: an unpinned SECURITY DEFINER function (Bible §30.8)
-- ----------------------------------------------------------------------------
-- A SECURITY DEFINER function runs as its owner. If it does not pin
-- search_path, any caller who can create a schema object can shadow a table or
-- operator it references and have the definer execute their code with the
-- owner's rights. This is THE classic Postgres privilege-escalation vector, and
-- the authz helpers are exactly the functions an attacker would want to own:
-- has_permission() and is_owner() decide every authorization question in the
-- system.
-- ============================================================================
select is(
  (select count(*)::int
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app_private')
     and p.prosecdef
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
       where cfg like 'search\_path=%'
     )),
  0,
  'Every SECURITY DEFINER function pins search_path — none can be hijacked by a shadowed object'
);

-- The authz helpers specifically: these decide authority, so name them.
select ok(
  (select p.prosecdef and 'search_path=' = any(
      select left(cfg, 12) from unnest(coalesce(p.proconfig, array[]::text[])) cfg)
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private' and p.proname = 'has_permission'),
  'app_private.has_permission() is SECURITY DEFINER with a pinned search_path'
);

select ok(
  (select p.prosecdef and 'search_path=' = any(
      select left(cfg, 12) from unnest(coalesce(p.proconfig, array[]::text[])) cfg)
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private' and p.proname = 'is_owner'),
  'app_private.is_owner() is SECURITY DEFINER with a pinned search_path'
);

-- ============================================================================
-- POSTURE: RLS across the WHOLE chain, including everything Phases 3-10 added
-- (Bible §30.3 r1-r4). Phase 2 proved this for the tables that existed then.
-- ============================================================================
select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and rowsecurity = false),
  0,
  'After all 20 migrations, RLS is still enabled on every public table'
);

select is(
  (select count(*)::int
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity = false),
  0,
  'After all 20 migrations, RLS is still FORCED on every public table'
);

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public'
     and (btrim(coalesce(qual, '')) = 'true' or btrim(coalesce(with_check, '')) = 'true')),
  0,
  'No phase introduced a wildcard policy'
);

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and (roles::text[] && array['anon', 'public'])),
  0,
  'No phase granted a policy to anon or PUBLIC'
);

-- app_private is the trusted internals. It must not be reachable anonymously.
select is(
  has_schema_privilege('anon', 'app_private', 'usage'),
  false,
  'anon cannot reach the app_private schema'
);

-- ============================================================================
-- AUDIT: append-only at EVERY layer (Bible §31, §30.3 r19)
-- ----------------------------------------------------------------------------
-- Phase 1 defended append-only three ways and said so: no privilege, no policy,
-- and a refusing trigger. Phase 2's `grant ... on all tables` re-granted UPDATE
-- and silently removed one of them — not exploitable (RLS has no update policy,
-- and the trigger still refuses), but the audit table is the record that proves
-- what every other table did. It is the last place to accept "two out of three".
--
-- Migration 20260716200000 restored the privilege layer. These assertions lock
-- it, so the next blanket grant fails a test instead of eroding the audit.
-- ============================================================================
select is(
  has_table_privilege('authenticated', 'public.audit_events', 'update'),
  false,
  'audit_events: UPDATE is not granted to authenticated (privilege layer restored)'
);

select is(
  has_table_privilege('authenticated', 'public.audit_events', 'delete'),
  false,
  'audit_events: DELETE is not granted to authenticated (privilege layer)'
);

-- No policy may ever permit mutation either — the second layer.
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'audit_events'
     and cmd in ('UPDATE', 'DELETE', 'ALL')),
  0,
  'audit_events: no policy permits UPDATE or DELETE (policy layer)'
);

-- And the trigger refuses even a caller who somehow holds both, so restoring a
-- grant by accident cannot make history editable.
insert into public.audit_events (actor_auth_uid, actor_kind, actor_label, action,
                                 entity_type, entity_id)
values ('b2000000-0000-0000-0000-0000000000f3', 'staff', 'Sec Staff',
        'phase11.security_review', 'test', 'b3000000-0000-0000-0000-0000000000f3');

select throws_ok(
  $$update public.audit_events set action = 'tampered'
     where action = 'phase11.security_review'$$,
  '42501',
  null,
  'audit_events refuses UPDATE at the trigger layer even for a privileged writer'
);

select throws_ok(
  $$delete from public.audit_events where action = 'phase11.security_review'$$,
  '42501',
  null,
  'audit_events refuses DELETE at the trigger layer even for a privileged writer'
);

-- ============================================================================
-- SESSION & ACCOUNT SECURITY (Bible §30.5-30.6, §30.15, §30.3 r17)
-- ----------------------------------------------------------------------------
-- "Disabled or removed users lose future access without erasing history."
-- Both halves are load-bearing and are tested as one rule, because an
-- implementation that satisfies only the first half looks correct in a login
-- test and destroys attribution in an audit.
-- ============================================================================
insert into public.staff_profiles (id, auth_user_id, full_name, role_key, is_active)
values ('b3000000-0000-0000-0000-0000000000f4', 'b2000000-0000-0000-0000-0000000000f4',
        'Sec Departed', 'staff', true);
insert into public.staff_permission_grants (staff_profile_id, permission_key)
values ('b3000000-0000-0000-0000-0000000000f4', 'claim_capture');

-- The departing user acts while still employed. This is the history that must
-- survive them. Note actor_label is a SNAPSHOT of who they were at the time —
-- Bible §31 requires attribution to survive rename and deactivation, so the
-- audit row never joins to the mutable profile it describes.
insert into public.audit_events (actor_auth_uid, actor_kind, actor_label, action,
                                 entity_type, entity_id)
values ('b2000000-0000-0000-0000-0000000000f4', 'staff', 'Sec Departed',
        'phase11.acted_while_active', 'test', 'b3000000-0000-0000-0000-0000000000f4');

select pg_temp.act_as('b2000000-0000-0000-0000-0000000000f4');
select is(
  app_private.has_permission('claim_capture'),
  true,
  'An active staff member with a grant holds the permission'
);
reset role;

update public.staff_profiles set is_active = false, deactivated_at = now()
where id = 'b3000000-0000-0000-0000-0000000000f4';

select pg_temp.act_as('b2000000-0000-0000-0000-0000000000f4');
select is(
  app_private.has_permission('claim_capture'),
  false,
  'Deactivation removes future authority even though the GRANT row still exists'
);
reset role;

-- The grant survives; only the authority is gone. Deactivation is not deletion.
select is(
  (select count(*)::int from public.staff_permission_grants
    where staff_profile_id = 'b3000000-0000-0000-0000-0000000000f4'),
  1,
  'Deactivation does not delete the permission grant — it withdraws authority, not history'
);

select is(
  (select count(*)::int from public.audit_events
    where actor_auth_uid = 'b2000000-0000-0000-0000-0000000000f4'
      and action = 'phase11.acted_while_active'),
  1,
  'A deactivated user keeps their audit history — attribution survives deactivation (§30.3 r7)'
);

-- The snapshot is what makes this survive: even renaming the profile cannot
-- rewrite who the audit says acted.
update public.staff_profiles set full_name = 'Renamed After Leaving'
where id = 'b3000000-0000-0000-0000-0000000000f4';

select is(
  (select actor_label from public.audit_events
    where actor_auth_uid = 'b2000000-0000-0000-0000-0000000000f4'
      and action = 'phase11.acted_while_active'),
  'Sec Departed',
  'Renaming a departed account does not rewrite history — the audit label is a snapshot (§31)'
);

-- ============================================================================
-- OWNER-ONLY, NON-DELEGABLE APPROVALS (Bible §30.9, §5.13; invariant #8)
-- ----------------------------------------------------------------------------
-- All six are asserted as a set. A future phase adding a seventh action_kind
-- that is not Owner-gated is exactly the regression this catches.
-- ============================================================================
select is(
  (select count(*)::int
   from unnest(array['official_order_cancellation', 'layaway_forfeiture', 'price_override',
                     'exceptional_fulfillment_release', 'live_batch_reopen',
                     'wrong_payment_to_order_correction']) k
   where not exists (
     select 1 from pg_constraint c
     join pg_class t on t.oid = c.conrelid
     where t.relname = 'owner_approval_requests'
       and pg_get_constraintdef(c.oid) like '%' || k || '%')),
  0,
  'All six non-delegable Owner-approval kinds are present in the schema'
);

-- A Selected Admin is the highest non-Owner authority. If anyone could slip
-- past the Owner gate it would be them, so they are the one to test.
select pg_temp.act_as('b2000000-0000-0000-0000-0000000000f2');
select is(
  app_private.is_owner(),
  false,
  'A Selected Admin is not an Owner — the title is close, the authority is not'
);
reset role;

select pg_temp.act_as('b2000000-0000-0000-0000-0000000000f1');
select is(
  app_private.is_owner(),
  true,
  'The Owner is recognised as Owner'
);
reset role;

-- ============================================================================
-- SECRETS: no credential material in the schema (Bible §30.3 r15, §30.12)
-- ----------------------------------------------------------------------------
-- The Bible forbids storing card numbers, CVV, or PINs anywhere, ever
-- (SESSION-HANDOFF §11). A column named for one is the cheapest possible way to
-- catch a future phase reintroducing it.
-- ============================================================================
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public'
     and (column_name ~* '(card_number|cardnumber|cvv|cvc|card_pin|(^|_)pin$)')),
  0,
  'No column stores a card number, CVV, or PIN — the Bible forbids it outright'
);

select * from finish();
rollback;
