-- SCREENSHOT-FIRST PRIVATE REPLY SEQUENCE (Owner request 2026-09-24).
--
-- Adds a configurable messaging sequence for Incoming Captures:
--   screenshot_first (default): screenshot → computation text, up to N text attempts
--     (N = 1..3, default 3). If the text still fails, the capture waits for a GENUINE
--     customer reply and then sends the text once through the normal conversation path.
--     For a comment-only customer (no open Messenger window) Pancake cannot send a
--     screenshot at all: private_replies with media was rejected twice in Controlled
--     Test C-A (2026-08-20), with error_code 100 both times. So the Owner approved keeping
--     the proven path there. The computation goes as the ONE Private Reply text, and it
--     is recorded as the text, so it is never sent twice. The screenshot follows after
--     the customer replies.
--   classic: exactly the behaviour before this migration (no computation text after an
--     inbox screenshot).
--
-- STRICTLY ADDITIVE AND BACKWARD-COMPATIBLE:
--   * new nullable columns plus two NOT NULL columns with constant defaults, which is
--     metadata-only in PostgreSQL 11 and later, with no table rewrite;
--   * new SECURITY DEFINER functions;
--   * has_capture_routing_work is re-created as a strict SUPERSET of its live body, so it
--     also wakes the sweep for screenshot-first text work that is due.
--   Nothing is dropped, renamed or deleted, and no existing row changes meaning. A capture
--   whose computation already went as a Private Reply (capture_share_links shows it
--   'sent', whichever code sent it) is never sent the computation again: the text claim
--   checks that ledger. The code from before this migration ignores every new column, so a
--   code rollback needs no database rollback.
--
-- ROLLBACK (only if ever needed; the columns can simply stay unused instead):
--   drop function public.claim_capture_text_send(uuid, text),
--                 public.finalize_capture_text_send(uuid, text, text, text, integer),
--                 public.start_capture_message_sequence(uuid, text, integer),
--                 public.mark_capture_text_sent_by_private_reply(uuid),
--                 public.list_due_capture_text_legs(integer),
--                 public.list_waiting_capture_texts(integer),
--                 public.get_capture_messaging_settings(),
--                 public.save_capture_messaging_settings(text, integer);
--   then re-create has_capture_routing_work without its screenshot-first branch (section 5).

-- ---------------------------------------------------------------------------
-- 1. Settings, on the existing single-row Pancake settings table.
-- ---------------------------------------------------------------------------
alter table public.pancake_integration_config
  add column if not exists private_reply_sequence text not null default 'screenshot_first',
  add column if not exists text_send_attempts smallint not null default 3,
  add column if not exists messaging_updated_at timestamptz,
  add column if not exists messaging_updated_by uuid;

do $$
begin
  alter table public.pancake_integration_config
    add constraint pancake_config_private_reply_sequence_ck
    check (private_reply_sequence in ('screenshot_first', 'classic'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.pancake_integration_config
    add constraint pancake_config_text_send_attempts_ck
    check (text_send_attempts between 1 and 3);
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Per-capture sequence state. Each capture carries its OWN state, so one capture
--    never blocks another. The mode is stamped ONCE when the capture's messaging
--    starts: a later settings change affects only NEW flows.
--    text_send_status:
--      pending        screenshot sent; the text may be attempted (subject to text_next_at)
--      sending        one worker holds the text claim (2-minute lease)
--      sent           the computation text was delivered (inbox, or the Private Reply)
--      waiting_reply  attempts used up or Facebook needs a customer reply first
--      failed         cannot be sent automatically (config, auth or invalid conversation)
--      unconfirmed    the request may have reached Pancake (timeout / lost worker);
--                     never re-sent automatically, staff check the chat
-- ---------------------------------------------------------------------------
alter table public.capture_records
  add column if not exists message_sequence text,
  add column if not exists text_send_status text,
  add column if not exists text_attempts smallint not null default 0,
  add column if not exists text_max_attempts smallint,
  add column if not exists text_next_at timestamptz,
  add column if not exists text_claimed_at timestamptz,
  add column if not exists text_sent_at timestamptz,
  add column if not exists text_sent_via text,
  add column if not exists text_pancake_message_id text,
  add column if not exists text_waiting_since timestamptz,
  add column if not exists text_last_code text;

do $$
begin
  alter table public.capture_records
    add constraint capture_records_message_sequence_ck
    check (message_sequence is null or message_sequence in ('screenshot_first', 'classic'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.capture_records
    add constraint capture_records_text_send_status_ck
    check (text_send_status is null or text_send_status in
      ('pending', 'sending', 'sent', 'waiting_reply', 'failed', 'unconfirmed'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.capture_records
    add constraint capture_records_text_sent_via_ck
    check (text_sent_via is null or text_sent_via in ('inbox', 'private_reply'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.capture_records
    add constraint capture_records_text_max_attempts_ck
    check (text_max_attempts is null or text_max_attempts between 1 and 3);
exception when duplicate_object then null;
end $$;

-- The router's text-leg sweep reads only this small, recent working set.
-- The predicate is written in the same shape as the queries (plain IS NULL / IN, no coalesce), so
-- the planner can prove it and use the index.
create index if not exists capture_records_text_leg_idx
  on public.capture_records (created_at)
  where message_sequence = 'screenshot_first'
    and (text_send_status is null or text_send_status in ('pending', 'sending', 'waiting_reply'));

-- ---------------------------------------------------------------------------
-- 3. Settings read / save. Super Admin (owner role) for the Settings page; the
--    service role for the router. The table itself stays RLS-gated as before.
-- ---------------------------------------------------------------------------
create or replace function public.get_capture_messaging_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v jsonb;
begin
  if not (app_private.is_owner() or app_private.is_service_role()) then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  select jsonb_build_object(
           'mode', c.private_reply_sequence,
           'attempts', c.text_send_attempts,
           'updated_at', c.messaging_updated_at)
    into v
  from public.pancake_integration_config c
  where c.id = true;
  return coalesce(v, jsonb_build_object('mode', 'screenshot_first', 'attempts', 3, 'updated_at', null));
end
$function$;

create or replace function public.save_capture_messaging_settings(p_mode text, p_attempts integer)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_staff uuid;
begin
  if not app_private.is_owner() then
    raise exception 'Not authorized: only the Super Admin can change the messaging sequence.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_mode is null or p_mode not in ('screenshot_first', 'classic') then
    raise exception 'Unknown messaging sequence.' using errcode = 'check_violation';
  end if;
  if p_attempts is null or p_attempts < 1 or p_attempts > 3 then
    raise exception 'Text send attempts must be between 1 and 3.' using errcode = 'check_violation';
  end if;
  select sp.id into v_staff from public.staff_profiles sp where sp.auth_user_id = (select auth.uid());
  insert into public.pancake_integration_config
    (id, private_reply_sequence, text_send_attempts, messaging_updated_at, messaging_updated_by)
  values (true, p_mode, p_attempts, now(), v_staff)
  on conflict (id) do update
    set private_reply_sequence = excluded.private_reply_sequence,
        text_send_attempts = excluded.text_send_attempts,
        messaging_updated_at = excluded.messaging_updated_at,
        messaging_updated_by = excluded.messaging_updated_by;
  return jsonb_build_object('mode', p_mode, 'attempts', p_attempts, 'updated_at', now());
end
$function$;

-- ---------------------------------------------------------------------------
-- 4. Sequence state machine (service role only: the router, the manual-send
--    follow-up and the webhook run it through the service-role client).
-- ---------------------------------------------------------------------------

-- Stamp the capture's sequence ONCE (set-once), so a settings change never rewrites a
-- capture already in flight. Returns the capture's effective sequence (null = not found).
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
     and exists (
       select 1 from public.capture_share_links s
       where s.capture_record_id = p_capture_id and s.private_reply_status = 'sent'
     );
  select c.message_sequence into v_mode from public.capture_records c where c.id = p_capture_id;
  return v_mode;
end
$function$;

-- A comment-only customer received the computation as the ONE Private Reply text (the
-- Owner-approved path when a screenshot cannot be sent first). Record it as the text so
-- the text is never sent again after the screenshot follows.
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
     and coalesce(text_send_status, '') <> 'sent';
  select c.text_send_status into v_status from public.capture_records c where c.id = p_capture_id;
  return v_status;
end
$function$;

-- Atomically claim ONE text attempt. The screenshot MUST already be sent
-- (message_status = 'sent'): this is the database-level guarantee of IMAGE THEN TEXT.
-- p_trigger 'auto' obeys the attempt budget and the retry-after time; 'reply' is the
-- single send unlocked by a genuine customer reply after the capture started waiting.
-- Returns: claimed | already_sent | not_ready | not_applicable | not_due | in_progress |
--          waiting_reply | failed | unconfirmed | not_found
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
         c.text_max_attempts, c.text_next_at, c.text_claimed_at
    into r
  from public.capture_records c
  where c.id = p_capture_id
  for update;
  if not found then return 'not_found'; end if;

  if r.message_sequence is distinct from 'screenshot_first' then return 'not_applicable'; end if;
  v_status := coalesce(r.text_send_status, 'pending');
  if v_status = 'sent' then return 'already_sent'; end if;

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

-- Finalize the claimed attempt. 'retry' returns to 'pending' while attempts remain, else
-- 'waiting_reply'. Returns the new status, or 'not_claimed' when this worker holds no claim.
create or replace function public.finalize_capture_text_send(
  p_capture_id uuid,
  p_outcome text,
  p_code text default null,
  p_message_id text default null,
  p_retry_after_seconds integer default null
)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r record;
  v_next text;
begin
  if not app_private.is_service_role() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  if p_outcome is null or p_outcome not in ('sent', 'retry', 'waiting_reply', 'failed', 'unconfirmed') then
    raise exception 'Unknown outcome.' using errcode = 'check_violation';
  end if;

  select c.text_send_status, c.text_attempts, c.text_max_attempts
    into r
  from public.capture_records c
  where c.id = p_capture_id
  for update;
  if not found then return 'not_found'; end if;
  if r.text_send_status is distinct from 'sending' then return 'not_claimed'; end if;

  v_next := case
    when p_outcome = 'retry' then
      case when r.text_attempts < coalesce(r.text_max_attempts, 3) then 'pending' else 'waiting_reply' end
    else p_outcome
  end;

  update public.capture_records
     set text_send_status = v_next,
         text_claimed_at = null,
         text_last_code = left(coalesce(nullif(trim(p_code), ''), p_outcome), 60),
         text_sent_at = case when v_next = 'sent' then now() else text_sent_at end,
         text_sent_via = case when v_next = 'sent' then 'inbox' else text_sent_via end,
         text_pancake_message_id = case
           when v_next = 'sent' then coalesce(nullif(trim(p_message_id), ''), text_pancake_message_id)
           else text_pancake_message_id end,
         text_next_at = case
           when v_next = 'pending' then
             now() + make_interval(secs => greatest(0, least(coalesce(p_retry_after_seconds, 0), 3600)))
           else null end,
         text_waiting_since = case when v_next = 'waiting_reply' then now() else null end
   where id = p_capture_id;
  return v_next;
end
$function$;

-- Text work that is DUE for an automatic attempt: never started, a retry whose time has come,
-- or a claim lost mid-request (the claim turns that into 'unconfirmed'). Oldest due first,
-- so no row is starved by rows that are merely waiting.
create or replace function public.list_due_capture_text_legs(p_limit integer default 20)
returns setof uuid
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not app_private.is_service_role() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select c.id
  from public.capture_records c
  where c.source = 'floating' and c.is_test = false and c.official_order_id is null
    and c.confirmed is null
    and c.message_sequence = 'screenshot_first'
    and c.message_status = 'sent'
    and (
      c.text_send_status is null
      or (c.text_send_status = 'pending' and (c.text_next_at is null or c.text_next_at <= now()))
      or (c.text_send_status = 'sending'
          and (c.text_claimed_at is null or c.text_claimed_at < now() - interval '2 minutes'))
    )
    and c.created_at > now() - interval '3 days'
  order by coalesce(c.text_next_at, c.created_at) asc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
end
$function$;

-- Captures waiting for a customer reply (the every-minute missed-reply fallback checks each one
-- for a genuine reply SINCE it began waiting). Oldest wait first.
create or replace function public.list_waiting_capture_texts(p_limit integer default 100)
returns table (id uuid, pancake_conversation_id text, text_waiting_since timestamptz)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not app_private.is_service_role() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select c.id, c.pancake_conversation_id, c.text_waiting_since
  from public.capture_records c
  where c.source = 'floating' and c.is_test = false and c.official_order_id is null
    and c.confirmed is null
    and c.message_sequence = 'screenshot_first'
    and c.text_send_status = 'waiting_reply'
    and c.pancake_conversation_id is not null
    and c.created_at > now() - interval '3 days'
  order by c.text_waiting_since asc nulls first
  limit greatest(1, least(coalesce(p_limit, 100), 200));
end
$function$;

-- ---------------------------------------------------------------------------
-- 5. The cheap sweep guard (evaluated on every Live-comment webhook): its live body, read
--    2026-09-24, plus ONE branch for screenshot-first text work that is DUE for an automatic
--    attempt. Captures merely WAITING for a reply do not wake it (the reply webhook resumes
--    them directly; the cron's missed-reply fallback runs regardless of this guard), so a
--    waiting capture adds no per-comment cost. Strict superset of the previous body.
--    ROLLBACK: re-create it without the third branch.
-- ---------------------------------------------------------------------------
create or replace function public.has_capture_routing_work()
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not (app_private.is_active_staff() or app_private.is_service_role()) then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  return exists (
    select 1
    from public.capture_records c
    where c.source = 'floating' and c.is_test = false and c.official_order_id is null
      and (
        coalesce(c.message_status, '') in ('pending', 'awaiting_inbox')
        or (c.message_status = 'link_sent' and c.created_at > now() - interval '24 hours')
        or (
          c.message_sequence = 'screenshot_first'
          and c.message_status = 'sent'
          and c.confirmed is null
          and c.created_at > now() - interval '3 days'
          and (
            c.text_send_status is null
            or (c.text_send_status = 'pending' and (c.text_next_at is null or c.text_next_at <= now()))
            or (c.text_send_status = 'sending'
                and (c.text_claimed_at is null or c.text_claimed_at < now() - interval '2 minutes'))
          )
        )
      )
  );
end
$function$;

-- ---------------------------------------------------------------------------
-- 6. Grants. Every new definer function is closed to PUBLIC and anon.
-- ---------------------------------------------------------------------------
revoke all on function public.get_capture_messaging_settings() from public, anon;
grant execute on function public.get_capture_messaging_settings() to authenticated, service_role;

revoke all on function public.save_capture_messaging_settings(text, integer) from public, anon;
grant execute on function public.save_capture_messaging_settings(text, integer) to authenticated, service_role;

revoke all on function public.start_capture_message_sequence(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.start_capture_message_sequence(uuid, text, integer) to service_role;

revoke all on function public.mark_capture_text_sent_by_private_reply(uuid) from public, anon, authenticated;
grant execute on function public.mark_capture_text_sent_by_private_reply(uuid) to service_role;

revoke all on function public.claim_capture_text_send(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_capture_text_send(uuid, text) to service_role;

revoke all on function public.finalize_capture_text_send(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.finalize_capture_text_send(uuid, text, text, text, integer) to service_role;

revoke all on function public.list_due_capture_text_legs(integer) from public, anon, authenticated;
grant execute on function public.list_due_capture_text_legs(integer) to service_role;

revoke all on function public.list_waiting_capture_texts(integer) from public, anon, authenticated;
grant execute on function public.list_waiting_capture_texts(integer) to service_role;

revoke all on function public.has_capture_routing_work() from public, anon;
grant execute on function public.has_capture_routing_work() to authenticated, service_role;
