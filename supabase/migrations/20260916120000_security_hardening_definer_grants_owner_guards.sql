-- ============================================================================
-- Security + integrity hardening (system audit 2026-09-16). NOT APPLIED TO PRODUCTION yet.
-- Apply AFTER 20260913120000 / 20260913130000 / 20260915120000, in file order.
--
-- Every change here is ADDITIVE or a tightening of an existing gate; no data is deleted or
-- renamed. Each section states what it fixes and how to roll it back.
--
--   §1  current_staff_role() returns the sentinel 'inactive' for a DEACTIVATED profile — 18 RPCs
--       gate on the role title alone, so a deactivated Owner/Admin JWT still passed them at the
--       DB layer. A sentinel (not NULL) is essential: `NULL <> 'owner'` / `NULL not in (...)`
--       are NULL, which SKIPS every `if … then raise` gate and would have opened them wider.
--   §2  Every public SECURITY DEFINER function loses PUBLIC/anon EXECUTE (Supabase default
--       privileges re-grant anon on each CREATE; 20 functions had never been revoked). REVOKE
--       ONLY — no grant is added anywhere, so a live-only function that is deliberately
--       service_role-only is never widened. The two webhook persisters that were granted to
--       `authenticated` with NO internal gate become service_role-only — a signed-in JWT could
--       rewrite which Facebook conversation a customer's messages route to.
--   §3  order_completion_block() gains an active-staff gate (it was the one ungated + anon-open
--       function: order status probing by uuid).
--   §4  delete_team_member() refuses an Owner target (only the UI hid the button).
--   §5  Owner floor: the last active, non-demo Owner can never be demoted, deactivated, or deleted
--       (serialized with a table lock so two Owners removing each other cannot both succeed).
--   §6  audit_events read narrowed to Owner / Selected Admin / view_settings holders (was every
--       active staff, `context` included).
--   §7  Payment verification becomes atomic: an AFTER INSERT trigger on payment_verifications
--       sets payments.status, so the two-step web write can no longer leave verified money
--       uncounted forever. Rows ALREADY stuck are reported (NOTICE), never changed automatically.
--   §8  attendance_records.work_date defaults to the MANILA business date (was UTC current_date,
--       so a 00:00–08:00 clock-in landed on the previous payroll day).
--   §9  revoke_staff_sessions(): Owner-gated revocation of every session a member holds, so a
--       deactivation or an Owner-set password takes effect on every device immediately (the
--       Supabase admin signOut API needs the member's own JWT, which the Owner never has). Also
--       ends the sessions of accounts deactivated BEFORE this migration.
--   §10 kiosk_clock_in() refuses an unregistered or revoked device id whenever a time-clock device
--       is registered (the approved-device rule was enforced in app code only).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1  Role title only for ACTIVE staff; 'inactive' for a deactivated profile.
-- NULL is kept ONLY when there is no profile at all (cron / service role), exactly as before, so
-- no system path changes. Every existing gate style refuses the sentinel: `<> 'owner'`,
-- `not in ('owner','selected_admin')`, `= any(...)`, `is distinct from`, and
-- correct_attendance_clock_out's `v_role is null or v_role not in (...)`.
-- Rollback: re-create from 20260715130000_phase2_authz_helpers.sql.
-- ----------------------------------------------------------------------------
create or replace function app_private.current_staff_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when sp.is_active then sp.role_key else 'inactive' end
  from public.staff_profiles sp
  where sp.auth_user_id = (select auth.uid())
  limit 1;
$$;

comment on function app_private.current_staff_role() is
  'Role TITLE of the acting staff member; ''inactive'' for a deactivated profile; NULL only when '
  'auth.uid() has no profile (cron/service role). Never use this to infer a permission. The '
  'sentinel makes every role-title gate refuse a deactivated account (audit 2026-09-16).';

-- ----------------------------------------------------------------------------
-- §2  Definer-function EXECUTE hygiene, generically and idempotently.
-- For every SECURITY DEFINER function in `public`:
--   • revoke EXECUTE from PUBLIC and anon (removes the implicit/default grant);
--   • system-only functions (webhook persisters, *_system, share-link resolver, prune) also lose
--     `authenticated` and keep service_role only.
-- NOTHING is granted. Supabase's default privileges give `authenticated` and `service_role`
-- their OWN explicit EXECUTE on every function created by a migration (verified on prod by
-- 20260821120000), so revoking PUBLIC/anon removes nothing the web app or the capture phone
-- uses — and a function someone deliberately restricted stays restricted.
-- Rollback: grant execute … to anon on any function the advisor lists (none is expected).
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
  v_sig text;
  v_system_only boolean;
begin
  for r in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prokind = 'f'
  loop
    v_sig := format('public.%I(%s)', r.proname, r.args);
    v_system_only :=
      r.proname in (
        'webhook_store_pancake_live_comment',
        'webhook_upsert_conversation_identity',
        'resolve_capture_share_link',
        'sync_pancake_conversations_system',
        'set_customer_pancake_avatars_system',
        'prune_pancake_webhook_events',
        'post_due_layaway_interest_system'
      )
      or r.proname like '%\_system';

    execute format('revoke all on function %s from public, anon', v_sig);

    if v_system_only then
      execute format('revoke all on function %s from authenticated', v_sig);
      execute format('grant execute on function %s to service_role', v_sig);
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- §3  order_completion_block(): active-staff gate. Body otherwise identical to
--     20260818240000_order_completion_allow_pickup_delivery.sql.
-- ----------------------------------------------------------------------------
create or replace function public.order_completion_block(p_order_id uuid)
 returns text
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare v_status text; v_dest text; v_fstatus text; v_waybill text;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;

  select status, fulfillment_destination, waybill_number
    into v_status, v_dest, v_waybill
  from public.official_orders where id = p_order_id;
  if v_status is null then return 'Order not found.'; end if;
  if v_status = 'completed' then return 'This order is already completed.'; end if;
  if v_status = 'cancelled' then return 'A cancelled order cannot be completed.'; end if;
  if v_status = 'for_cancel' then return 'This order is awaiting a cancellation decision.'; end if;

  if not app_private.is_paid_in_full(p_order_id) then
    return 'This order is not fully paid yet.';
  end if;

  if v_dest = 'shipping' and coalesce(trim(v_waybill), '') = '' then
    return 'A waybill number is required before this shipping order can be completed.';
  end if;

  select status into v_fstatus from public.fulfillment_records where official_order_id = p_order_id;

  if v_status = 'for_layaway' then
    return 'Transfer this order to a fulfillment destination first.';
  end if;
  if v_status in ('keep', 'approved_for_release', 'exceptional_release_pending', 'dispatched_or_picked_up') then
    return null;
  end if;
  if v_dest in ('pickup', 'delivery') then
    return null;
  end if;
  if v_fstatus is null then
    return 'Fulfillment has not started for this order.';
  end if;
  if v_fstatus not in ('dispatched', 'delivered', 'picked_up', 'released', 'completed') then
    return 'Fulfillment is not finished yet.';
  end if;

  return null;
end;
$function$;

revoke all on function public.order_completion_block(uuid) from public, anon;
grant execute on function public.order_completion_block(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- §4  delete_team_member(): an Owner account is never hard-deleted through the app.
--     Demote it first (which §5 refuses for the last Owner). Body otherwise identical to
--     20260722120000_delete_team_member.sql.
-- ----------------------------------------------------------------------------
create or replace function public.delete_team_member(p_staff_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid;
  v_target_role text;
  v_caller uuid := auth.uid();
begin
  if not exists (
    select 1 from public.staff_profiles sp
    where sp.auth_user_id = v_caller
      and sp.role_key = 'owner'
      and sp.is_active
  ) then
    raise exception 'Not authorized';
  end if;

  select auth_user_id, role_key into v_auth_user_id, v_target_role
  from public.staff_profiles
  where id = p_staff_profile_id;

  if v_auth_user_id is null then
    raise exception 'Member not found';
  end if;

  if v_auth_user_id = v_caller then
    raise exception 'Cannot delete your own account';
  end if;

  if v_target_role = 'owner' then
    raise exception 'Cannot delete an Owner account. Change its role first.';
  end if;

  delete from public.notifications where staff_profile_id = p_staff_profile_id;
  delete from public.trusted_devices where staff_profile_id = p_staff_profile_id;
  delete from public.staff_scope_assignments where staff_profile_id = p_staff_profile_id;
  delete from public.staff_permission_grants where staff_profile_id = p_staff_profile_id;

  delete from public.staff_profiles where id = p_staff_profile_id;

  delete from auth.users where id = v_auth_user_id;
end;
$$;

revoke all on function public.delete_team_member(uuid) from public, anon;
grant execute on function public.delete_team_member(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- §5  Owner floor. At least one ACTIVE Owner must always remain: a change that would remove the
--     last one (role change, deactivation, or delete) is refused. Applies to every path — the
--     Settings RPCs, /admin/staff direct updates, and any future tool — because it is a trigger.
-- Rollback: drop trigger staff_profiles_owner_floor on public.staff_profiles;
-- ----------------------------------------------------------------------------
create or replace function app_private.enforce_owner_floor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_active_owner boolean;
  v_remains_active_owner boolean;
  v_others integer;
begin
  v_was_active_owner := (old.role_key = 'owner' and old.is_active);
  if not v_was_active_owner then
    return coalesce(new, old);
  end if;

  v_remains_active_owner :=
    tg_op = 'UPDATE' and new.role_key = 'owner' and new.is_active;
  if v_remains_active_owner then
    return new;
  end if;

  -- Serialize removals of an active Owner (same approach as the Selected Admin cap trigger):
  -- without it, two Owners deactivating each other concurrently each see the other as still
  -- active and both commits succeed. Only this rare path takes the lock.
  lock table public.staff_profiles in share row exclusive mode;

  -- Seeded demo/UAT owners (is_demo) cannot sign in on the live tenant, so they never count
  -- toward the floor.
  select count(*) into v_others
  from public.staff_profiles sp
  where sp.role_key = 'owner' and sp.is_active and not sp.is_demo and sp.id <> old.id;

  if v_others = 0 then
    raise exception
      'At least one active Owner must remain. Promote or reactivate another Owner first. No record was changed.'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

comment on function app_private.enforce_owner_floor() is
  'The last active, non-demo Owner cannot be demoted, deactivated, or deleted (audit 2026-09-16).';

drop trigger if exists staff_profiles_owner_floor on public.staff_profiles;
create trigger staff_profiles_owner_floor
  before update of role_key, is_active or delete on public.staff_profiles
  for each row execute function app_private.enforce_owner_floor();

-- ----------------------------------------------------------------------------
-- §6  Audit trail visibility. Reading the WHOLE append-only trail (sign-in attempts, team and
--     permission changes with member emails, exports) is an administrative capability: Owner,
--     Selected Admin, or a member explicitly granted view_settings. Every other active staff
--     member keeps exactly one slice — the per-order history timeline in the Order details
--     modal (src/lib/orders/detail.ts reads entity_type = 'official_order'), which is
--     operational and already visible to them. Writing is unchanged.
-- Rollback: create policy audit_read … using (app_private.is_active_staff());
-- ----------------------------------------------------------------------------
drop policy if exists audit_read on public.audit_events;
create policy audit_read on public.audit_events
  for select to authenticated
  using (
    app_private.is_owner()
    or app_private.current_staff_role() = 'selected_admin'
    or app_private.has_permission('view_settings')
    or (app_private.is_active_staff() and entity_type = 'official_order')
  );

-- ----------------------------------------------------------------------------
-- §7  Atomic payment verification. The web flow inserts payment_verifications and THEN updates
--     payments.status; verified money only counts when BOTH say verified, and a failed second
--     write left the payment stuck (every retry short-circuits on "already decided"). The
--     trigger performs the status write inside the same transaction as the decision, so the
--     two rows can never disagree. The web update that follows becomes a harmless no-op.
-- Rollback: drop trigger payment_verifications_sync_status on public.payment_verifications;
-- ----------------------------------------------------------------------------
create or replace function app_private.sync_payment_status_from_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.outcome = 'verified' then
    update public.payments
       set status = 'verified'
     where id = new.payment_id
       and status = 'submitted_unverified';
  elsif new.outcome = 'rejected' then
    update public.payments
       set status = 'rejected'
     where id = new.payment_id
       and status = 'submitted_unverified';
  end if;
  return new;
end;
$$;

comment on function app_private.sync_payment_status_from_verification() is
  'Keeps payments.status in the same transaction as the verification decision (audit 2026-09-16).';

drop trigger if exists payment_verifications_sync_status on public.payment_verifications;
create trigger payment_verifications_sync_status
  after insert on public.payment_verifications
  for each row execute function app_private.sync_payment_status_from_verification();

-- Payments ALREADY stuck in the half-written state (decision recorded, status never advanced)
-- are REPORTED, not rewritten: flipping historical rows to 'verified' at migration time would
-- make old money count without re-checking the order balance, and would fire every live-only
-- UPDATE trigger on payments (e.g. closed-day locks) inside this migration. The Owner reviews
-- them with:
--   select p.id, p.official_order_id, p.amount, v.outcome, v.decided_at
--   from public.payments p join public.payment_verifications v on v.payment_id = p.id
--   where p.status = 'submitted_unverified' and v.outcome in ('verified','rejected');
do $$
declare
  v_stuck integer;
begin
  select count(*) into v_stuck
  from public.payments p
  join public.payment_verifications v on v.payment_id = p.id
  where p.status = 'submitted_unverified'
    and v.outcome in ('verified', 'rejected');
  if v_stuck > 0 then
    raise notice
      'audit 2026-09-16: % payment(s) have a recorded verification decision but still read submitted_unverified. NOT changed — review manually (query in the §7 comment).',
      v_stuck;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- §8  Attendance business date = Manila. kiosk_clock_in already stamps it; the web Owner
--     clock-in relied on the column default (UTC). Existing rows are not rewritten.
-- Rollback: alter column work_date set default current_date;
-- ----------------------------------------------------------------------------
alter table public.attendance_records
  alter column work_date set default ((now() at time zone 'Asia/Manila')::date);

-- ----------------------------------------------------------------------------
-- §9  Revoke every session of a staff member. Deleting auth.sessions cascades to that
--     session's refresh tokens (GoTrue schema), so no device can renew its access token; the
--     remaining short-lived access token is already refused by RLS (is_active_staff) and by the
--     web/mobile guards on a deactivated account. Owner-only; never the caller's own sessions
--     (an Owner changing their own password keeps the device they are using).
-- Rollback: drop function public.revoke_staff_sessions(uuid);
-- ----------------------------------------------------------------------------
create or replace function public.revoke_staff_sessions(p_staff_profile_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid;
  v_count integer;
begin
  if not app_private.is_owner() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;

  select sp.auth_user_id into v_auth_user_id
  from public.staff_profiles sp
  where sp.id = p_staff_profile_id;

  if v_auth_user_id is null then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;

  if v_auth_user_id = (select auth.uid()) then
    return 0;
  end if;

  delete from auth.sessions where user_id = v_auth_user_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.revoke_staff_sessions(uuid) is
  'Owner-only: ends every session (and its refresh tokens) of another staff member (audit 2026-09-16).';

revoke all on function public.revoke_staff_sessions(uuid) from public, anon;
grant execute on function public.revoke_staff_sessions(uuid) to authenticated, service_role;

-- One-off (§9): accounts deactivated BEFORE this migration still hold refresh tokens, and the
-- per-deactivation revoke only runs from now on. End those sessions now. Only rows whose staff
-- profile is already inactive are touched; active members stay signed in.
delete from auth.sessions s
 using public.staff_profiles sp
 where sp.auth_user_id = s.user_id
   and not sp.is_active;

-- ----------------------------------------------------------------------------
-- §10 kiosk_clock_in(): approved-device rule at the DB layer. The app resolves the device from its
--     signed cookie and passes the id; a direct RPC call could pass a random or REVOKED device id
--     (or none) and clock anyone in from anywhere. Mirrors the app gate exactly: the rule binds only
--     while at least one time-clock device is registered (attendance_gating_active()), so a shop
--     with no registered device keeps working as before. Body otherwise identical to
--     20260907120000 (Manila work_date, active/non-demo target, one open session).
--     Residual (tracked, not fixed here): an active device id is visible to staff in their own
--     attendance rows; binding the call to the device TOKEN needs an RPC signature change.
-- Rollback: re-create from 20260907120000.
-- ----------------------------------------------------------------------------
create or replace function public.kiosk_clock_in(p_staff_id uuid, p_device_id uuid, p_note text)
  returns uuid
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_id uuid;
  v_active boolean;
  v_demo boolean;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized: only active staff may operate the time clock.'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.attendance_devices d where d.is_active) then
    if p_device_id is null or not exists (
      select 1 from public.attendance_devices d
      where d.id = p_device_id and d.is_active and d.revoked_at is null
    ) then
      raise exception 'This device is not an approved time clock.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  select sp.is_active, sp.is_demo into v_active, v_demo
  from public.staff_profiles sp where sp.id = p_staff_id;
  if v_active is null then
    raise exception 'That team member could not be found.';
  end if;
  if not v_active or v_demo then
    raise exception 'That team member is inactive and cannot clock in.';
  end if;

  begin
    insert into public.attendance_records (staff_profile_id, note, device_id, work_date)
    values (
      p_staff_id,
      nullif(btrim(p_note), ''),
      p_device_id,
      (now() at time zone 'Asia/Manila')::date
    )
    returning id into v_id;
  exception when unique_violation then
    raise exception 'That team member is already clocked in. Clock out first.';
  end;

  return v_id;
end;
$function$;

revoke all on function public.kiosk_clock_in(uuid, uuid, text) from public, anon;
grant execute on function public.kiosk_clock_in(uuid, uuid, text) to authenticated, service_role;
