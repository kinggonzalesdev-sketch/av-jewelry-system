-- Durable, SANITIZED diagnostics for Controlled Photo Test B attempts ONLY. One row per
-- attempt. Stores ONLY last-6 suffixes + the parsed upload/send outcome. NEVER a Pancake
-- token, image bytes, a signed storage URL, a full customer name, a PSID in clear text, or a
-- full conversation/content id. Manager/Owner read-only; writes ONLY through a Primary-Super-
-- Admin SECURITY DEFINER RPC. This is observability only and does NOT touch Capture behavior.
create table if not exists public.controlled_photo_diagnostics (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  capture_ref text,
  conversation_ref text,
  upload_api_version text,
  upload_http_status integer,
  upload_success boolean,
  upload_content_id_suffix text,
  upload_type text,
  upload_message_code text,
  send_http_status integer,
  send_success boolean,
  send_message_code text,
  classification text check (classification in ('A','B','C','D'))
);

comment on table public.controlled_photo_diagnostics is
  'Sanitized one-row-per-attempt diagnostics for the manual Controlled Photo Test B (suffixes + parsed outcome only; no token/image/URL/PII). Owner/Primary-Super-Admin read-only; written only via record_controlled_photo_diagnostic().';

alter table public.controlled_photo_diagnostics enable row level security;

-- READ: Owner or Primary Super Admin only (no regular staff).
drop policy if exists cpd_select_managers on public.controlled_photo_diagnostics;
create policy cpd_select_managers on public.controlled_photo_diagnostics
  for select to authenticated
  using (app_private.is_owner() or app_private.is_primary_super_admin());

-- No INSERT/UPDATE/DELETE policy → direct writes are blocked by RLS; the SECURITY DEFINER
-- RPC below is the only writer.
revoke all on public.controlled_photo_diagnostics from anon, authenticated;
grant select on public.controlled_photo_diagnostics to authenticated;

create or replace function public.record_controlled_photo_diagnostic(
  p_capture_ref text,
  p_conversation_ref text,
  p_upload_api_version text,
  p_upload_http_status integer,
  p_upload_success boolean,
  p_upload_content_id_suffix text,
  p_upload_type text,
  p_upload_message_code text,
  p_send_http_status integer,
  p_send_success boolean,
  p_send_message_code text,
  p_classification text
) returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id uuid;
begin
  -- Only the Primary Super Admin (who runs the controlled test) may record a diagnostic.
  if not app_private.is_primary_super_admin() then
    raise exception 'Not authorized to record controlled photo diagnostics.'
      using errcode = '42501';
  end if;
  -- Defensive truncation: guarantee only short/suffix-length values are ever stored, so a
  -- full id/PSID/URL can never be persisted even if a caller passed one by mistake.
  insert into public.controlled_photo_diagnostics(
    capture_ref, conversation_ref, upload_api_version, upload_http_status, upload_success,
    upload_content_id_suffix, upload_type, upload_message_code,
    send_http_status, send_success, send_message_code, classification
  ) values (
    left(p_capture_ref, 12), left(p_conversation_ref, 12), left(p_upload_api_version, 16),
    p_upload_http_status, p_upload_success, left(p_upload_content_id_suffix, 16),
    left(p_upload_type, 40), left(p_upload_message_code, 200),
    p_send_http_status, p_send_success, left(p_send_message_code, 200),
    case when p_classification in ('A','B','C','D') then p_classification else 'D' end
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_controlled_photo_diagnostic(
  text, text, text, integer, boolean, text, text, text, integer, boolean, text, text
) from public, anon;
grant execute on function public.record_controlled_photo_diagnostic(
  text, text, text, integer, boolean, text, text, text, integer, boolean, text, text
) to authenticated;
