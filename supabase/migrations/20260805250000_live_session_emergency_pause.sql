-- Emergency Controls (live-readiness): the Super Admin can PAUSE live selling to stop
-- all NEW order/capture intake instantly (e.g. something went wrong mid-live), then
-- RESUME. Enforced by a single BEFORE INSERT gate on official_orders + capture_records
-- so every intake path (New Order, Walk-In, Capture) is covered in one place. Purely
-- additive and inert unless a live session is ACTIVE and paused — normal day-to-day
-- operation (no active session) is never affected. Existing orders keep working
-- (payments, fulfillment) — pause only blocks taking NEW orders.

alter table public.live_sessions
  add column if not exists paused_at timestamptz,
  add column if not exists paused_by uuid references public.staff_profiles(id);

-- True only while an active live session is paused.
create or replace function app_private.is_live_selling_paused()
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.live_sessions where active and paused_at is not null
  );
$$;

-- BEFORE INSERT gate: refuse new order/capture intake while paused. Inert otherwise.
create or replace function app_private.block_intake_when_paused()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if app_private.is_live_selling_paused() then
    raise exception 'Live selling is paused. Resume it in Live Operations before taking new orders.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists official_orders_block_when_paused on public.official_orders;
create trigger official_orders_block_when_paused
  before insert on public.official_orders
  for each row execute function app_private.block_intake_when_paused();

drop trigger if exists capture_records_block_when_paused on public.capture_records;
create trigger capture_records_block_when_paused
  before insert on public.capture_records
  for each row execute function app_private.block_intake_when_paused();

-- Pause / resume the ACTIVE live session (Super Admin only). Idempotent.
create or replace function public.pause_live_session()
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_id uuid;
begin
  if not app_private.is_owner() then
    raise exception 'Only the Super Admin can pause live selling.'
      using errcode = 'insufficient_privilege';
  end if;
  select id into v_id from public.live_sessions where active limit 1;
  if v_id is null then
    raise exception 'There is no active live session to pause.' using errcode = 'no_data_found';
  end if;
  update public.live_sessions
    set paused_at = coalesce(paused_at, now()),
        paused_by = coalesce(paused_by, app_private.current_staff_id()),
        updated_at = now()
    where id = v_id;
  return jsonb_build_object('session_id', v_id, 'paused', true);
end;
$$;

create or replace function public.resume_live_session()
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_id uuid;
begin
  if not app_private.is_owner() then
    raise exception 'Only the Super Admin can resume live selling.'
      using errcode = 'insufficient_privilege';
  end if;
  select id into v_id from public.live_sessions where active limit 1;
  if v_id is null then
    raise exception 'There is no active live session to resume.' using errcode = 'no_data_found';
  end if;
  update public.live_sessions
    set paused_at = null, paused_by = null, updated_at = now()
    where id = v_id;
  return jsonb_build_object('session_id', v_id, 'paused', false);
end;
$$;

revoke all on function public.pause_live_session() from public;
revoke all on function public.resume_live_session() from public;
grant execute on function public.pause_live_session() to authenticated;
grant execute on function public.resume_live_session() to authenticated;
