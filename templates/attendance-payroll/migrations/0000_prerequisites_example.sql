-- ============================================================================
-- 0000 PREREQUISITES: EXAMPLE STUB ONLY.
-- ----------------------------------------------------------------------------
-- A real project REPLACES this file with its own identity, role and permission layer.
-- The template needs: roles anon, authenticated and service_role; auth.uid(); pgcrypto's digest
-- reachable as extensions.digest(text, text); schema app_private; an employees table with the
-- columns below (timekeeping_exempt is the column a host usually has to add, additively); a
-- permission grant table; and the helpers current_staff_id(), current_staff_role(),
-- is_active_staff(), is_owner() and has_permission(text) (DATABASE.md sections 5.1, 5.2, 5.13).
-- On a stack that already provides roles, auth.uid() and pgcrypto, the guarded blocks are no-ops.
-- CURRENT kept: helpers resolve the caller from auth.uid() alone, are sql stable security definer
-- with an empty search_path, and return a value instead of raising; the Super Admin (role key
-- owner) holds every permission implicitly (M/20260715130000:28-39; M/20260716240000:26-44).
-- RECOMMENDED TEMPLATE IMPROVEMENT: current_staff_id() returns null for an inactive profile (CURRENT
-- ignores is_active, M/20260715130000:35-38); current_staff_role() returns the non-NULL sentinel
-- 'inactive' for a deactivated profile, carried from PENDING (not live) M/20260916120000:46-57.
-- Rollback (scratch databases only): drop the helper functions, then employee_permission_grants and
-- employees, then the schemas and roles this file created.
-- ============================================================================

-- Roles, created only when missing. service_role is a server-only role that bypasses RLS.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

-- pgcrypto: sha256 digests of device tokens. Tokens are minted by the server (DV2), not in SQL.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $$
begin
  if pg_catalog.to_regprocedure('extensions.digest(text,text)') is null then
    raise exception 'pgcrypto must be reachable as extensions.digest(text, text).';
  end if;
end $$;

-- auth.uid() stub for plain PostgreSQL: reads the JWT subject claim, so a test can SET
-- request.jwt.claim.sub. Skipped when the platform already provides auth.uid().
create schema if not exists auth;
do $do$
begin
  if pg_catalog.to_regprocedure('auth.uid()') is null then
    execute $fn$
      create function auth.uid() returns uuid language sql stable set search_path = '' as $body$
        select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                               nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid
      $body$
    $fn$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  end if;
end $do$;

-- Private helper schema. anon has no usage; the signed-in role needs usage because RLS policies and
-- the INVOKER wrapper report_payroll call private functions as the caller.
create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated, service_role;

-- Minimal identity table; the host's real table needs at least these columns.
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  role_key text not null check (role_key in ('owner', 'selected_admin', 'staff')),
  is_active boolean not null default true,
  is_demo boolean not null default false,
  timekeeping_exempt boolean not null default false,   -- set by the trigger in 0001 from exclusions.excludedRoles
  created_at timestamptz not null default now()
);

-- Explicit permission grants (the Super Admin needs none).
create table if not exists public.employee_permission_grants (
  employee_id uuid not null references public.employees (id) on delete cascade,
  permission_key text not null check (length(btrim(permission_key)) between 1 and 80),
  granted_at timestamptz not null default now(),
  primary key (employee_id, permission_key)
);

create or replace function app_private.current_staff_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select e.id from public.employees e where e.auth_user_id = (select auth.uid()) and e.is_active limit 1
$$;

-- Role title only; never authority. 'inactive' for a deactivated profile; null only without a profile.
create or replace function app_private.current_staff_role() returns text
language sql stable security definer set search_path = '' as $$
  select case when e.is_active then e.role_key else 'inactive' end
  from public.employees e where e.auth_user_id = (select auth.uid()) limit 1
$$;

create or replace function app_private.is_active_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employees e where e.auth_user_id = (select auth.uid()) and e.is_active)
$$;

create or replace function app_private.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.employees e where e.auth_user_id = (select auth.uid()) and e.is_active and e.role_key = 'owner'
  )
$$;

create or replace function app_private.has_permission(p_permission_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.is_owner() or exists (
    select 1 from public.employee_permission_grants g join public.employees e on e.id = g.employee_id
    where e.auth_user_id = (select auth.uid()) and e.is_active and g.permission_key = p_permission_key
  )
$$;

revoke all on function app_private.current_staff_id(), app_private.current_staff_role(), app_private.is_active_staff(),
  app_private.is_owner(), app_private.has_permission(text) from public, anon;
grant execute on function app_private.current_staff_id(), app_private.current_staff_role(), app_private.is_active_staff(),
  app_private.is_owner(), app_private.has_permission(text) to authenticated, service_role;

-- RLS on the stub tables, as CURRENT: own row or the Super Admin (DATABASE.md 5.2). Names for
-- operators and reviewers come from the definer readers in 0006, never from this table.
alter table public.employees enable row level security;
alter table public.employees force row level security;
revoke all on public.employees from public, anon, authenticated;
drop policy if exists employees_read on public.employees;
create policy employees_read on public.employees for select to authenticated
  using (id = app_private.current_staff_id() or app_private.is_owner());
grant select on public.employees to authenticated;

alter table public.employee_permission_grants enable row level security;
alter table public.employee_permission_grants force row level security;
revoke all on public.employee_permission_grants from public, anon, authenticated;
drop policy if exists employee_permission_grants_read on public.employee_permission_grants;
create policy employee_permission_grants_read on public.employee_permission_grants for select to authenticated
  using (employee_id = app_private.current_staff_id() or app_private.is_owner());
grant select on public.employee_permission_grants to authenticated;
