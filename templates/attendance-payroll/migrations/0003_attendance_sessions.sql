-- ============================================================================
-- 0003 ATTENDANCE SESSIONS: one row per session (clock in to clock out). DATABASE.md 5.3.
-- ----------------------------------------------------------------------------
-- CURRENT kept: one row per session; a day is the group (employee_id, work_date) whose total is the
-- sum of its completed sessions (src/lib/hr/sessions.ts:4-17; M/20260907160000:39-55); at most one
-- open session per member through a unique partial index (M/20260717120000:41-45); clock-out never
-- before clock-in (:32); RLS enabled AND forced (:47-48); no stored status (open = time_out is null).
-- RECOMMENDED TEMPLATE IMPROVEMENTS:
--   * No INSERT, UPDATE or DELETE policy or grant for authenticated. CURRENT grants insert and update
--     with self-scoped policies (M/20260717120000:58-75), so a member can write their own times through
--     the data API. Writes go through the definer functions of 0006.
--   * work_date defaults to the BUSINESS date (CURRENT default current_date is the UTC date,
--     M/20260717120000:25; forward-fixed only inside the clock-in function, M/20260907120000:1-8, 45).
--   * Operator, clock-out device and edited_at recorded; optional soft delete (attendance.deletion.mode).
--   * No stored night flag and no night trigger: payroll and badges call app_private.is_night_session.
--   * Team reads need attendance.view_team (CURRENT: hr_review_attendance, M/20260804140000:8-14).
-- Readers exclude soft-deleted rows (deleted_at is not null); RLS keeps them visible for audit.
-- Rollback: drop table public.attendance_sessions (and its dependants in 0004 to 0006 first).
-- ============================================================================

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  work_date date not null default app_private.business_today(),
  time_in timestamptz not null default now(),
  time_out timestamptz,
  note text check (note is null or length(btrim(note)) <= 500),
  clock_in_device_id uuid,                 -- foreign key added in 0004
  clock_out_device_id uuid,                -- foreign key added in 0004
  clock_in_by uuid not null references public.employees (id) on delete restrict,
  clock_out_by uuid references public.employees (id) on delete restrict,
  edited_by uuid references public.employees (id) on delete restrict,
  edited_at timestamptz,
  edit_reason text,
  deleted_at timestamptz,
  deleted_by uuid references public.employees (id) on delete restrict,
  delete_reason text,
  created_at timestamptz not null default now(),
  constraint attendance_sessions_out_after_in check (time_out is null or time_out >= time_in),
  constraint attendance_sessions_out_pair check ((time_out is null) = (clock_out_by is null)),
  constraint attendance_sessions_edit_triplet
    check ((edited_by is null) = (edited_at is null) and (edited_by is null) = (edit_reason is null)),
  constraint attendance_sessions_delete_triplet
    check ((deleted_at is null) = (deleted_by is null) and (deleted_at is null) = (delete_reason is null))
);

-- One open session per member; a repeated clock-in raises unique_violation, which kiosk_clock_in maps
-- to "already clocked in" (CURRENT message M/20260907120000:48-49). Soft-deleted rows are ignored.
create unique index if not exists attendance_sessions_one_open_uq on public.attendance_sessions (employee_id)
  where time_out is null and deleted_at is null;
create index if not exists attendance_sessions_emp_date_idx on public.attendance_sessions (employee_id, work_date desc);
create index if not exists attendance_sessions_work_date_idx on public.attendance_sessions (work_date, employee_id);
create index if not exists attendance_sessions_time_in_idx on public.attendance_sessions (time_in desc);

alter table public.attendance_sessions enable row level security;
alter table public.attendance_sessions force row level security;
revoke all on public.attendance_sessions from public, anon, authenticated;

drop policy if exists attendance_sessions_read on public.attendance_sessions;
create policy attendance_sessions_read on public.attendance_sessions for select to authenticated
  using (employee_id = app_private.current_staff_id() or app_private.has_permission('attendance.view_team'));

grant select on public.attendance_sessions to authenticated;
