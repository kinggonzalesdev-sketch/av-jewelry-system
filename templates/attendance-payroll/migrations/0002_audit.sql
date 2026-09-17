-- ============================================================================
-- 0002 AUDIT: the SQL-side audit writer and the attendance and payroll read policy.
-- ----------------------------------------------------------------------------
-- CURRENT: public.audit_events is append-only with forced RLS (M/20260715120000:74-137); application
-- code writes rows after the RPC returns, best effort (never throws, insert result unchecked,
-- src/lib/audit/log.ts:40-64); no repository SQL function of this feature writes one
-- (M/20260907130000:13-63); every active staff member reads every row (M/20260715130100:661-662).
-- A corrected clock-out keeps its old value only in that event; a hard delete keeps nothing.
-- GENERIC (DATABASE.md 5.11): keep the host's audit_events table; add the definer writer
-- app_private.record_audit_event. Every successful write function of 0004 to 0007 inserts its row
-- through it, inside its own transaction, so a direct RPC call leaves the same trace as the UI.
-- Refusals (IMPLEMENTATION_PROMPT.md B12, question Q23): this template takes path (b) everywhere.
-- Functions raise (SQLSTATE 42501 for authority, the error code in the hint otherwise) and the
-- server layer writes the denied or failed row after the error has returned (SERVER_API.md 9.1 rule
-- 8). A raise rolls back any row its transaction inserted, so no function inserts a row and then
-- raises. A direct RPC call that is refused therefore leaves no row: choose path (a) per function
-- if that matters to the client.
-- When audit.payloadIncludesAmounts is false, contexts hold ids and change markers, not money.
-- The table below is created ONLY when the host has none. A host table keeps its own triggers and
-- policies; remove any permissive SELECT policy wider than audit_events_read_hr, because Postgres
-- combines permissive policies with OR (NEEDS VERIFICATION on each host).
-- RECOMMENDED TEMPLATE IMPROVEMENTS: SQL-side success rows; reads narrowed to payroll.view_all for
-- payroll.* rows and attendance.review for attendance.* rows.
-- Rollback: drop policy audit_events_read_hr; drop function app_private.record_audit_event; drop the
-- table, its triggers and app_private.audit_events_refuse_change only on a database where this file
-- created them.
-- ============================================================================

create or replace function app_private.audit_events_refuse_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Audit rows are append-only (% refused).', tg_op using hint = 'conflict';
end $$;
revoke all on function app_private.audit_events_refuse_change() from public, anon, authenticated;

do $$
begin
  if pg_catalog.to_regclass('public.audit_events') is null then
    create table public.audit_events (
      id uuid primary key default gen_random_uuid(),
      occurred_at timestamptz not null default now(),
      actor_auth_uid uuid,
      actor_kind text not null default 'staff' check (actor_kind in ('staff', 'system', 'migration')),
      actor_label text,
      action text not null check (length(action) between 1 and 120),
      entity_type text not null check (length(entity_type) between 1 and 80),
      entity_id uuid,
      outcome text not null default 'succeeded' check (outcome in ('succeeded', 'failed', 'denied')),
      reason text,
      context jsonb not null default '{}'::jsonb,
      constraint audit_events_system_actor_ck check (actor_kind <> 'system' or actor_auth_uid is null)
    );
    create index audit_events_entity_idx on public.audit_events (entity_type, entity_id, occurred_at desc);
    create index audit_events_actor_idx on public.audit_events (actor_auth_uid, occurred_at desc);
    create trigger audit_events_no_update before update on public.audit_events
      for each row execute function app_private.audit_events_refuse_change();
    create trigger audit_events_no_delete before delete on public.audit_events
      for each row execute function app_private.audit_events_refuse_change();
    alter table public.audit_events enable row level security;
    alter table public.audit_events force row level security;
    revoke all on public.audit_events from public, anon, authenticated;
    -- The server layer writes refusal rows as the signed-in caller (CURRENT self-attributed insert,
    -- M/20260715130100:664-670).
    create policy audit_events_insert_self_attributed on public.audit_events for insert to authenticated
      with check (app_private.is_active_staff() and actor_auth_uid = (select auth.uid()) and actor_kind = 'staff');
    grant select, insert on public.audit_events to authenticated;
  end if;
end $$;

-- Internal writer. No end-user EXECUTE: a grant to authenticated would let anyone write
-- "succeeded" rows under their own name for actions they never performed.
create or replace function app_private.record_audit_event(
  p_action text, p_entity_type text, p_entity_id uuid, p_outcome text, p_reason text, p_context jsonb
) returns uuid language sql security definer set search_path = '' as $$
  insert into public.audit_events
    (actor_auth_uid, actor_kind, actor_label, action, entity_type, entity_id, outcome, reason, context)
  values (
    (select auth.uid()), 'staff',
    (select e.full_name from public.employees e where e.id = app_private.current_staff_id()),
    p_action, p_entity_type, p_entity_id, coalesce(p_outcome, 'succeeded'), p_reason, coalesce(p_context, '{}'::jsonb)
  )
  returning id
$$;
revoke all on function app_private.record_audit_event(text, text, uuid, text, text, jsonb) from public, anon, authenticated;

-- DATABASE.md 5.11 read policy. The Super Admin passes through has_permission.
drop policy if exists audit_events_read_hr on public.audit_events;
create policy audit_events_read_hr on public.audit_events for select to authenticated
  using ((action like 'payroll.%' and app_private.has_permission('payroll.view_all'))
      or (action like 'attendance.%' and app_private.has_permission('attendance.review')));
grant select on public.audit_events to authenticated;
