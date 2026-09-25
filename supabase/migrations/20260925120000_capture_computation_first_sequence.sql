-- COMPUTATION FIRST PRIVATE REPLY SEQUENCE (Owner 2026-09-25).
--
-- Adds a third messaging sequence for Incoming Captures, next to Screenshot First and Classic:
--   computation_first: the computation TEXT is the first message. Once it is confirmed sent, the
--     SCREENSHOT is attempted at once, as its own request (content_ids, never with text), up to N
--     total attempts (N = "Screenshot Send Attempts", 1..3, default 3). Only transient failures
--     are retried. If the screenshot is still blocked, or Facebook needs the customer to message
--     first, the capture WAITS; a genuine customer reply then sends the screenshot ONCE.
--     A comment-only customer gets the computation as the one Private Reply (the proven path);
--     Facebook accepts no screenshot for them until they message the page, so the screenshot
--     waits for that message.
--
-- The rules live HERE, in the database every build shares, so an old browser tab cannot break
-- the order (the lesson of 2026-09-24):
--   * claim_capture_photo_send refuses a computation_first screenshot until the computation is
--     sent (HARD GATE, whichever build or path asks);
--   * claim_share_link_send refuses a Private Reply once the computation leg started in
--     Messenger, so the computation can never go twice;
--   * the screenshot leg has its own atomic claim / finalize with an attempt budget, a persisted
--     backoff, a 2-minute lease and an 'unconfirmed' state that is never re-sent automatically.
--
-- SCREENSHOT FIRST AND CLASSIC ARE UNCHANGED. Every re-created function keeps its live body for
-- those sequences; the new branches apply only to message_sequence = 'computation_first', and no
-- capture can have that value until the Owner selects Computation First in Settings.
--
-- STRICTLY ADDITIVE AND BACKWARD-COMPATIBLE: new nullable columns plus two with constant defaults
-- (metadata-only, no table rewrite), two widened check constraints, one partial index, new
-- SECURITY DEFINER functions, and re-created functions that are strict supersets of their live
-- bodies (live md5s checked 2026-09-25, recorded below). No data changes. The web build that is
-- live now (a5a3373) ignores every new column and cannot select the new value, so this can be
-- applied before the matching web build is deployed.
--
-- LIVE BODIES THIS WAS WRITTEN AGAINST (md5 of pg_get_functiondef, 2026-09-25):
--   app_private.stamp_capture_message_sequence   6a0a087e17ff109b4c4e9f28b839c332
--   start_capture_message_sequence               d2e75ec8292c5b04069295dc4e78b821
--   mark_capture_text_sent_by_private_reply      565e6fb6d4366cf490f6b65b31f0114a
--   claim_capture_text_send                      828017a236c0a8ccbdbf70dcbc07b9f7
--   list_due_capture_text_legs                   63772d4158e4523f9eead71c123121d7
--   list_waiting_capture_texts                   0dc3cb91e4b14c4a3351f2014386ab78
--   has_capture_routing_work                     baaee3ffb430976aa2adf0460d4774bd
--   claim_share_link_send                        3a8ce514a84af117d61303640a31a504
--   claim_capture_photo_send                     fa2a929b841092b9c58b8ec8b2e0400b
--   reset_capture_for_retry                      3b4ed65f2e72eecf7ba188ca20f709cf
--   get_capture_messaging_settings               9844efcb2fe2e687b3b007a0d8ff0b3d
--   save_capture_messaging_settings              d15037288cc3122e12a4cb135fd8bffc
--
-- ROLLBACK (only if ever needed; the columns can simply stay unused):
--   1. Settings -> Messages: choose Screenshot First or Classic (no new capture is stamped
--      computation_first after that).
--   2. Re-create the twelve functions above from the save point schema taken before applying
--      (its _functions table holds their exact definitions and ACLs).
--   3. drop function public.claim_capture_photo_leg(uuid, text, text),
--                   public.finalize_capture_photo_leg(uuid, text, text, text, integer),
--                   public.park_capture_photo_leg(uuid, text),
--                   public.set_capture_sequence_conversation(uuid, text),
--                   public.list_due_capture_photo_legs(integer),
--                   public.list_waiting_capture_photos(integer);
--   The widened check constraints may stay (they only allow one more value).

-- ---------------------------------------------------------------------------
-- 1. Settings: the new sequence value and Screenshot Send Attempts.
-- ---------------------------------------------------------------------------
alter table public.pancake_integration_config
  add column if not exists screenshot_send_attempts smallint not null default 3;

do $$
begin
  alter table public.pancake_integration_config
    add constraint pancake_config_screenshot_send_attempts_ck
    check (screenshot_send_attempts between 1 and 3);
exception when duplicate_object then null;
end $$;

alter table public.pancake_integration_config
  drop constraint if exists pancake_config_private_reply_sequence_ck;
alter table public.pancake_integration_config
  add constraint pancake_config_private_reply_sequence_ck
  check (private_reply_sequence in ('screenshot_first', 'computation_first', 'classic'));

-- ---------------------------------------------------------------------------
-- 2. Per-capture screenshot leg (Computation First only). Each capture keeps its OWN state.
--    photo_send_status:
--      pending        the screenshot may be attempted (subject to photo_next_at)
--      sending        one worker holds the claim (message_status 'sending', 2-minute lease)
--      sent           the screenshot was delivered (message_status 'sent' is the canonical proof)
--      waiting_reply  attempts used up, or Facebook needs the customer to message first
--      failed         cannot be sent automatically (configuration, token or a rejected image)
--      unconfirmed    the request may have reached Pancake; never re-sent automatically
-- ---------------------------------------------------------------------------
alter table public.capture_records
  add column if not exists photo_send_status text,
  add column if not exists photo_attempts smallint not null default 0,
  add column if not exists photo_max_attempts smallint,
  add column if not exists photo_next_at timestamptz,
  add column if not exists photo_waiting_since timestamptz,
  add column if not exists photo_last_code text;

alter table public.capture_records
  drop constraint if exists capture_records_message_sequence_ck;
alter table public.capture_records
  add constraint capture_records_message_sequence_ck
  check (message_sequence is null or message_sequence in ('screenshot_first', 'computation_first', 'classic'));

do $$
begin
  alter table public.capture_records
    add constraint capture_records_photo_send_status_ck
    check (photo_send_status is null or photo_send_status in
      ('pending', 'sending', 'sent', 'waiting_reply', 'failed', 'unconfirmed'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.capture_records
    add constraint capture_records_photo_max_attempts_ck
    check (photo_max_attempts is null or photo_max_attempts between 1 and 3);
exception when duplicate_object then null;
end $$;

-- The sweeps read only this small, recent working set.
create index if not exists capture_records_cf_leg_idx
  on public.capture_records (created_at)
  where message_sequence = 'computation_first';

-- ---------------------------------------------------------------------------
-- 3. Snapshot at creation (live body + computation_first). A new capture takes the Owner's
--    current sequence and attempt limits the moment it is inserted, whichever build inserts it.
-- ---------------------------------------------------------------------------
create or replace function app_private.stamp_capture_message_sequence()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_mode text;
  v_attempts integer;
  v_shots integer;
begin
  if new.message_sequence is null then
    select c.private_reply_sequence, c.text_send_attempts, c.screenshot_send_attempts
      into v_mode, v_attempts, v_shots
      from public.pancake_integration_config c
     limit 1;
    -- No config row, or an unknown value: leave it unstamped, so the first send stamps it.
    if v_mode in ('screenshot_first', 'computation_first', 'classic') then
      new.message_sequence := v_mode;
      new.text_max_attempts := case
        when v_mode = 'screenshot_first' then greatest(1, least(coalesce(v_attempts, 3), 3))
        -- Computation First: the computation's own transient-only retries, 3 in all.
        when v_mode = 'computation_first' then 3
        else null
      end;
      new.photo_max_attempts := case
        when v_mode = 'computation_first' then greatest(1, least(coalesce(v_shots, 3), 3))
        else null
      end;
    end if;
  end if;
  return new;
end
$$;

revoke all on function app_private.stamp_capture_message_sequence() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Set-once stamp (live body + computation_first). p_max_attempts is the Owner's attempt
--    setting for the chosen sequence: text attempts on Screenshot First, screenshot attempts on
--    Computation First.
-- ---------------------------------------------------------------------------
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
  if p_mode is null or p_mode not in ('screenshot_first', 'computation_first', 'classic') then
    raise exception 'Unknown messaging sequence.' using errcode = 'check_violation';
  end if;
  update public.capture_records
     set message_sequence = p_mode,
         text_max_attempts = case
           when p_mode = 'screenshot_first' then greatest(1, least(coalesce(p_max_attempts, 3), 3))
           when p_mode = 'computation_first' then 3
           else null end,
         photo_max_attempts = case
           when p_mode = 'computation_first' then greatest(1, least(coalesce(p_max_attempts, 3), 3))
           else null end
   where id = p_capture_id and message_sequence is null;
  -- A capture whose computation ALREADY went as its Private Reply has its text done: record it.
  update public.capture_records c
     set text_send_status = 'sent', text_sent_via = 'private_reply',
         text_sent_at = coalesce(c.text_sent_at, now()), text_last_code = 'private_reply'
   where c.id = p_capture_id
     and c.message_sequence in ('screenshot_first', 'computation_first')
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

-- Live body + computation_first: a computation Private Reply is recorded as the text.
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
     and message_sequence in ('screenshot_first', 'computation_first')
     and coalesce(private_reply_kind, 'computation') = 'computation'
     and coalesce(text_send_status, '') <> 'sent';
  select c.text_send_status into v_status from public.capture_records c where c.id = p_capture_id;
  return v_status;
end
$function$;

-- ---------------------------------------------------------------------------
-- 5. The computation claim (live body + computation_first). On Screenshot First the screenshot
--    must be 'sent' first, exactly as before. On Computation First the computation IS first, so
--    there is no screenshot prerequisite; everything else (the Private Reply ledger, the lease,
--    the attempt budget, waiting for a reply) is the same code.
-- ---------------------------------------------------------------------------
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

  if r.message_sequence is null
     or r.message_sequence not in ('screenshot_first', 'computation_first') then
    return 'not_applicable';
  end if;
  v_status := coalesce(r.text_send_status, 'pending');
  if v_status = 'sent' then return 'already_sent'; end if;

  if coalesce(r.private_reply_kind, 'computation') = 'computation' then
    -- The computation already went as this capture's ONE Private Reply: never send it again.
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
    -- A Private Reply stuck 'sending' or marked 'failed' after contacting Pancake MAY have been
    -- delivered: never add a second computation on top of it. Staff check the chat.
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
  -- Screenshot First only: IMAGE THEN TEXT.
  if r.message_sequence = 'screenshot_first' and coalesce(r.message_status, '') <> 'sent' then
    return 'not_ready';
  end if;
  if v_status in ('failed', 'unconfirmed') then return v_status; end if;

  if v_status = 'sending' then
    if r.text_claimed_at is not null and r.text_claimed_at > now() - interval '2 minutes' then
      return 'in_progress';
    end if;
    -- The worker holding the claim vanished mid-send: the request may have reached Pancake.
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

-- Due computation retries (live body + a computation_first branch). The Screenshot First branch
-- is the live predicate, unchanged. A Computation First computation is STARTED by the router
-- (which first decides Messenger vs Private Reply); this list only continues one already begun.
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
    and (
      (
        c.message_sequence = 'screenshot_first'
        and c.message_status = 'sent'
        and (
          c.text_send_status is null
          or (c.text_send_status = 'pending' and (c.text_next_at is null or c.text_next_at <= now()))
          or (c.text_send_status = 'sending'
              and (c.text_claimed_at is null or c.text_claimed_at < now() - interval '2 minutes'))
        )
      )
      or (
        c.message_sequence = 'computation_first'
        and (
          (c.text_send_status = 'pending' and (c.text_next_at is null or c.text_next_at <= now()))
          or (c.text_send_status = 'sending'
              and (c.text_claimed_at is null or c.text_claimed_at < now() - interval '2 minutes'))
        )
      )
    )
    and c.created_at > now() - interval '3 days'
  order by coalesce(c.text_next_at, c.created_at) asc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
end
$function$;

-- Computations waiting for a customer reply (live body, both sequences).
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
    and c.message_sequence in ('screenshot_first', 'computation_first')
    and c.text_send_status = 'waiting_reply'
    and c.pancake_conversation_id is not null
    and c.created_at > now() - interval '3 days'
  order by c.text_waiting_since asc nulls first
  limit greatest(1, least(coalesce(p_limit, 100), 200));
end
$function$;

-- ---------------------------------------------------------------------------
-- 6. The screenshot leg (Computation First only).
-- ---------------------------------------------------------------------------

-- Store the Messenger conversation the computation goes to: the one the router just verified (on
-- the active page, with an open chat). The same rule as finalize_capture_photo_send, which stores
-- the conversation a screenshot was delivered to; an empty value never erases the stored one.
-- Returns the capture's effective conversation.
create or replace function public.set_capture_sequence_conversation(p_capture_id uuid, p_conversation_id text)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare v_conv text;
begin
  if not app_private.is_service_role() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  update public.capture_records
     set pancake_conversation_id = coalesce(nullif(trim(p_conversation_id), ''), pancake_conversation_id)
   where id = p_capture_id;
  select c.pancake_conversation_id into v_conv from public.capture_records c where c.id = p_capture_id;
  return v_conv;
end
$function$;

-- Atomically claim ONE screenshot attempt. HARD RULE: the computation must already be sent.
-- p_trigger 'auto' obeys the attempt budget and the backoff; 'reply' is the single send unlocked
-- by a genuine customer reply. The claim also takes the capture's shared photo lock
-- (message_status 'sending'), so a manual Send can never run alongside it.
-- Returns: claimed | already_sent | text_not_sent | in_progress | not_due | waiting_reply |
--          failed | unconfirmed | not_applicable | not_found
create or replace function public.claim_capture_photo_leg(
  p_capture_id uuid,
  p_conversation_id text,
  p_trigger text default 'auto'
)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r record;
  v_status text;
  v_ledger_sent boolean;
begin
  if not app_private.is_service_role() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  if p_trigger is null or p_trigger not in ('auto', 'reply') then
    raise exception 'Unknown trigger.' using errcode = 'check_violation';
  end if;

  select c.message_sequence, c.message_status, c.send_claimed_at, c.text_send_status,
         c.private_reply_kind, c.photo_send_status, c.photo_attempts, c.photo_max_attempts,
         c.photo_next_at
    into r
  from public.capture_records c
  where c.id = p_capture_id
  for update;
  if not found then return 'not_found'; end if;
  if r.message_sequence is distinct from 'computation_first' then return 'not_applicable'; end if;

  -- The screenshot is out (whichever path sent it): record it on the leg, never send again.
  if coalesce(r.message_status, '') = 'sent' then
    update public.capture_records
       set photo_send_status = 'sent', photo_next_at = null, photo_waiting_since = null
     where id = p_capture_id and photo_send_status is distinct from 'sent';
    return 'already_sent';
  end if;

  -- COMPUTATION FIRST: nothing before the computation.
  if coalesce(r.text_send_status, '') <> 'sent' then
    v_ledger_sent := coalesce(r.private_reply_kind, 'computation') = 'computation' and exists (
      select 1 from public.capture_share_links s
      where s.capture_record_id = p_capture_id and s.private_reply_status = 'sent'
    );
    if not v_ledger_sent then return 'text_not_sent'; end if;
    update public.capture_records
       set text_send_status = 'sent', text_sent_via = 'private_reply',
           text_sent_at = coalesce(text_sent_at, now()), text_next_at = null,
           text_claimed_at = null, text_waiting_since = null, text_last_code = 'private_reply'
     where id = p_capture_id;
  end if;

  -- Another send holds the capture's photo lock.
  if coalesce(r.message_status, '') = 'sending' then
    if r.send_claimed_at is not null and r.send_claimed_at > now() - interval '2 minutes' then
      return 'in_progress';
    end if;
    -- Its worker vanished mid-send: the screenshot may have reached the customer. Never re-send
    -- blindly; staff check the chat.
    update public.capture_records
       set photo_send_status = 'unconfirmed', message_status = 'failed', send_claimed_at = null,
           photo_next_at = null, photo_last_code = 'stale_claim'
     where id = p_capture_id;
    return 'unconfirmed';
  end if;

  v_status := coalesce(r.photo_send_status, 'pending');
  if v_status in ('failed', 'unconfirmed') then return v_status; end if;
  if v_status = 'sending' then
    -- The leg says 'sending' but the photo lock is gone: the outcome was never recorded.
    update public.capture_records
       set photo_send_status = 'unconfirmed', message_status = 'failed', send_claimed_at = null,
           photo_next_at = null, photo_last_code = 'lost_claim'
     where id = p_capture_id;
    return 'unconfirmed';
  end if;
  if v_status = 'waiting_reply' and p_trigger <> 'reply' then return 'waiting_reply'; end if;

  if v_status = 'pending' and p_trigger = 'auto' then
    if r.photo_next_at is not null and r.photo_next_at > now() then return 'not_due'; end if;
    if r.photo_attempts >= coalesce(r.photo_max_attempts, 3) then
      update public.capture_records
         set photo_send_status = 'waiting_reply', photo_waiting_since = now(), photo_next_at = null,
             message_status = 'link_sent'
       where id = p_capture_id;
      return 'waiting_reply';
    end if;
  end if;

  update public.capture_records
     set message_status = 'sending',
         send_claimed_at = now(),
         pancake_conversation_id = coalesce(nullif(trim(pancake_conversation_id), ''), nullif(trim(p_conversation_id), '')),
         photo_send_status = 'sending',
         photo_attempts = photo_attempts + 1,
         photo_next_at = null
   where id = p_capture_id;
  return 'claimed';
end
$function$;

-- Finalize the claimed screenshot attempt. 'retry' returns to 'pending' (with the persisted
-- backoff) while attempts remain, else 'waiting_reply'. message_status follows, so every other
-- path and the Incoming Captures card see the same state:
--   sent → 'sent' · pending → 'pending' · waiting_reply → 'link_sent' · failed/unconfirmed → 'failed'
-- Returns the new leg status, or 'not_claimed' when this worker holds no claim.
create or replace function public.finalize_capture_photo_leg(
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

  select c.photo_send_status, c.message_status, c.photo_attempts, c.photo_max_attempts
    into r
  from public.capture_records c
  where c.id = p_capture_id
  for update;
  if not found then return 'not_found'; end if;
  if r.photo_send_status is distinct from 'sending' or r.message_status is distinct from 'sending' then
    return 'not_claimed';
  end if;

  v_next := case
    when p_outcome = 'retry' then
      case when r.photo_attempts < coalesce(r.photo_max_attempts, 3) then 'pending' else 'waiting_reply' end
    else p_outcome
  end;

  update public.capture_records
     set photo_send_status = v_next,
         message_status = case v_next
           when 'sent' then 'sent'
           when 'pending' then 'pending'
           when 'waiting_reply' then 'link_sent'
           else 'failed' end,
         send_claimed_at = null,
         pancake_message_id = case
           when v_next = 'sent' then coalesce(nullif(trim(p_message_id), ''), pancake_message_id)
           else pancake_message_id end,
         photo_last_code = left(coalesce(nullif(trim(p_code), ''), p_outcome), 60),
         photo_next_at = case
           when v_next = 'pending' then
             now() + make_interval(secs => greatest(0, least(coalesce(p_retry_after_seconds, 0), 3600)))
           else null end,
         photo_waiting_since = case when v_next = 'waiting_reply' then now() else null end
   where id = p_capture_id;
  return v_next;
end
$function$;

-- The screenshot cannot be attempted now because Facebook needs the customer to message first
-- (a comment-only customer, or no open Messenger window): wait for a genuine reply without any
-- request. Only after the computation is sent, and never over a sent / in-flight screenshot.
create or replace function public.park_capture_photo_leg(p_capture_id uuid, p_code text default null)
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
     set photo_send_status = 'waiting_reply',
         photo_waiting_since = case
           when photo_send_status = 'waiting_reply' then coalesce(photo_waiting_since, now())
           else now() end,
         photo_next_at = null,
         photo_last_code = left(coalesce(nullif(trim(p_code), ''), 'waiting_reply'), 60),
         message_status = 'link_sent'
   where id = p_capture_id
     and message_sequence = 'computation_first'
     and text_send_status = 'sent'
     and coalesce(message_status, '') not in ('sent', 'sending')
     and (photo_send_status is null or photo_send_status in ('pending', 'waiting_reply'));
  select c.photo_send_status into v_status from public.capture_records c where c.id = p_capture_id;
  return v_status;
end
$function$;

-- Screenshot attempts that are DUE: never started after the computation, a retry whose time has
-- come, or a claim lost mid-request (the claim turns that into 'unconfirmed'). Oldest due first.
create or replace function public.list_due_capture_photo_legs(p_limit integer default 20)
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
    and c.message_sequence = 'computation_first'
    and c.text_send_status = 'sent'
    and coalesce(c.message_status, '') <> 'sent'
    and (
      c.photo_send_status is null
      or (c.photo_send_status = 'pending' and (c.photo_next_at is null or c.photo_next_at <= now()))
      or (c.photo_send_status = 'sending'
          and (c.send_claimed_at is null or c.send_claimed_at < now() - interval '2 minutes'))
    )
    and c.created_at > now() - interval '3 days'
  order by coalesce(c.photo_next_at, c.created_at) asc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
end
$function$;

-- Screenshots waiting for a customer reply (the every-minute missed-reply fallback checks each
-- one for a genuine reply SINCE it began waiting). Oldest wait first.
create or replace function public.list_waiting_capture_photos(p_limit integer default 100)
returns table (id uuid, pancake_conversation_id text, photo_waiting_since timestamptz)
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
  select c.id, c.pancake_conversation_id, c.photo_waiting_since
  from public.capture_records c
  where c.source = 'floating' and c.is_test = false and c.official_order_id is null
    and c.confirmed is null
    and c.message_sequence = 'computation_first'
    and c.photo_send_status = 'waiting_reply'
    and coalesce(c.message_status, '') <> 'sent'
    and c.pancake_conversation_id is not null
    and c.created_at > now() - interval '3 days'
  order by c.photo_waiting_since asc nulls first
  limit greatest(1, least(coalesce(p_limit, 100), 200));
end
$function$;

-- ---------------------------------------------------------------------------
-- 7. The cheap sweep guard (live body + ONE branch for Computation First work that is DUE).
--    Captures merely WAITING for a reply do not wake it. Strict superset of the live body.
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
        or (
          c.message_sequence = 'computation_first'
          and c.confirmed is null
          and c.created_at > now() - interval '3 days'
          and (
            (c.text_send_status = 'pending' and (c.text_next_at is null or c.text_next_at <= now()))
            or (c.text_send_status = 'sending'
                and (c.text_claimed_at is null or c.text_claimed_at < now() - interval '2 minutes'))
            or (
              c.text_send_status = 'sent'
              and coalesce(c.message_status, '') <> 'sent'
              and (
                c.photo_send_status is null
                or (c.photo_send_status = 'pending' and (c.photo_next_at is null or c.photo_next_at <= now()))
                or (c.photo_send_status = 'sending'
                    and (c.send_claimed_at is null or c.send_claimed_at < now() - interval '2 minutes'))
              )
            )
          )
        )
      )
  );
end
$function$;

-- ---------------------------------------------------------------------------
-- 8. HARD GATES in the two shared send claims (live bodies + one check each).
-- ---------------------------------------------------------------------------

-- Every screenshot send (router, reply, manual Send, any build) claims here. On Computation First
-- it is refused until the computation is sent.
create or replace function public.claim_capture_photo_send(p_capture_id uuid, p_conversation_id text)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare v_prev text;
begin
  if not (app_private.has_permission('claim_capture') or app_private.is_service_role()) then
    raise exception 'Not authorized: the claim_capture permission is required.' using errcode = 'insufficient_privilege';
  end if;
  -- HARD GATE (Owner 2026-09-25): Computation First sends nothing before the computation.
  if exists (
    select 1
      from public.capture_records c
     where c.id = p_capture_id
       and c.message_sequence = 'computation_first'
       and coalesce(c.message_status, '') <> 'sent'
       and coalesce(c.text_send_status, '') <> 'sent'
       and not exists (
         select 1 from public.capture_share_links s
          where s.capture_record_id = c.id and s.private_reply_status = 'sent'
       )
  ) then
    return 'computation_first';
  end if;
  update public.capture_records
    set message_status = 'sending', send_claimed_at = now(),
        pancake_conversation_id = coalesce(nullif(trim(pancake_conversation_id), ''), nullif(trim(p_conversation_id), ''))
    where id = p_capture_id and coalesce(message_status, '') <> 'sent'
      and (coalesce(message_status, '') <> 'sending' or send_claimed_at is null or send_claimed_at < now() - interval '2 minutes');
  if found then return 'claimed'; end if;
  select message_status into v_prev from public.capture_records where id = p_capture_id;
  if not found then return 'not_found'; end if;
  if v_prev = 'sent' then return 'already_sent'; end if;
  return 'in_progress';
end $function$;

-- Every comment Private Reply claims here. On Computation First the computation goes ONCE: once
-- its Messenger send has started, no Private Reply may carry it again.
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
  -- HARD GATE (Owner 2026-09-25): on Computation First the computation is sent once. If it
  -- already started in Messenger, it is never sent again as a Private Reply.
  if exists (
    select 1
      from public.capture_share_links s
      join public.capture_records c on c.id = s.capture_record_id
     where s.id = p_id
       and c.message_sequence = 'computation_first'
       and c.text_send_status is not null
       and s.private_reply_status is distinct from 'sent'
  ) then
    return 'computation_sent';
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

-- The operator's explicit Retry (live body + one step): on Computation First a failed or
-- unconfirmed SCREENSHOT gets a fresh set of attempts. The computation is never reset.
create or replace function public.reset_capture_for_retry(p_capture_id uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not (app_private.has_permission('claim_capture') or app_private.is_service_role()) then
    raise exception 'Not authorized: the claim_capture permission is required.' using errcode = 'insufficient_privilege';
  end if;

  update public.capture_records
    set message_status = 'awaiting_inbox', route_attempts = 0, route_next_at = null,
        route_reason = 'AUTO TEXT retry requested'
    where id = p_capture_id
      and coalesce(message_status, '') in ('failed', 'awaiting_inbox', 'pending');
  if not found then
    return 'not_retryable';
  end if;

  -- A FAILED Private Reply never delivered, so it may be re-attempted; a 'sent' link is left alone
  -- (re-opening it WOULD risk a duplicate reply). One-reply-per-comment stays intact.
  update public.capture_share_links
    set private_reply_status = 'pending', send_claimed_at = null
    where capture_record_id = p_capture_id and private_reply_status = 'failed';

  -- Computation First: the operator chose to try the screenshot again.
  update public.capture_records
    set photo_send_status = null, photo_attempts = 0, photo_next_at = null,
        photo_waiting_since = null, photo_last_code = 'retry_requested'
    where id = p_capture_id
      and message_sequence = 'computation_first'
      and photo_send_status in ('failed', 'unconfirmed');

  return 'reset';
end
$function$;

-- ---------------------------------------------------------------------------
-- 9. Settings read / save (live bodies + the new value and Screenshot Send Attempts).
--    p_attempts is the attempt setting of the chosen sequence: Text Send Attempts on Screenshot
--    First (and Classic, as before), Screenshot Send Attempts on Computation First. The other
--    setting keeps its saved value.
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
           'screenshot_attempts', c.screenshot_send_attempts,
           'updated_at', c.messaging_updated_at)
    into v
  from public.pancake_integration_config c
  where c.id = true;
  return coalesce(v, jsonb_build_object(
    'mode', 'screenshot_first', 'attempts', 3, 'screenshot_attempts', 3, 'updated_at', null));
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
  if p_mode is null or p_mode not in ('screenshot_first', 'computation_first', 'classic') then
    raise exception 'Unknown messaging sequence.' using errcode = 'check_violation';
  end if;
  if p_attempts is null or p_attempts < 1 or p_attempts > 3 then
    raise exception 'Send attempts must be between 1 and 3.' using errcode = 'check_violation';
  end if;
  select sp.id into v_staff from public.staff_profiles sp where sp.auth_user_id = (select auth.uid());
  insert into public.pancake_integration_config
    (id, private_reply_sequence, text_send_attempts, screenshot_send_attempts,
     messaging_updated_at, messaging_updated_by)
  values (
    true, p_mode,
    case when p_mode = 'computation_first' then 3 else p_attempts end,
    case when p_mode = 'computation_first' then p_attempts else 3 end,
    now(), v_staff)
  on conflict (id) do update
    set private_reply_sequence = excluded.private_reply_sequence,
        text_send_attempts = case
          when excluded.private_reply_sequence = 'computation_first'
            then public.pancake_integration_config.text_send_attempts
          else excluded.text_send_attempts end,
        screenshot_send_attempts = case
          when excluded.private_reply_sequence = 'computation_first'
            then excluded.screenshot_send_attempts
          else public.pancake_integration_config.screenshot_send_attempts end,
        messaging_updated_at = excluded.messaging_updated_at,
        messaging_updated_by = excluded.messaging_updated_by;
  return jsonb_build_object('mode', p_mode, 'attempts', p_attempts, 'updated_at', now());
end
$function$;

-- ---------------------------------------------------------------------------
-- 10. Grants. Every new definer function is closed to PUBLIC, anon and authenticated; re-created
--     functions keep exactly the grants they had.
-- ---------------------------------------------------------------------------
revoke all on function public.start_capture_message_sequence(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.start_capture_message_sequence(uuid, text, integer) to service_role;

revoke all on function public.mark_capture_text_sent_by_private_reply(uuid) from public, anon, authenticated;
grant execute on function public.mark_capture_text_sent_by_private_reply(uuid) to service_role;

revoke all on function public.claim_capture_text_send(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_capture_text_send(uuid, text) to service_role;

revoke all on function public.list_due_capture_text_legs(integer) from public, anon, authenticated;
grant execute on function public.list_due_capture_text_legs(integer) to service_role;

revoke all on function public.list_waiting_capture_texts(integer) from public, anon, authenticated;
grant execute on function public.list_waiting_capture_texts(integer) to service_role;

revoke all on function public.set_capture_sequence_conversation(uuid, text) from public, anon, authenticated;
grant execute on function public.set_capture_sequence_conversation(uuid, text) to service_role;

revoke all on function public.claim_capture_photo_leg(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_capture_photo_leg(uuid, text, text) to service_role;

revoke all on function public.finalize_capture_photo_leg(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.finalize_capture_photo_leg(uuid, text, text, text, integer) to service_role;

revoke all on function public.park_capture_photo_leg(uuid, text) from public, anon, authenticated;
grant execute on function public.park_capture_photo_leg(uuid, text) to service_role;

revoke all on function public.list_due_capture_photo_legs(integer) from public, anon, authenticated;
grant execute on function public.list_due_capture_photo_legs(integer) to service_role;

revoke all on function public.list_waiting_capture_photos(integer) from public, anon, authenticated;
grant execute on function public.list_waiting_capture_photos(integer) to service_role;

revoke all on function public.has_capture_routing_work() from public, anon;
grant execute on function public.has_capture_routing_work() to authenticated, service_role;

revoke all on function public.claim_capture_photo_send(uuid, text) from public, anon;
grant execute on function public.claim_capture_photo_send(uuid, text) to authenticated, service_role;

revoke all on function public.claim_share_link_send(uuid) from public, anon;
grant execute on function public.claim_share_link_send(uuid) to authenticated, service_role;

revoke all on function public.reset_capture_for_retry(uuid) from public, anon;
grant execute on function public.reset_capture_for_retry(uuid) to authenticated, service_role;

revoke all on function public.get_capture_messaging_settings() from public, anon;
grant execute on function public.get_capture_messaging_settings() to authenticated, service_role;

revoke all on function public.save_capture_messaging_settings(text, integer) from public, anon;
grant execute on function public.save_capture_messaging_settings(text, integer) to authenticated, service_role;
