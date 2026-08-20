-- TEMPORARY pin-signal raw-capture net (Owner request 2026-08-20). INSTRUMENTATION ONLY.
-- During a MANUALLY-enabled window it persists the FULL parsed body of EVERY inbound Pancake
-- webhook event (comment, non-comment, and repeated/updated same-(page_id, comment_id) events)
-- so a controlled Facebook Live pin/unpin test can be diffed. ADDITIVE — the production pipeline
-- (parse/store/respond) is unchanged. Meant to be DROPPED after analysis (see cleanup note).
-- Stores ONLY the event body; transport secret/headers/cookies are never read or stored here.

create table if not exists public.pancake_webhook_raw_diag (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  page_id text,
  event_type text,
  comment_id text,
  post_id text,
  raw jsonb,
  diagnostic_test_tag text
);

comment on table public.pancake_webhook_raw_diag is
  'TEMPORARY pin-signal diagnostic (2026-08-20). Full inbound Pancake webhook body during an enabled window; DROP after analysis. No credentials stored.';

create index if not exists idx_pancake_webhook_raw_diag_received_at
  on public.pancake_webhook_raw_diag (received_at desc);
create index if not exists idx_pancake_webhook_raw_diag_tag
  on public.pancake_webhook_raw_diag (diagnostic_test_tag);
create index if not exists idx_pancake_webhook_raw_diag_comment
  on public.pancake_webhook_raw_diag (comment_id);

-- Locked down: RLS ON with NO policies → no anon/authenticated access. Only the SECURITY DEFINER
-- writer below (called by the service-role webhook) and direct service-role SQL can touch it.
alter table public.pancake_webhook_raw_diag enable row level security;

-- Append-only insert — NEVER "on conflict do nothing": every webhook occurrence is retained,
-- including duplicates/updates for an already-known comment_id (that is the whole point).
create or replace function public.webhook_capture_raw_diag(
  p_page_id text,
  p_event_type text,
  p_comment_id text,
  p_post_id text,
  p_raw jsonb,
  p_tag text
) returns uuid
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_id uuid;
begin
  insert into public.pancake_webhook_raw_diag
    (page_id, event_type, comment_id, post_id, raw, diagnostic_test_tag)
  values
    (p_page_id, p_event_type, p_comment_id, p_post_id, p_raw, p_tag)
  returning id into v_id;
  return v_id;
end;
$function$;

revoke all on function public.webhook_capture_raw_diag(text, text, text, text, jsonb, text) from public;
grant execute on function public.webhook_capture_raw_diag(text, text, text, text, jsonb, text) to service_role;

-- ── CLEANUP (run after the controlled test is analyzed) ──────────────────────────────────────
--   drop function if exists public.webhook_capture_raw_diag(text, text, text, text, jsonb, text);
--   drop table if exists public.pancake_webhook_raw_diag;
-- …and unset PANCAKE_WEBHOOK_DIAG_CAPTURE in Vercel + redeploy.
