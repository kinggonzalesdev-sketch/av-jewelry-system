-- Secure screenshot-link workaround (Owner 2026-08-21) — Route B.
-- A first-time / not-yet-inbox-eligible miner cannot receive a normal Inbox PHOTO. Instead we
-- send ONE Pancake Private Reply TEXT to their EXACT resolved Live comment, carrying a secure
-- opaque link (/m/{token}) to the capture screenshot. Purely additive; touches nothing existing.
--
-- Safety pillars encoded here:
--   • token stored as SHA-256 hash (public lookup) + AES-GCM ciphertext (server recovery) — the
--     raw token is NEVER stored in plaintext, so a DB read can't reveal a valid link.
--   • UNIQUE(page_id, post_id, comment_id) = one link (and one reply) per Facebook comment.
--   • private_reply_status is a compare-and-set state machine (pending→sending→sent) so two
--     phones / retries / manual+auto cannot both send.
--   • resolved comment identity is PERSISTED on the row — later ops never re-match by name.

create table if not exists public.capture_share_links (
  id uuid primary key default gen_random_uuid(),
  capture_record_id uuid not null references public.capture_records(id) on delete cascade,
  -- Exact, PERSISTED Facebook Live comment identity (resolved ONCE; never re-matched by name).
  page_id text not null,
  post_id text not null,
  comment_id text not null,
  facebook_psid text,
  conversation_id text,
  comment_event_timestamp timestamptz,
  -- Opaque token: hash for public lookup, ciphertext for same-URL recovery. Never plaintext.
  token_hash text not null,
  token_ciphertext text not null,
  -- Private Reply send state machine (atomic claim): pending → sending → sent | failed.
  private_reply_status text not null default 'pending'
    check (private_reply_status in ('pending','sending','sent','failed')),
  send_claimed_at timestamptz,
  private_reply_sent_at timestamptz,
  pancake_message_id text,
  -- Link lifecycle.
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  -- ONE link / ONE reply per exact comment (the idempotency anchor).
  constraint capture_share_links_comment_uniq unique (page_id, post_id, comment_id)
);

create unique index if not exists capture_share_links_token_hash_uniq
  on public.capture_share_links (token_hash);
create index if not exists capture_share_links_capture_idx
  on public.capture_share_links (capture_record_id);

-- RLS: NO direct client access. Every read/write goes through the SECURITY DEFINER RPCs below
-- (so the token columns are never selectable by a browser client). The service role — used only
-- by the public /m route, server-side — bypasses RLS. No permissive policy is created on purpose.
alter table public.capture_share_links enable row level security;

revoke all on public.capture_share_links from anon, authenticated;

-- ============================================================================================
-- resolve_exact_live_comment — the STRICT wrong-customer guard (Owner-approved rule).
-- Returns the EXACT comment identity ONLY when it is unambiguous, else {matchCount, reason}.
--   1. unique resolved Facebook identity (one psid) for the name on the active page, ≤7 days;
--   2. that psid has exactly ONE qualifying Live comment  → use it;
--   3. if 2+ comments, use the ONE whose text contains the captured claim value  → use it;
--   4. anything else (0 / 2+ after value filter, or a shared name) → null. Never guess.
-- ============================================================================================
create or replace function public.resolve_exact_live_comment(
  p_name text,
  p_value text,
  p_active_page text
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_norm text;
  v_key text;
  v_psid text;
  v_psid_count int;
  v_row public.pancake_webhook_events;
  v_comment_count int;
  v_val text;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  v_norm := app_private.normalize_name(coalesce(p_name, ''));
  if length(v_norm) < 2 then
    return jsonb_build_object('resolved', false, 'reason', 'name_too_short', 'matchCount', 0);
  end if;

  -- (1) Unique psid for this name among recent (7d) Live comments on the active page.
  with live as (
    select distinct e.facebook_psid, e.facebook_name
    from public.pancake_webhook_events e
    where e.facebook_psid is not null
      and e.page_id is not null
      and e.comment_id is not null
      and e.livestream_post_id is not null
      and (coalesce(p_active_page, '') = '' or e.page_id = p_active_page)
      and e.event_timestamp > now() - interval '7 days'
  )
  select count(*), max(facebook_psid) into v_psid_count, v_psid
  from live where app_private.normalize_name(facebook_name) = v_norm;

  if v_psid_count = 0 then
    -- First+last (middle-name tolerant) fallback, still unique-gated.
    v_key := app_private.name_key(coalesce(p_name, ''));
    if v_key <> '' then
      with live as (
        select distinct e.facebook_psid, e.facebook_name
        from public.pancake_webhook_events e
        where e.facebook_psid is not null
          and e.page_id is not null
          and e.comment_id is not null
          and e.livestream_post_id is not null
          and (coalesce(p_active_page, '') = '' or e.page_id = p_active_page)
          and e.event_timestamp > now() - interval '7 days'
      )
      select count(*), max(facebook_psid) into v_psid_count, v_psid
      from live where app_private.name_key(facebook_name) = v_key;
    end if;
  end if;

  if v_psid_count = 0 then
    return jsonb_build_object('resolved', false, 'reason', 'no_match', 'matchCount', 0);
  end if;
  if v_psid_count > 1 then
    return jsonb_build_object('resolved', false, 'reason', 'ambiguous_identity', 'matchCount', v_psid_count);
  end if;

  -- (2) How many qualifying comments does that unique psid have in the window?
  select count(*) into v_comment_count
  from public.pancake_webhook_events e
  where e.facebook_psid = v_psid
    and e.comment_id is not null
    and e.livestream_post_id is not null
    and (coalesce(p_active_page, '') = '' or e.page_id = p_active_page)
    and e.event_timestamp > now() - interval '7 days';

  if v_comment_count = 1 then
    select * into v_row
    from public.pancake_webhook_events e
    where e.facebook_psid = v_psid
      and e.comment_id is not null
      and e.livestream_post_id is not null
      and (coalesce(p_active_page, '') = '' or e.page_id = p_active_page)
      and e.event_timestamp > now() - interval '7 days'
    order by e.event_timestamp desc
    limit 1;
  else
    -- (3) 2+ comments → require the captured claim value to select EXACTLY one.
    v_val := regexp_replace(coalesce(p_value, ''), '[^0-9.]', '', 'g');
    if v_val = '' then
      return jsonb_build_object('resolved', false, 'reason', 'multiple_comments_no_value', 'matchCount', v_comment_count);
    end if;
    -- value must appear as a WHOLE number token in the comment text (not embedded in a code).
    select count(*) into v_comment_count
    from public.pancake_webhook_events e
    where e.facebook_psid = v_psid
      and e.comment_id is not null
      and e.livestream_post_id is not null
      and (coalesce(p_active_page, '') = '' or e.page_id = p_active_page)
      and e.event_timestamp > now() - interval '7 days'
      and e.comment_text ~ ('(^|[^0-9.])' || regexp_replace(v_val, '\.', '\.', 'g') || '([^0-9]|$)');
    if v_comment_count <> 1 then
      return jsonb_build_object('resolved', false, 'reason', 'ambiguous_claim', 'matchCount', v_comment_count);
    end if;
    select * into v_row
    from public.pancake_webhook_events e
    where e.facebook_psid = v_psid
      and e.comment_id is not null
      and e.livestream_post_id is not null
      and (coalesce(p_active_page, '') = '' or e.page_id = p_active_page)
      and e.event_timestamp > now() - interval '7 days'
      and e.comment_text ~ ('(^|[^0-9.])' || regexp_replace(v_val, '\.', '\.', 'g') || '([^0-9]|$)')
    order by e.event_timestamp desc
    limit 1;
  end if;

  return jsonb_build_object(
    'resolved', true,
    'page_id', v_row.page_id,
    'post_id', v_row.livestream_post_id,
    'comment_id', v_row.comment_id,
    'facebook_psid', v_row.facebook_psid,
    'conversation_id', v_row.conversation_id,
    'event_timestamp', v_row.event_timestamp,
    'matchCount', 1
  );
end $$;

-- ============================================================================================
-- upsert_capture_share_link — idempotent create by (page,post,comment). A concurrent second
-- caller's token is DISCARDED; both read back the winning row (ONE link / ONE token per comment).
-- ============================================================================================
create or replace function public.upsert_capture_share_link(
  p_capture_id uuid,
  p_page text, p_post text, p_comment text,
  p_psid text, p_conversation text, p_event_ts timestamptz,
  p_token_hash text, p_token_ciphertext text,
  p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare v_row public.capture_share_links;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;

  insert into public.capture_share_links(
    capture_record_id, page_id, post_id, comment_id, facebook_psid, conversation_id,
    comment_event_timestamp, token_hash, token_ciphertext, expires_at, created_by
  ) values (
    p_capture_id, p_page, p_post, p_comment, p_psid, p_conversation,
    p_event_ts, p_token_hash, p_token_ciphertext, p_expires_at, auth.uid()
  )
  on conflict (page_id, post_id, comment_id) do nothing;

  select * into v_row from public.capture_share_links
  where page_id = p_page and post_id = p_post and comment_id = p_comment;

  return jsonb_build_object(
    'id', v_row.id,
    'private_reply_status', v_row.private_reply_status,
    'token_ciphertext', v_row.token_ciphertext,
    'revoked_at', v_row.revoked_at,
    'expires_at', v_row.expires_at,
    'capture_record_id', v_row.capture_record_id
  );
end $$;

-- Existing link for a capture — used FIRST so a resolved identity is never re-matched by name.
create or replace function public.find_capture_share_link_for_capture(p_capture_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare v_row public.capture_share_links;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from public.capture_share_links
  where capture_record_id = p_capture_id
  order by created_at asc limit 1;
  if not found then return jsonb_build_object('found', false); end if;
  return jsonb_build_object(
    'found', true, 'id', v_row.id,
    'private_reply_status', v_row.private_reply_status,
    'token_ciphertext', v_row.token_ciphertext,
    'revoked_at', v_row.revoked_at, 'expires_at', v_row.expires_at,
    'page_id', v_row.page_id, 'post_id', v_row.post_id, 'comment_id', v_row.comment_id,
    'facebook_psid', v_row.facebook_psid, 'conversation_id', v_row.conversation_id
  );
end $$;

-- Atomic send claim: only the worker that flips pending→sending may send the Private Reply.
create or replace function public.claim_share_link_send(p_id uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare v_status text; v_revoked timestamptz;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  update public.capture_share_links
    set private_reply_status = 'sending', send_claimed_at = now()
    where id = p_id and private_reply_status = 'pending' and revoked_at is null;
  if found then return 'claimed'; end if;
  select private_reply_status, revoked_at into v_status, v_revoked
    from public.capture_share_links where id = p_id;
  if v_status is null then return 'not_found'; end if;
  if v_revoked is not null then return 'revoked'; end if;
  if v_status = 'sent' then return 'already_sent'; end if;
  return 'in_progress';  -- 'sending' held by another worker, or terminal 'failed'
end $$;

-- Finalize: sent (success) | retry (pre-send failure → back to pending) | failed (terminal review).
create or replace function public.finalize_share_link_send(
  p_id uuid, p_result text, p_msg_id text
) returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  if p_result = 'sent' then
    update public.capture_share_links
      set private_reply_status = 'sent', private_reply_sent_at = now(), pancake_message_id = p_msg_id
      where id = p_id and private_reply_status = 'sending';
  elsif p_result = 'retry' then
    update public.capture_share_links
      set private_reply_status = 'pending', send_claimed_at = null
      where id = p_id and private_reply_status = 'sending';
  else
    update public.capture_share_links
      set private_reply_status = 'failed'
      where id = p_id and private_reply_status = 'sending';
  end if;
end $$;

-- Revoke a link (Owner/Admin path may call via a server action; DEFINER-gated to active staff).
create or replace function public.revoke_capture_share_link(p_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  update public.capture_share_links set revoked_at = now()
    where id = p_id and revoked_at is null;
end $$;

-- ============================================================================================
-- resolve_capture_share_link — PUBLIC token lookup for the /m route (called server-side by the
-- service role only). Returns the minimal validity + the screenshot storage path (which the
-- route signs short-lived). NEVER returns the token or any customer/order identifiers.
-- ============================================================================================
create or replace function public.resolve_capture_share_link(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare v_link public.capture_share_links; v_path text;
begin
  select * into v_link from public.capture_share_links where token_hash = p_token_hash;
  if not found then return jsonb_build_object('valid', false, 'reason', 'not_found'); end if;
  if v_link.revoked_at is not null then return jsonb_build_object('valid', false, 'reason', 'revoked'); end if;
  if v_link.expires_at < now() then return jsonb_build_object('valid', false, 'reason', 'expired'); end if;
  select screenshot_path into v_path from public.capture_records where id = v_link.capture_record_id;
  if v_path is null or v_path = '' then
    return jsonb_build_object('valid', false, 'reason', 'no_screenshot');
  end if;
  return jsonb_build_object('valid', true, 'screenshot_path', v_path);
end $$;

-- Lock down EXECUTE: staff RPCs to authenticated (RLS/gate re-checks inside); public resolver to
-- service_role only (the /m route). Nothing is anon-executable.
revoke execute on function public.resolve_exact_live_comment(text, text, text) from anon, public;
revoke execute on function public.upsert_capture_share_link(uuid, text, text, text, text, text, timestamptz, text, text, timestamptz) from anon, public;
revoke execute on function public.find_capture_share_link_for_capture(uuid) from anon, public;
revoke execute on function public.claim_share_link_send(uuid) from anon, public;
revoke execute on function public.finalize_share_link_send(uuid, text, text) from anon, public;
revoke execute on function public.revoke_capture_share_link(uuid) from anon, public;
revoke execute on function public.resolve_capture_share_link(text) from anon, authenticated, public;
grant execute on function public.resolve_capture_share_link(text) to service_role;
