-- One-capture-one-photo idempotency for the MineFlow Capture screenshot-delivery path.
-- An atomic CLAIM/FINALIZE around the outbound PHOTO send so an auto-send + manual Send (or a
-- double click / repeated resolver / webhook duplicate / retry race) can never send the same
-- capture twice. DB-level compare-and-set on message_status; a stale in-flight claim self-heals
-- after 2 minutes. Does NOT change OCR / ROI / printer / Pancake API version / PHOTO serialization.

alter table public.capture_records
  add column if not exists send_claimed_at timestamptz;

-- Atomically CLAIM a capture for exactly ONE outbound photo send. Returns:
--   'claimed'      -> this caller won the claim (message_status set to 'sending')
--   'already_sent' -> a prior send already completed (no-op)
--   'in_progress'  -> another send holds a fresh claim (no-op; duplicate rejected)
--   'not_found'    -> no such capture
create or replace function public.claim_capture_photo_send(
  p_capture_id uuid,
  p_conversation_id text
) returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_prev text;
begin
  if not app_private.has_permission('claim_capture') then
    raise exception 'Not authorized: the claim_capture permission is required.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Atomic compare-and-set: win the claim only from a non-sent, non-fresh-sending state.
  update public.capture_records
    set message_status = 'sending',
        send_claimed_at = now(),
        pancake_conversation_id =
          coalesce(nullif(trim(pancake_conversation_id), ''), nullif(trim(p_conversation_id), ''))
    where id = p_capture_id
      and coalesce(message_status, '') <> 'sent'
      and (coalesce(message_status, '') <> 'sending'
           or send_claimed_at is null
           or send_claimed_at < now() - interval '2 minutes');
  if found then
    return 'claimed';
  end if;

  select message_status into v_prev from public.capture_records where id = p_capture_id;
  if not found then return 'not_found'; end if;
  if v_prev = 'sent' then return 'already_sent'; end if;
  return 'in_progress';
end;
$$;

-- FINALIZE a claimed send: 'sending' -> 'sent' (ok) or 'failed' (reviewable/retryable).
create or replace function public.finalize_capture_photo_send(
  p_capture_id uuid,
  p_ok boolean,
  p_pancake_message_id text,
  p_conversation_id text
) returns text
language plpgsql
security definer
set search_path to ''
as $$
declare v_row public.capture_records%rowtype;
begin
  if not app_private.has_permission('claim_capture') then
    raise exception 'Not authorized: the claim_capture permission is required.'
      using errcode = 'insufficient_privilege';
  end if;
  update public.capture_records
    set message_status = case when p_ok then 'sent' else 'failed' end,
        pancake_message_id = coalesce(nullif(trim(p_pancake_message_id), ''), pancake_message_id),
        pancake_conversation_id =
          coalesce(nullif(trim(p_conversation_id), ''), pancake_conversation_id),
        send_claimed_at = null
    where id = p_capture_id
      and message_status = 'sending'
    returning * into v_row;
  if not found then
    return 'not_claimed';
  end if;
  return v_row.message_status;
end;
$$;

-- Mark a capture into a REVIEWABLE, non-terminal state WITHOUT sending anything (used when there
-- is no deliverable screenshot, or the media window is not yet open). NEVER sets 'sent'.
create or replace function public.mark_capture_photo_state(
  p_capture_id uuid,
  p_status text
) returns text
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not app_private.has_permission('claim_capture') then
    raise exception 'Not authorized: the claim_capture permission is required.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('failed', 'awaiting_inbox') then
    raise exception 'mark_capture_photo_state only sets failed/awaiting_inbox.'
      using errcode = 'check_violation';
  end if;
  update public.capture_records
    set message_status = p_status
    where id = p_capture_id
      and coalesce(message_status, '') not in ('sent', 'sending');
  return p_status;
end;
$$;

revoke all on function public.claim_capture_photo_send(uuid, text) from public, anon;
revoke all on function public.finalize_capture_photo_send(uuid, boolean, text, text) from public, anon;
revoke all on function public.mark_capture_photo_state(uuid, text) from public, anon;
grant execute on function public.claim_capture_photo_send(uuid, text) to authenticated;
grant execute on function public.finalize_capture_photo_send(uuid, boolean, text, text) to authenticated;
grant execute on function public.mark_capture_photo_state(uuid, text) to authenticated;
