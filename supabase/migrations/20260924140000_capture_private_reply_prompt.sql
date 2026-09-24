-- SCREENSHOT-FIRST FOR COMMENT-ONLY CUSTOMERS: A "PLEASE REPLY" PRIVATE REPLY (Owner 2026-09-24).
--
-- Facebook allows a customer who only COMMENTED exactly ONE Private Reply, text only (a screenshot
-- Private Reply was rejected in Controlled Test C-A). Until now the screenshot-first sequence spent
-- that one reply on the COMPUTATION, so the customer read the price before seeing the item. The
-- Owner chose (2026-09-24): the one reply is a short request to reply; once the customer replies in
-- Messenger, the SCREENSHOT goes first and the computation follows (the existing text leg).
--
-- This migration only teaches the sequence which kind of Private Reply a capture used:
--   capture_records.private_reply_kind
--     NULL / 'computation'  the Private Reply carried the computation (every capture before this
--                           migration, and every classic capture) — unchanged meaning;
--     'prompt'              the Private Reply only asked the customer to reply. It is NOT the
--                           computation, so the computation is still sent after the screenshot.
--
-- STRICTLY ADDITIVE AND BACKWARD-COMPATIBLE: one nullable column with a check constraint, one new
-- function, and three functions re-created with ONE added condition each (bodies otherwise
-- identical to 20260924120000). Code that never sets the column behaves exactly as before.
--
-- ROLLBACK (only if ever needed; the column can simply stay unused):
--   drop function public.mark_capture_private_reply_prompt(uuid);
--   re-create start_capture_message_sequence, mark_capture_text_sent_by_private_reply and
--   claim_capture_text_send from 20260924120000.

alter table public.capture_records
  add column if not exists private_reply_kind text;

do $$
begin
  alter table public.capture_records
    add constraint capture_records_private_reply_kind_ck
    check (private_reply_kind is null or private_reply_kind in ('computation', 'prompt'));
exception when duplicate_object then null;
end $$;

-- Mark a screenshot-first capture's ONE Private Reply as the "please reply" prompt, BEFORE it is
-- sent (so a lost worker after the send can never be mistaken for a computation). Set-once, and
-- never for a capture whose Private Reply was already attempted or whose text is already sent.
-- Returns the capture's effective kind: 'prompt' or 'computation' (NULL = capture not found).
create or replace function public.mark_capture_private_reply_prompt(p_capture_id uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare v_kind text;
begin
  if not (app_private.has_permission('claim_capture') or app_private.is_service_role()) then
    raise exception 'Not authorized: the claim_capture permission is required.'
      using errcode = 'insufficient_privilege';
  end if;
  update public.capture_records c
     set private_reply_kind = 'prompt'
   where c.id = p_capture_id
     and c.message_sequence = 'screenshot_first'
     and c.private_reply_kind is null
     and coalesce(c.text_send_status, '') <> 'sent'
     and not exists (
       select 1 from public.capture_share_links s
       where s.capture_record_id = p_capture_id
         and s.private_reply_status in ('sending', 'sent', 'failed')
     );
  select coalesce(c.private_reply_kind, 'computation') into v_kind
  from public.capture_records c where c.id = p_capture_id;
  return v_kind;
end
$function$;

-- As 20260924120000, plus: a 'prompt' Private Reply is never recorded as the computation text.
create or replace function public.start_capture_message_sequence(
  p_capture_id uuid,
  p_mode text,
  p_max_attempts integer
)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare v_mode text;
begin
  if not app_private.is_service_role() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  if p_mode is null or p_mode not in ('screenshot_first', 'classic') then
    raise exception 'Unknown messaging sequence.' using errcode = 'check_violation';
  end if;
  update public.capture_records
     set message_sequence = p_mode,
         text_max_attempts = case
           when p_mode = 'screenshot_first' then greatest(1, least(coalesce(p_max_attempts, 3), 3))
           else null end
   where id = p_capture_id and message_sequence is null;
  -- A capture whose computation ALREADY went as its Private Reply (including one sent by the
  -- code from before this migration) has its text done: record it now.
  update public.capture_records c
     set text_send_status = 'sent', text_sent_via = 'private_reply',
         text_sent_at = coalesce(c.text_sent_at, now()), text_last_code = 'private_reply'
   where c.id = p_capture_id
     and c.message_sequence = 'screenshot_first'
     and c.text_send_status is null
     and coalesce(c.private_reply_kind, 'computation') = 'computation'
     and exists (
       select 1 from public.capture_share_links s
       where s.capture_record_id = p_capture_id and s.private_reply_status = 'sent'
     );
  select c.message_sequence into v_mode from public.capture_records c where c.id = p_capture_id;
  return v_mode;
end
$function$;

-- As 20260924120000, plus: only a COMPUTATION Private Reply is recorded as the text.
create or replace function public.mark_capture_text_sent_by_private_reply(p_capture_id uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare v_status text;
begin
  if not app_private.is_service_role() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  update public.capture_records
     set text_send_status = 'sent',
         text_sent_via = 'private_reply',
         text_sent_at = now(),
         text_next_at = null,
         text_claimed_at = null,
         text_waiting_since = null,
         text_last_code = 'private_reply'
   where id = p_capture_id
     and message_sequence = 'screenshot_first'
     and coalesce(private_reply_kind, 'computation') = 'computation'
     and coalesce(text_send_status, '') <> 'sent';
  select c.text_send_status into v_status from public.capture_records c where c.id = p_capture_id;
  return v_status;
end
$function$;

-- As 20260924120000, plus: the Private Reply ledger checks apply only when that reply carried the
-- computation. A 'prompt' reply leaves the computation to be sent after the screenshot.
create or replace function public.claim_capture_text_send(p_capture_id uuid, p_trigger text default 'auto')
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r record;
  v_status text;
begin
  if not app_private.is_service_role() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  if p_trigger is null or p_trigger not in ('auto', 'reply') then
    raise exception 'Unknown trigger.' using errcode = 'check_violation';
  end if;

  select c.message_sequence, c.message_status, c.text_send_status, c.text_attempts,
         c.text_max_attempts, c.text_next_at, c.text_claimed_at, c.private_reply_kind
    into r
  from public.capture_records c
  where c.id = p_capture_id
  for update;
  if not found then return 'not_found'; end if;

  if r.message_sequence is distinct from 'screenshot_first' then return 'not_applicable'; end if;
  v_status := coalesce(r.text_send_status, 'pending');
  if v_status = 'sent' then return 'already_sent'; end if;

  if coalesce(r.private_reply_kind, 'computation') = 'computation' then
    -- The computation already went as this capture's ONE Private Reply (the ledger is the proof,
    -- whichever code sent it and even if recording it afterwards failed): never send it again.
    if exists (
      select 1 from public.capture_share_links s
      where s.capture_record_id = p_capture_id and s.private_reply_status = 'sent'
    ) then
      update public.capture_records
         set text_send_status = 'sent', text_sent_via = 'private_reply',
             text_sent_at = coalesce(text_sent_at, now()), text_next_at = null,
             text_claimed_at = null, text_waiting_since = null, text_last_code = 'private_reply'
       where id = p_capture_id;
      return 'already_sent';
    end if;
    -- A Private Reply stuck 'sending' (its worker died after contacting Pancake) or marked 'failed'
    -- after contacting Pancake MAY have been delivered: never add a second computation on top of
    -- it. Staff check the chat.
    if exists (
      select 1 from public.capture_share_links s
      where s.capture_record_id = p_capture_id and s.private_reply_status in ('sending', 'failed')
    ) then
      update public.capture_records
         set text_send_status = 'unconfirmed', text_claimed_at = null, text_last_code = 'private_reply_uncertain'
       where id = p_capture_id;
      return 'unconfirmed';
    end if;
  end if;
  if coalesce(r.message_status, '') <> 'sent' then return 'not_ready'; end if;
  if v_status in ('failed', 'unconfirmed') then return v_status; end if;

  if v_status = 'sending' then
    if r.text_claimed_at is not null and r.text_claimed_at > now() - interval '2 minutes' then
      return 'in_progress';
    end if;
    -- The worker holding the claim vanished mid-send: the request may have reached Pancake.
    -- Never re-send blindly; staff check the chat.
    update public.capture_records
       set text_send_status = 'unconfirmed', text_claimed_at = null, text_last_code = 'stale_claim'
     where id = p_capture_id;
    return 'unconfirmed';
  end if;

  if v_status = 'waiting_reply' and p_trigger <> 'reply' then return 'waiting_reply'; end if;

  if v_status = 'pending' then
    if p_trigger = 'auto' and r.text_next_at is not null and r.text_next_at > now() then
      return 'not_due';
    end if;
    if p_trigger = 'auto' and r.text_attempts >= coalesce(r.text_max_attempts, 3) then
      update public.capture_records
         set text_send_status = 'waiting_reply', text_waiting_since = now(), text_next_at = null
       where id = p_capture_id;
      return 'waiting_reply';
    end if;
  end if;

  update public.capture_records
     set text_send_status = 'sending',
         text_claimed_at = now(),
         text_attempts = text_attempts + 1
   where id = p_capture_id;
  return 'claimed';
end
$function$;

revoke all on function public.mark_capture_private_reply_prompt(uuid) from public, anon;
grant execute on function public.mark_capture_private_reply_prompt(uuid) to authenticated, service_role;
