-- VERSION-CONTROL BACKFILL (2026-08-13, audit follow-up). The Pancake webhook table and
-- its RPCs were applied to production directly via Supabase MCP `apply_migration` and were
-- therefore NEVER committed to this repo — a disaster-recovery / reproducibility gap flagged
-- by the auto-send gap audit. This file captures their EXACT current live definitions so the
-- objects are reproducible from source. It is idempotent (`if not exists` / `create or
-- replace`); it was NOT re-applied to production (the live objects already exist and are
-- authoritative). If you ever rebuild the DB from migrations, this recreates them.

-- ── Table: pancake_webhook_events ───────────────────────────────────────────────
create table if not exists public.pancake_webhook_events (
  id uuid primary key default gen_random_uuid(),
  page_id text,
  comment_id text,
  conversation_id text,
  livestream_post_id text,
  post_type text,
  comment_text text,
  event_timestamp timestamptz,
  facebook_psid text,
  pancake_page_customer_id text,
  facebook_name text,
  raw jsonb,
  received_at timestamptz not null default now(),
  constraint pancake_webhook_events_page_comment_uniq unique (page_id, comment_id)
);

create index if not exists pancake_webhook_events_received_at_idx
  on public.pancake_webhook_events using btree (received_at desc);

alter table public.pancake_webhook_events enable row level security;
drop policy if exists pancake_webhook_events_owner_read on public.pancake_webhook_events;
create policy pancake_webhook_events_owner_read on public.pancake_webhook_events
  for select using (app_private.is_owner());

-- ── RPC: webhook_store_pancake_live_comment (idempotent insert + real-time auto-link) ──
CREATE OR REPLACE FUNCTION public.webhook_store_pancake_live_comment(p_page_id text, p_comment_id text, p_conversation_id text, p_livestream_post_id text, p_post_type text, p_comment_text text, p_event_timestamp text, p_facebook_psid text, p_pancake_page_customer_id text, p_facebook_name text, p_raw jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_stored boolean;
  v_ts timestamptz;
  v_norm text;
  v_conv text;
  v_count int;
  v_customer uuid;
begin
  begin
    v_ts := nullif(p_event_timestamp, '')::timestamptz;
  exception when others then
    v_ts := null;
  end;

  insert into public.pancake_webhook_events (
    page_id, comment_id, conversation_id, livestream_post_id, post_type,
    comment_text, event_timestamp, facebook_psid, pancake_page_customer_id,
    facebook_name, raw
  ) values (
    p_page_id, p_comment_id, p_conversation_id, p_livestream_post_id, p_post_type,
    p_comment_text, v_ts, p_facebook_psid, p_pancake_page_customer_id,
    p_facebook_name, p_raw
  )
  on conflict (page_id, comment_id) do nothing;

  v_stored := found;

  -- REAL-TIME AUTO-LINK (non-destructive): on a NEW event with a usable identity, if the
  -- Facebook name uniquely matches ONE active customer not already linked on this page,
  -- fill their messageable {page_id}_{psid}. Exact normalized name + unique-gated. The
  -- whole auto-link is wrapped so a failure here can NEVER roll back the stored event.
  if v_stored
     and coalesce(p_facebook_psid, '') <> ''
     and coalesce(p_facebook_name, '') <> '' then
    begin
      v_norm := app_private.normalize_name(p_facebook_name);
      if length(v_norm) >= 2 then
        v_conv := p_page_id || '_' || p_facebook_psid;
        select count(*), (array_agg(id))[1] into v_count, v_customer
        from public.customers
        where is_active = true
          and app_private.normalize_name(display_name) = v_norm;
        if v_count = 1 then
          update public.customers
             set pancake_conversation_id = v_conv
           where id = v_customer
             and (pancake_conversation_id is null
                  or pancake_conversation_id = ''
                  or not starts_with(pancake_conversation_id, p_page_id || '_'));
        end if;
      end if;
    exception when others then
      null; -- auto-link is best-effort; the event stays stored regardless
    end;
  end if;

  return v_stored;
end;
$function$;

-- ── RPC: webhook_resolve_conversation_by_name (14-day, unique-gated name → conversation) ──
CREATE OR REPLACE FUNCTION public.webhook_resolve_conversation_by_name(p_name text, p_active_page text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_norm text; v_key text; v_conv text; v_count int;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  v_norm := app_private.normalize_name(coalesce(p_name, ''));
  if length(v_norm) < 2 then
    return jsonb_build_object('conversationId', null, 'matchCount', 0);
  end if;

  -- EXACT normalized-name → a single distinct messageable conversation wins.
  with recent as (
    select distinct (e.page_id || '_' || e.facebook_psid) as conv, e.facebook_name
    from public.pancake_webhook_events e
    where e.facebook_psid is not null and e.page_id is not null
      and (coalesce(p_active_page, '') = '' or e.page_id = p_active_page)
      and e.received_at > now() - interval '14 days'
  )
  select count(distinct conv), max(conv) into v_count, v_conv
  from recent where app_private.normalize_name(facebook_name) = v_norm;
  if v_count = 1 then return jsonb_build_object('conversationId', v_conv, 'matchCount', 1); end if;
  if v_count > 1 then return jsonb_build_object('conversationId', null, 'matchCount', v_count); end if;

  -- FIRST+LAST fallback (middle-name tolerant), still unique-gated.
  v_key := app_private.name_key(coalesce(p_name, ''));
  if v_key <> '' then
    with recent as (
      select distinct (e.page_id || '_' || e.facebook_psid) as conv, e.facebook_name
      from public.pancake_webhook_events e
      where e.facebook_psid is not null and e.page_id is not null
        and (coalesce(p_active_page, '') = '' or e.page_id = p_active_page)
        and e.received_at > now() - interval '14 days'
    )
    select count(distinct conv), max(conv) into v_count, v_conv
    from recent where app_private.name_key(facebook_name) = v_key;
    if v_count = 1 then return jsonb_build_object('conversationId', v_conv, 'matchCount', 1); end if;
    if v_count > 1 then return jsonb_build_object('conversationId', null, 'matchCount', v_count); end if;
  end if;

  return jsonb_build_object('conversationId', null, 'matchCount', 0);
end $function$;

-- ── RPC: webhook_upsert_conversation_identity (name→customer link + avatar fill) ──
CREATE OR REPLACE FUNCTION public.webhook_upsert_conversation_identity(p_conversation_id text, p_name text, p_avatar text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_conv text := nullif(trim(coalesce(p_conversation_id, '')), '');
  v_norm text;
  v_cust uuid;
  v_candidates int;
  v_linked int := 0;
  v_avatar int := 0;
begin
  if v_conv is null then
    return jsonb_build_object('ok', false, 'reason', 'no_conversation');
  end if;

  if nullif(trim(coalesce(p_name, '')), '') is not null then
    v_norm := app_private.normalize_name(p_name);
    if v_norm <> '' then
      select count(*), (array_agg(id))[1] into v_candidates, v_cust
      from public.customers
      where is_active
        and app_private.normalize_name(display_name) = v_norm
        and nullif(trim(coalesce(pancake_conversation_id, '')), '') is null;
      if v_candidates = 1 and v_cust is not null then
        update public.customers set pancake_conversation_id = v_conv where id = v_cust;
        v_linked := 1;
      end if;
    end if;
  end if;

  if nullif(trim(coalesce(p_avatar, '')), '') is not null then
    update public.customers
       set avatar_url = trim(p_avatar)
     where is_active
       and pancake_conversation_id = v_conv
       and coalesce(avatar_url, '') is distinct from trim(p_avatar);
    get diagnostics v_avatar = row_count;
  end if;

  return jsonb_build_object('ok', true, 'linked', v_linked, 'avatar_updated', v_avatar);
end;
$function$;

-- ── RPC: set_capture_customer_link (persist a resolved link onto a floating capture) ──
CREATE OR REPLACE FUNCTION public.set_capture_customer_link(p_capture_record_id uuid, p_customer_id uuid, p_conversation_id text, p_pancake_customer_id text, p_link_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized: an active MineFlow staff session is required.';
  end if;
  if p_link_status is not null and p_link_status not in
      ('linked','needs_confirmation','customer_no_chat','no_match') then
    raise exception 'Invalid capture link status: %', p_link_status;
  end if;
  update public.capture_records
     set customer_id = p_customer_id,
         pancake_conversation_id = p_conversation_id,
         -- explicit id if given, else derive the psid from {page_id}_{psid}
         pancake_customer_id = coalesce(
           nullif(trim(coalesce(p_pancake_customer_id, '')), ''),
           nullif(split_part(coalesce(p_conversation_id, ''), '_', 2), '')
         ),
         link_status = p_link_status
   where id = p_capture_record_id
     and source = 'floating'
     and official_order_id is null;
end;
$function$;

-- Grants (SECURITY DEFINER functions guard authority internally). Match live usage:
-- staff-facing resolvers/persisters are callable by authenticated; the webhook store/upsert
-- run under the service-role webhook path.
revoke all on function public.webhook_store_pancake_live_comment(text,text,text,text,text,text,text,text,text,text,jsonb) from public;
revoke all on function public.webhook_upsert_conversation_identity(text,text,text) from public;
revoke all on function public.webhook_resolve_conversation_by_name(text,text) from public;
revoke all on function public.set_capture_customer_link(uuid,uuid,text,text,text) from public;
grant execute on function public.webhook_store_pancake_live_comment(text,text,text,text,text,text,text,text,text,text,jsonb) to service_role, authenticated;
grant execute on function public.webhook_upsert_conversation_identity(text,text,text) to service_role, authenticated;
grant execute on function public.webhook_resolve_conversation_by_name(text,text) to authenticated, service_role;
grant execute on function public.set_capture_customer_link(uuid,uuid,text,text,text) to authenticated, service_role;
