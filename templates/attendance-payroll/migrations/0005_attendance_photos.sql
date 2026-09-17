-- ============================================================================
-- 0005 ATTENDANCE PHOTOS: clock-in and clock-out photo metadata. DATABASE.md 5.7; IMPLEMENTATION_PROMPT.md PH1 to PH7.
-- ----------------------------------------------------------------------------
-- CURRENT: photos reuse a polymorphic attachments table with no foreign key; in versus out is
-- inferred from a file-name substring (src/lib/hr/attendance.ts:505); any active staff member may
-- read every photo row and object and insert any self-attributed row (M/20260716300000:127-129,
-- 137-142, 159-165); a deleted session leaves its photo behind.
-- RECOMMENDED TEMPLATE IMPROVEMENTS: a real foreign key; an explicit kind; one photo per session and
-- kind; reads limited to the subject and attendance.review holders; inserts only through
-- attach_attendance_photo, which requires attendance.clock_operate, the operator recorded on that
-- session for that kind, and a storage path under that session's prefix for that kind.
-- attendance.selfie.mode = required is not built (the settings store and the configuration refuse it).
-- Storage (platform-specific, not created here):
--   * A dedicated PRIVATE bucket. Object path: <session id>/<kind>.<jpg|jpeg|png|webp>.
--   * Uploads: a server-issued signed upload URL for that one path after the same operator check, or
--     an object INSERT policy scoped to the bucket, the path prefix and the recorded operator. Never
--     an "any active account" insert policy; no UPDATE or DELETE policy for end users.
--   * Reads: an object SELECT policy with the attendance_photos_read predicate joined on the first
--     path segment; bytes served through short-lived signed URLs (retention.signedUrlTtlSeconds).
--   * Retention and removal after a delete run as a scheduled server job on the Storage API: the
--     reference stack blocks deleting storage objects from SQL (scripts/purge-attendance-selfies.mjs:7-9).
--     A hard delete cascades only this metadata row; a soft delete keeps it.
--   * Browsers need the camera allowed for the app's own origin (reference: next.config.ts:45-48).
-- Rollback: drop function public.attach_attendance_photo; drop table public.attendance_photos.
-- ============================================================================

create table if not exists public.attendance_photos (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions (id) on delete cascade,
  kind text not null check (kind in ('clock_in', 'clock_out')),
  storage_bucket text not null default 'attendance-photos' check (length(btrim(storage_bucket)) between 1 and 63),
  storage_path text not null check (length(btrim(storage_path)) between 1 and 400),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint not null check (byte_size between 0 and 10485760),
  image_width integer check (image_width is null or image_width > 0),
  image_height integer check (image_height is null or image_height > 0),
  uploaded_by uuid not null references public.employees (id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  constraint attendance_photos_unique_path unique (storage_bucket, storage_path),
  constraint attendance_photos_one_per_kind unique (session_id, kind)
);

alter table public.attendance_photos enable row level security;
alter table public.attendance_photos force row level security;
revoke all on public.attendance_photos from public, anon, authenticated;
drop policy if exists attendance_photos_read on public.attendance_photos;
create policy attendance_photos_read on public.attendance_photos for select to authenticated
  using (exists (
    select 1 from public.attendance_sessions s
    where s.id = attendance_photos.session_id
      and (s.employee_id = app_private.current_staff_id() or app_private.has_permission('attendance.review'))
  ));
grant select on public.attendance_photos to authenticated;

create or replace function public.attach_attendance_photo(
  p_session_id uuid, p_kind text, p_storage_path text, p_content_type text, p_byte_size bigint
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app_private.current_staff_id();
  v_path text := btrim(p_storage_path);
  v_session public.attendance_sessions;
  v_id uuid;
begin
  if v_actor is null or not app_private.has_permission('attendance.clock_operate') then
    raise exception 'Not authorized: attendance.clock_operate is required.' using errcode = 'insufficient_privilege', hint = 'forbidden';
  end if;
  if p_kind is null or p_kind not in ('clock_in', 'clock_out') then
    raise exception 'Photo kind must be clock_in or clock_out.' using hint = 'validation';
  end if;
  if p_content_type is null or p_content_type not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'The photo must be a JPEG, PNG or WebP image.' using hint = 'validation';
  end if;
  if p_byte_size is null or p_byte_size < 0 or p_byte_size > 10485760 then
    raise exception 'The photo size is out of range.' using hint = 'validation';
  end if;
  select * into v_session from public.attendance_sessions s where s.id = p_session_id;
  if not found or v_session.deleted_at is not null then
    raise exception 'That attendance session could not be found.' using hint = 'not_found';
  end if;
  if (p_kind = 'clock_in' and v_session.clock_in_by is distinct from v_actor)
     or (p_kind = 'clock_out' and v_session.clock_out_by is distinct from v_actor) then
    raise exception 'Only the operator who recorded this clock event may attach its photo.'
      using errcode = 'insufficient_privilege', hint = 'forbidden';
  end if;
  if v_path is null then
    raise exception 'A storage path is required.' using hint = 'validation';
  end if;
  -- A uuid's text form holds only hexadecimal digits and hyphens, so it is safe inside the pattern.
  if v_path !~ ('^' || v_session.id::text || '/' || p_kind || '[.](jpg|jpeg|png|webp)$') then
    raise exception 'The storage path must be the session id, a slash, the kind and an image extension.' using hint = 'validation';
  end if;
  begin
    insert into public.attendance_photos (session_id, kind, storage_path, content_type, byte_size, uploaded_by)
    values (v_session.id, p_kind, v_path, p_content_type, p_byte_size, v_actor)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'A photo of this kind is already attached to this session.' using hint = 'conflict';
  end;
  perform app_private.record_audit_event('attendance.photo_attach', 'attendance_session', v_session.id, 'succeeded', null,
    pg_catalog.jsonb_build_object('photo_id', v_id, 'kind', p_kind, 'byte_size', p_byte_size));
  return v_id;
end $$;

revoke all on function public.attach_attendance_photo(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.attach_attendance_photo(uuid, text, text, text, bigint) to authenticated, service_role;
