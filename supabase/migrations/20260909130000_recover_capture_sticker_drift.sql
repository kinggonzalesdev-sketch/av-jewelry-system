-- MIGRATION DRIFT RECOVERY — capture-sticker objects (Owner 2026-09-09).
--
-- The forensic audit found that the capture-sticker print state (the `sticker_*` columns on
-- capture_records) and the mark/release RPCs existed ONLY in the live database — no migration in
-- this repo created them. A fresh environment (or a rebuild from migrations) would therefore be
-- missing the objects the print path depends on.
--
-- This file records them VERBATIM as they exist in production (read back with pg_get_functiondef /
-- information_schema on 2026-09-09). It is DOCUMENTATION + REPRODUCIBILITY only:
--   * every statement is idempotent (`add column if not exists`, `create or replace`),
--   * the function bodies are byte-identical to the live ones, so applying it is a NO-OP on prod,
--   * nothing is dropped, renamed, or altered.
--
-- The claim RPCs (claim_next_capture_sticker / claim_capture_sticker_by_id) are NOT repeated here —
-- they are already versioned in 20260821220000_claim_sticker_raw_value.sql, and the auto-print
-- safety guards were added in 20260909120000_capture_autoprint_safety.sql.

-- ---------------------------------------------------------------------------
-- Print-state columns on capture_records
-- ---------------------------------------------------------------------------
alter table public.capture_records
  add column if not exists sticker_printed_at    timestamptz,
  add column if not exists sticker_claimed_by    text,
  add column if not exists sticker_claimed_at    timestamptz,
  -- Added by 20260909120000_capture_autoprint_safety (bounded auto retries); repeated here so the
  -- full print-state shape is visible in one place.
  add column if not exists sticker_print_attempts integer not null default 0;

-- ---------------------------------------------------------------------------
-- Terminal success: stamp the sticker as physically printed. Called by the phone/PC after a
-- successful Bluetooth write (POST /api/mobile/print/capture-result → markCaptureStickerPrintedAction).
-- Once sticker_printed_at is set, no claim RPC will ever serve the row again.
-- ---------------------------------------------------------------------------
create or replace function public.mark_capture_sticker_printed(p_capture_record_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  update public.capture_records set sticker_printed_at = now() where id = p_capture_record_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Hand a claim back after a failed print, so another device can take it. Deliberately does NOT
-- reset sticker_print_attempts — that is what keeps the automatic retry bounded — and refuses to
-- release a row that has already been printed.
-- ---------------------------------------------------------------------------
create or replace function public.release_capture_sticker(p_capture_record_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  update public.capture_records
     set sticker_claimed_by = null, sticker_claimed_at = null
   where id = p_capture_record_id and sticker_printed_at is null;
end;
$function$;
