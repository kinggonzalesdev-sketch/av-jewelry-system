-- ============================================================================
-- Policies must be reachable: privilege AND policy, per table (Bible §30.3 r1-r4)
-- ----------------------------------------------------------------------------
-- Three tables shipped with permission-aware RLS policies written for
-- `authenticated` and no privilege for `authenticated` to reach them. Postgres
-- refuses at the privilege layer first, so the policies were dead code and the
-- screens depending on them were silently wrong (a claim with evidence reported
-- "0 evidence"; the capability console could not read its own catalog).
--
-- The cause is the same one that emptied the order balance: Phase 2's
-- `grant ... on all tables` is a point-in-time snapshot, and every table added
-- after migration 20260715130100 got nothing.
--
-- THE GENERAL RULE, asserted first: a table with a policy FOR `authenticated`
-- must also grant `authenticated` the privilege that policy governs. That test
-- catches the NEXT table to be added this way, which is the whole point — three
-- separate instances of one mistake means the mistake, not the instances, is
-- what needs a test.
-- ============================================================================
begin;
select plan(20);

-- ============================================================================
-- THE GENERAL RULE — a policy nobody can reach is not a control
-- ============================================================================
select is(
  (select count(*)::int
   from (
     select distinct p.tablename, p.cmd
     from pg_policies p
     where p.schemaname = 'public'
       and p.roles::text[] && array['authenticated']
   ) needed
   join pg_class c on c.relname = needed.tablename
   join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   where not has_table_privilege(
     'authenticated', c.oid,
     case needed.cmd
       when 'SELECT' then 'select'
       when 'INSERT' then 'insert'
       when 'UPDATE' then 'update'
       when 'DELETE' then 'delete'
       else 'select'
     end)
     and needed.cmd <> 'ALL'),
  0,
  'Every RLS policy written for authenticated is REACHABLE — no policy is dead code behind a missing privilege'
);

-- ============================================================================
-- claim_evidence — read on Claim Review, written at capture
-- ============================================================================
select ok(
  has_table_privilege('authenticated', 'public.claim_evidence', 'select'),
  'claim_evidence: SELECT granted — Claim Review counts evidence that exists'
);
select ok(
  has_table_privilege('authenticated', 'public.claim_evidence', 'insert'),
  'claim_evidence: INSERT granted — capture can attach evidence'
);
select is(
  has_table_privilege('authenticated', 'public.claim_evidence', 'delete'),
  false,
  'claim_evidence: DELETE stays revoked — evidence is not deleted'
);
select is(
  has_table_privilege('anon', 'public.claim_evidence', 'select'),
  false,
  'claim_evidence: anon holds nothing'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'claim_evidence'),
  'claim_evidence: RLS still ENABLED and FORCED — the grant restored the gate, not the control'
);

-- ============================================================================
-- conditional_capabilities — an approved CATALOG, not a runtime table
-- ============================================================================
select ok(
  has_table_privilege('authenticated', 'public.conditional_capabilities', 'select'),
  'conditional_capabilities: SELECT granted — the console can read its own catalog'
);
select ok(
  has_table_privilege('authenticated', 'public.conditional_capabilities', 'update'),
  'conditional_capabilities: UPDATE granted — a validated capability can be enabled'
);
select is(
  has_table_privilege('authenticated', 'public.conditional_capabilities', 'insert'),
  false,
  'conditional_capabilities: INSERT is NOT granted — the application cannot invent a sixth capability at runtime'
);
select is(
  has_table_privilege('authenticated', 'public.conditional_capabilities', 'delete'),
  false,
  'conditional_capabilities: DELETE is not granted'
);
select is(
  has_table_privilege('anon', 'public.conditional_capabilities', 'select'),
  false,
  'conditional_capabilities: anon holds nothing'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'conditional_capabilities'),
  'conditional_capabilities: RLS still ENABLED and FORCED'
);

-- ============================================================================
-- capability_validations — APPEND-ONLY EVIDENCE (§34.2 r14)
-- ----------------------------------------------------------------------------
-- The absences here are the assertions that matter. Evidence that can be edited
-- is not evidence: an UPDATE privilege would let a FAILED real-device result be
-- rewritten as PASSED, which is precisely the lie the capability gate exists to
-- prevent.
-- ============================================================================
select ok(
  has_table_privilege('authenticated', 'public.capability_validations', 'select'),
  'capability_validations: SELECT granted — recorded evidence is readable'
);
select ok(
  has_table_privilege('authenticated', 'public.capability_validations', 'insert'),
  'capability_validations: INSERT granted — a real-device result can be recorded'
);
select is(
  has_table_privilege('authenticated', 'public.capability_validations', 'update'),
  false,
  'capability_validations: UPDATE is NOT granted — a FAILED validation can never be rewritten into a PASSED one'
);
select is(
  has_table_privilege('authenticated', 'public.capability_validations', 'delete'),
  false,
  'capability_validations: DELETE is NOT granted — evidence is never removed'
);
select is(
  has_table_privilege('anon', 'public.capability_validations', 'select'),
  false,
  'capability_validations: anon holds nothing'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'capability_validations'),
  'capability_validations: RLS still ENABLED and FORCED'
);

-- ============================================================================
-- The capability gate is UNCHANGED by these grants
-- ----------------------------------------------------------------------------
-- Granting UPDATE on conditional_capabilities must not make a capability
-- switchable without evidence. The check constraint still decides.
-- ============================================================================
insert into auth.users (id, instance_id, email, aud, role)
values ('ba000000-0000-0000-0000-0000000000c1',
        '00000000-0000-0000-0000-000000000000',
        'priv-owner@test.local', 'authenticated', 'authenticated');
insert into public.staff_profiles (id, auth_user_id, full_name, role_key)
values ('ba100000-0000-0000-0000-0000000000c1',
        'ba000000-0000-0000-0000-0000000000c1', 'Priv Owner', 'owner');

select throws_ok(
  $$update public.conditional_capabilities
      set is_enabled = true,
          validated_at = now(),
          validated_by = 'ba100000-0000-0000-0000-0000000000c1'
      where key = 'printer_xp236b_bluetooth'$$,
  '23514',
  null,
  'The capability gate still refuses to enable without a PASSING validation — the grant changed the gate, not the rule'
);

select is(
  (select count(*)::int from public.conditional_capabilities where is_enabled),
  0,
  'Every conditional capability is still OFF — nothing was unlocked by restoring privileges'
);

select * from finish();
rollback;
