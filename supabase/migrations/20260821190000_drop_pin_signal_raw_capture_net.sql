-- Teardown of the temporary pin-signal raw-capture net. Controlled Live pin test concluded
-- 2026-08-21: PIN SIGNAL NOT EXPOSED IN OBSERVED PANCAKE WEBHOOKS — pinning/unpinning a Facebook
-- Page Live comment produced no webhook event, no field (is_pinned/pinned_comment_id/rank/status),
-- and no re-sent comment, in either the append-only diagnostic net or production. The pinned-comment
-- Capture therefore stays on local pinned-area OCR (Priority 2) + Needs Review (Priority 3); there is
-- no server/realtime pin route to build. The diagnostic has served its purpose — drop it.
--
-- (Created by 20260820140000_pancake_webhook_raw_diag_temp.sql; the flag PANCAKE_WEBHOOK_DIAG_CAPTURE
--  and tag env var are removed from Vercel, and the captureWebhookRawDiag instrumentation is deleted
--  from src/lib/integrations/pancake-webhook.ts + the webhook route.)
drop function if exists public.webhook_capture_raw_diag(text, text, text, text, jsonb, text);
drop table if exists public.pancake_webhook_raw_diag;
