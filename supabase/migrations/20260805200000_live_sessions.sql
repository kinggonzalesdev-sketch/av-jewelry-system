-- Live Session (Owner request, §3). A named session the Super Admin starts before a
-- live: operator, devices, page, Review/Automatic, Test/Production. Only ONE can be
-- active (partial unique index), and its id is stamped onto every screenshot, order,
-- invoice, and print job created while it runs. Additive: a new table + nullable
-- columns + a widened stamp trigger. Starting a TEST session also flips Test Mode on
-- (so the inventory/message safety already shipped applies); ending it flips it off.

create table if not exists public.live_sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  operator_staff_id uuid references public.staff_profiles(id),
  screenshot_device text,
  printer_device text,
  facebook_page_id text,
  mode text not null default 'review' check (mode in ('review', 'automatic')),
  is_test boolean not null default false,
  active boolean not null default true,
  started_by uuid references public.staff_profiles(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  updated_at timestamptz not null default now()
);
-- At most one active session controls automatic printing at a time (§3).
create unique index if not exists live_sessions_one_active
  on public.live_sessions (active) where active;

alter table public.live_sessions enable row level security;
drop policy if exists live_sessions_read on public.live_sessions;
create policy live_sessions_read on public.live_sessions
  for select to authenticated using (app_private.is_active_staff());

create or replace function app_private.current_live_session()
returns uuid
language sql
stable
security definer
set search_path to ''
as $function$
  select id from public.live_sessions where active limit 1;
$function$;

-- live_session_id on the same transactional tables that carry is_test.
alter table public.capture_records   add column if not exists live_session_id uuid references public.live_sessions(id);
alter table public.official_orders   add column if not exists live_session_id uuid references public.live_sessions(id);
alter table public.customer_messages add column if not exists live_session_id uuid references public.live_sessions(id);
alter table public.payments          add column if not exists live_session_id uuid references public.live_sessions(id);
alter table public.label_jobs        add column if not exists live_session_id uuid references public.live_sessions(id);
alter table public.order_reminders   add column if not exists live_session_id uuid references public.live_sessions(id);

-- Widen the existing stamp trigger to set BOTH is_test and the active session id.
create or replace function app_private.stamp_is_test()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  new.is_test := app_private.is_test_mode();
  new.live_session_id := coalesce(new.live_session_id, app_private.current_live_session());
  return new;
end;
$function$;

create or replace function public.start_live_session(
  p_name text,
  p_operator uuid,
  p_screenshot_device text,
  p_printer_device text,
  p_facebook_page_id text,
  p_mode text,
  p_is_test boolean
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare v_id uuid;
begin
  if not app_private.is_owner() then
    raise exception 'Only the Super Admin can start a live session.'
      using errcode = 'insufficient_privilege';
  end if;
  -- End any currently-active session first (keeps the one-active invariant).
  update public.live_sessions set active = false, ended_at = now(), updated_at = now() where active;
  insert into public.live_sessions
    (name, operator_staff_id, screenshot_device, printer_device, facebook_page_id, mode, is_test, active, started_by)
  values (
    coalesce(nullif(trim(p_name), ''), 'Live Session'),
    p_operator,
    nullif(trim(p_screenshot_device), ''),
    nullif(trim(p_printer_device), ''),
    nullif(trim(p_facebook_page_id), ''),
    case when p_mode in ('review', 'automatic') then p_mode else 'review' end,
    coalesce(p_is_test, false),
    true,
    app_private.current_staff_id()
  )
  returning id into v_id;
  -- A test session turns Test Mode ON so inventory/message safety applies.
  if coalesce(p_is_test, false) then perform public.set_test_mode(true); end if;
  return v_id;
end;
$function$;

create or replace function public.end_live_session()
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare v_was_test boolean;
begin
  if not app_private.is_owner() then
    raise exception 'Only the Super Admin can end a live session.'
      using errcode = 'insufficient_privilege';
  end if;
  select is_test into v_was_test from public.live_sessions where active limit 1;
  update public.live_sessions set active = false, ended_at = now(), updated_at = now() where active;
  -- Ending a test session turns Test Mode back off.
  if coalesce(v_was_test, false) then perform public.set_test_mode(false); end if;
  return true;
end;
$function$;

-- Realtime so the session banner/state updates on every device.
alter table public.live_sessions replica identity full;
alter publication supabase_realtime add table public.live_sessions;