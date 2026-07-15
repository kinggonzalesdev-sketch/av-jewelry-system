-- ============================================================================
-- Phase 2 — Authorization helper functions
-- ----------------------------------------------------------------------------
-- Why SECURITY DEFINER is necessary here (and only here):
--
-- Phase 1 enabled and FORCED RLS on every table, including staff_profiles and
-- staff_permission_grants, with no policies. A policy on `claims` that needs to
-- ask "does this caller hold claim_review?" must read those identity tables — and
-- as the calling user it cannot, because their own RLS denies it. Recursive
-- policy evaluation would also loop.
--
-- These helpers therefore run as the owner to read ONLY the identity tables.
-- Every one of them:
--   * pins `search_path = ''` so no caller can shadow a referenced object and
--     have it execute with owner rights (the classic definer escalation);
--   * takes identity from auth.uid() ALONE — never a caller-supplied actor id;
--   * answers exactly one narrow question and grants nothing by itself;
--   * returns false/null rather than raising, so a policy fails closed.
--
-- Bible §5/§11/§30.3 r2: role title is not authority; assignment is not
-- permission; UI visibility is not authorization. No helper below infers a
-- permission from a role — `has_permission` reads explicit grants only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- current_staff_id() — the acting staff profile, derived from the verified JWT.
-- ----------------------------------------------------------------------------
create or replace function app_private.current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select sp.id
  from public.staff_profiles sp
  where sp.auth_user_id = (select auth.uid())
  limit 1;
$$;

comment on function app_private.current_staff_id() is
  'The acting staff profile id, from auth.uid() only. Never trusts a caller-supplied actor id.';

-- ----------------------------------------------------------------------------
-- current_staff_role() — role TITLE only. Deliberately not authority.
-- ----------------------------------------------------------------------------
create or replace function app_private.current_staff_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select sp.role_key
  from public.staff_profiles sp
  where sp.auth_user_id = (select auth.uid())
  limit 1;
$$;

comment on function app_private.current_staff_role() is
  'The caller''s role TITLE. A title is not authority (Bible §5) — never use this to infer a permission; use has_permission().';

-- ----------------------------------------------------------------------------
-- is_active_staff() — authenticated AND active.
-- A deactivated account loses FUTURE access (Bible §30.6) while its history
-- remains attributable.
-- ----------------------------------------------------------------------------
create or replace function app_private.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_profiles sp
    where sp.auth_user_id = (select auth.uid())
      and sp.is_active
  );
$$;

comment on function app_private.is_active_staff() is
  'True only for an authenticated, ACTIVE staff account. Deactivated accounts lose future access; their history remains.';

-- ----------------------------------------------------------------------------
-- has_permission() — the ONLY source of permission truth.
--
-- Reads explicit grants. It does NOT consult role_key: no role silently confers
-- a permission, and no permission silently grants another (Bible §5.13).
-- An inactive account holds nothing, regardless of its grants.
-- ----------------------------------------------------------------------------
create or replace function app_private.has_permission(p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_permission_grants g
    join public.staff_profiles sp on sp.id = g.staff_profile_id
    where sp.auth_user_id = (select auth.uid())
      and sp.is_active
      and g.permission_key = p_permission_key
  );
$$;

comment on function app_private.has_permission(text) is
  'Explicit grant lookup — the only source of permission truth. Ignores role title entirely (Bible §5.13). Inactive accounts hold nothing.';

-- ----------------------------------------------------------------------------
-- has_scope() — shop/page scope (Bible §11.6).
-- Scope NARROWS access; it never grants it. A caller with scope but no
-- permission still has nothing.
-- ----------------------------------------------------------------------------
create or replace function app_private.has_scope(p_scope_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      -- An unscoped record is not scope-restricted.
      when p_scope_id is null then app_private.is_active_staff()
      else exists (
        select 1
        from public.staff_scope_assignments sa
        join public.staff_profiles sp on sp.id = sa.staff_profile_id
        where sp.auth_user_id = (select auth.uid())
          and sp.is_active
          and sa.scope_id = p_scope_id
      )
    end;
$$;

comment on function app_private.has_scope(uuid) is
  'Shop/page scope check (Bible §11.6). Scope narrows access and never grants it — assignment is not permission.';

-- ----------------------------------------------------------------------------
-- is_owner() — Owner role, active. Authority still requires the explicit checks
-- below; this alone authorizes nothing.
-- ----------------------------------------------------------------------------
create or replace function app_private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_profiles sp
    where sp.auth_user_id = (select auth.uid())
      and sp.is_active
      and sp.role_key = 'owner'
  );
$$;

comment on function app_private.is_owner() is
  'True for an active Owner. The Owner role is the ONE place where identity is authority — and only for the six non-delegable actions (Bible §5.13).';

-- ----------------------------------------------------------------------------
-- current_auth_aal() — Authenticator Assurance Level from the verified JWT.
-- 'aal1' = password only; 'aal2' = a TOTP challenge was verified this session.
-- ----------------------------------------------------------------------------
create or replace function app_private.current_auth_aal()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal',
    'aal1'
  );
$$;

comment on function app_private.current_auth_aal() is
  'Authenticator Assurance Level from the verified JWT. aal1 = password only; aal2 = TOTP challenge verified. Defaults to aal1 (fails closed).';

-- ----------------------------------------------------------------------------
-- can_decide_owner_only_action() — the six non-delegable Owner approvals.
--
-- Requires an active Owner. Deliberately does NOT require aal2: Owner MFA is
-- required before PILOT/production, not in development, and locking it now would
-- prevent safe initial setup (an Owner cannot enroll TOTP if they cannot first
-- operate). MFA readiness is tracked separately by owner_mfa_ready().
-- ----------------------------------------------------------------------------
create or replace function app_private.can_decide_owner_only_action()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_owner();
$$;

comment on function app_private.can_decide_owner_only_action() is
  'Authority for the six non-delegable Owner approvals (Bible §5.13). Owner only; never delegable to Selected Admin or Staff.';

-- ----------------------------------------------------------------------------
-- owner_mfa_ready() — pilot/production readiness (ADR §5).
-- Owner MFA is REQUIRED before pilot and production. This reports the state; it
-- does not gate development.
-- ----------------------------------------------------------------------------
create or replace function app_private.owner_mfa_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select bool_and(sp.mfa_enrolled)
    from public.staff_profiles sp
    where sp.role_key = 'owner' and sp.is_active
  ), false);
$$;

comment on function app_private.owner_mfa_ready() is
  'Pilot/production readiness: true only when every active Owner has TOTP enrolled. Reports state; does not gate development.';

-- ----------------------------------------------------------------------------
-- Execution grants. The functions are readable-by-effect only; they expose no
-- data beyond a boolean/id about the CALLER themselves.
-- ----------------------------------------------------------------------------
grant execute on function
  app_private.current_staff_id(),
  app_private.current_staff_role(),
  app_private.is_active_staff(),
  app_private.has_permission(text),
  app_private.has_scope(uuid),
  app_private.is_owner(),
  app_private.current_auth_aal(),
  app_private.can_decide_owner_only_action(),
  app_private.owner_mfa_ready()
to authenticated;

-- anon gets nothing: there is no anonymous business access.
revoke all on schema app_private from anon;
grant usage on schema app_private to authenticated;
