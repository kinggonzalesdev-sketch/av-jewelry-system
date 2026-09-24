-- SCREENSHOT FIRST: THE COMPUTATION CAN NEVER GO BEFORE THE SCREENSHOT (Owner 2026-09-24).
--
-- Why: at 22:17 on 2026-09-24 a comment-only customer (capture 191a8079) got the computation as
-- a Private Reply while Screenshot First was on. The capture was new and was correctly stamped
-- 'screenshot_first'. The send came from a PC browser tab that was still running the 21:12 build
-- (de3b761): Vercel keeps an open tab's server actions on the build that tab loaded, and that build
-- still spent the one Private Reply on the computation. New code cannot stop an old build that is
-- still running, so the rule moves into the database, which every build shares:
--
--   1. SNAPSHOT AT CREATION. A new capture takes the Owner's current sequence (and text attempts)
--      the moment it is inserted, whichever build or device inserts it. A capture already in
--      flight keeps the sequence it started with (start_capture_message_sequence stays set-once).
--   2. HARD GATE. claim_share_link_send is the only way any build sends a comment Private Reply.
--      It now refuses a screenshot_first capture ('screenshot_first'). On Screenshot First the
--      computation goes only through claim_capture_text_send, which already requires the
--      screenshot to be 'sent' first. Older builds read the refusal as "in progress" and send
--      nothing.
--
-- STRICTLY ADDITIVE AND BACKWARD-COMPATIBLE: no column, no data change. One new trigger function
-- and trigger; claim_share_link_send re-created from its LIVE definition with one added check.
-- Classic and legacy (unstamped) captures behave exactly as before.
--
-- ROLLBACK (only if ever needed):
--   drop trigger if exists trg_stamp_message_sequence on public.capture_records;
--   drop function if exists app_private.stamp_capture_message_sequence();
--   re-create public.claim_share_link_send from the live definition below WITHOUT the
--   "HARD GATE" block (the rest of the body is unchanged).
-- Web rollback note: a build from before the sequence feature (5546462) has no text leg, so switch
-- Settings -> Messages to Classic when rolling the web back to it.

create or replace function app_private.stamp_capture_message_sequence()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_mode text;
  v_attempts integer;
begin
  if new.message_sequence is null then
    select c.private_reply_sequence, c.text_send_attempts
      into v_mode, v_attempts
      from public.pancake_integration_config c
     limit 1;
    -- No config row, or an unknown value: leave it unstamped, so the first send stamps it exactly
    -- as before this migration.
    if v_mode in ('screenshot_first', 'classic') then
      new.message_sequence := v_mode;
      new.text_max_attempts := case
        when v_mode = 'screenshot_first' then greatest(1, least(coalesce(v_attempts, 3), 3))
        else null
      end;
    end if;
  end if;
  return new;
end
$$;

revoke all on function app_private.stamp_capture_message_sequence() from public, anon, authenticated;

drop trigger if exists trg_stamp_message_sequence on public.capture_records;
create trigger trg_stamp_message_sequence
  before insert on public.capture_records
  for each row execute function app_private.stamp_capture_message_sequence();

create or replace function public.claim_share_link_send(p_id uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare v_status text; v_revoked timestamptz;
begin
  if not (app_private.is_active_staff() or app_private.is_service_role()) then raise exception 'Not authorized.' using errcode = 'insufficient_privilege'; end if;
  -- HARD GATE (Owner 2026-09-24): on Screenshot First nothing may be sent before the screenshot,
  -- and a comment Private Reply can never carry it, so a screenshot_first capture never gets one,
  -- whichever build asks. A reply already sent still answers 'already_sent' below.
  if exists (
    select 1
      from public.capture_share_links s
      join public.capture_records c on c.id = s.capture_record_id
     where s.id = p_id
       and c.message_sequence = 'screenshot_first'
       and s.private_reply_status is distinct from 'sent'
  ) then
    return 'screenshot_first';
  end if;
  update public.capture_share_links set private_reply_status = 'sending', send_claimed_at = now()
    where id = p_id and revoked_at is null
      and (private_reply_status = 'pending'
           or (private_reply_status = 'sending' and (send_claimed_at is null or send_claimed_at < now() - interval '5 minutes')));
  if found then return 'claimed'; end if;
  select private_reply_status, revoked_at into v_status, v_revoked from public.capture_share_links where id = p_id;
  if v_status is null then return 'not_found'; end if;
  if v_revoked is not null then return 'revoked'; end if;
  if v_status = 'sent' then return 'already_sent'; end if;
  return 'in_progress';
end $$;

revoke all on function public.claim_share_link_send(uuid) from public, anon;
grant execute on function public.claim_share_link_send(uuid) to authenticated, service_role;
