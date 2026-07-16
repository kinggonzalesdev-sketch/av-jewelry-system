-- ============================================================================
-- Owner authorization: the Owner is the main administrator (Bible §5).
-- ----------------------------------------------------------------------------
-- Owner-approved change. Previously has_permission() read explicit grants only
-- and ignored role entirely, so an Owner with no grants held NO operational
-- permission. That produced an Owner account that could not operate the system
-- it administers.
--
-- New rule, applied at the single source of permission truth:
--
--     has_permission(key) = is_owner()  OR  an explicit grant exists
--
-- The Owner role now holds EVERY permission by an explicit owner-level rule —
-- not by a role→permission table, and not merely by the visible label. All
-- OTHER roles (Selected Admin, Staff) still hold ONLY their explicit grants:
-- role title remains not-authority for them (Bible §5.13).
--
-- This does NOT widen the six non-delegable Owner approvals or bypass any
-- guarantee: those actions are gated by the owner_approval_requests state
-- machine + requireOwnerApprovalAuthority(), and verified-payment correction by
-- its own trigger — none of which consult has_permission(). Making the Owner
-- hold all permissions therefore changes what the Owner may OPERATE, never how
-- approvals, execute-once, or verified-money protections are enforced.
-- ============================================================================

create or replace function app_private.has_permission(p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- The Owner is the highest authority (§5) and holds every permission.
  select app_private.is_owner()
  -- Everyone else: explicit grants only (§5.13). Inactive accounts hold nothing.
  or exists (
    select 1
    from public.staff_permission_grants g
    join public.staff_profiles sp on sp.id = g.staff_profile_id
    where sp.auth_user_id = (select auth.uid())
      and sp.is_active
      and g.permission_key = p_permission_key
  );
$$;

comment on function app_private.has_permission(text) is
  'Permission truth. The Owner holds every permission by an explicit owner-level rule (Bible §5); all other roles hold only explicit grants and role title is not authority (Bible §5.13). Inactive accounts hold nothing. Does NOT gate the six non-delegable approvals — those use the owner-approval state machine.';

comment on function app_private.is_owner() is
  'True for an active Owner. Identity IS authority for the Owner (Bible §5): the Owner is the main administrator and, through has_permission(), holds every permission. Still the only role for which identity is authority.';
