-- ============================================================================
-- Attendance: automatic overtime + clock-in selfie.
-- ----------------------------------------------------------------------------
-- 1) OVERTIME is decided by the DATABASE from the real clock-in instant, never
--    from client input. A session that starts at or after 10:00 PM Asia/Manila
--    is overtime and carries a flat ₱300.00 overtime amount. Money stays numeric
--    in SQL and crosses to the client as a string.
-- 2) The clock-in SELFIE reuses the existing, tested attachments pipeline + RLS
--    via a new 'attendance_record' attachable surface (an additive CHECK change).
-- ============================================================================

alter table public.attendance_records
  add column if not exists is_overtime boolean not null default false,
  add column if not exists overtime_amount numeric(10, 2) not null default 0
    check (overtime_amount >= 0);

comment on column public.attendance_records.is_overtime is
  'True when the session started at/after 10 PM Asia/Manila. Set by trigger from time_in — never client input (Bible §F).';
comment on column public.attendance_records.overtime_amount is
  'Flat overtime pay for a >=10 PM clock-in (provisional ₱300). Numeric in SQL; a string on the wire. Set by trigger, not by the client.';

-- The boundary is decided from the ACTUAL clock-in time in Manila local time, and
-- this OVERWRITES whatever the row carried — a caller cannot move the line or set
-- its own overtime pay. Column defaults are applied before this BEFORE trigger, so
-- new.time_in already holds the default now() when the client sent none.
create or replace function public.attendance_apply_overtime()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_hour integer;
begin
  v_hour := extract(hour from (coalesce(new.time_in, now()) at time zone 'Asia/Manila'));
  if v_hour >= 22 then
    new.is_overtime := true;
    new.overtime_amount := 300.00;
  else
    new.is_overtime := false;
    new.overtime_amount := 0;
  end if;
  return new;
end;
$function$;

drop trigger if exists attendance_apply_overtime_biu on public.attendance_records;
create trigger attendance_apply_overtime_biu
  before insert on public.attendance_records
  for each row execute function public.attendance_apply_overtime();

-- Extend the attachable-surface set so a clock-in selfie can attach to an
-- attendance record through the existing attachments plumbing and RLS. Additive
-- only: no existing value is removed.
alter table public.attachments
  drop constraint attachments_related_entity_type_check;
alter table public.attachments
  add constraint attachments_related_entity_type_check
  check (related_entity_type in (
    'order',
    'payment',
    'layaway',
    'inventory_item',
    'customer',
    'fulfillment',
    'claim',
    'live_batch',
    'attendance_record'
  ));

insert into app_private.provisional_fields (table_name, column_name, bible_reference, note) values
  ('attendance_records', 'overtime_amount', '§F',
   'Provisional flat overtime pay (₱300) for a clock-in at/after 10 PM Asia/Manila. The rate and the 10 PM threshold await Owner confirmation.')
on conflict (table_name, column_name) do nothing;
