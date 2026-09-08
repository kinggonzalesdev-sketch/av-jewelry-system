-- Capture auto-print SAFETY (Owner 2026-09-09) — stop old capture stickers auto-printing when a
-- Bluetooth printer reconnects. Forensic root cause: claim_next_capture_sticker had NO age bound,
-- did NOT exclude captures already turned into orders, and had NO attempt bound, so any un-printed
-- floating capture stayed auto-claimable FOREVER and drained on reconnect.
--
-- ✅ APPLIED TO PRODUCTION 2026-09-09 (Supabase migration `capture_autoprint_safety`).
-- Drift gate was satisfied FIRST: pg_get_functiondef on the live claim_next_capture_sticker matched
-- the repo baseline 20260821220000_claim_sticker_raw_value (45s expiry ✓, is_active_staff ✓,
-- SKIP LOCKED ✓) and contained NONE of the three new guards, so nothing production-only was
-- overwritten. Post-apply verification confirmed all three guards present and the atomic claim +
-- auth guard preserved. This file recovers that claim body verbatim and only ADDS the guards.
--
-- SCOPE: only the AUTO drain path (claim_next_capture_sticker). The explicit by-id path
-- (claim_capture_sticker_by_id) is intentionally LEFT UNCHANGED so a staff member can still
-- manually reprint a specific older capture (FIX 8). mark_/release_ RPCs are untouched.
-- Additive + idempotent. Drops nothing.

-- FIX 5: bounded automatic retries — a per-record attempt counter (additive, safe default).
alter table public.capture_records
  add column if not exists sticker_print_attempts integer not null default 0;

create or replace function public.claim_next_capture_sticker(p_device text)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare v_rec public.capture_records; v_fb text; v_grams text; v_value text;
begin
  if not app_private.is_active_staff() then raise exception 'Not authorized.' using errcode = 'insufficient_privilege'; end if;
  select * into v_rec from public.capture_records r
  where r.source = 'floating' and coalesce(r.is_test, false) = false
    and r.sticker_printed_at is null and coalesce(r.print_status, '') <> 'printed'
    -- FIX 3: a capture that already became an Order must NEVER auto-print again as a stale sticker.
    and r.official_order_id is null
    -- FIX 2 / FIX 7: AUTO_PRINT_WINDOW = 60 seconds — the single source of truth for auto-print
    -- eligibility. Only near-real-time (Live) captures auto-print; anything older is NOT
    -- auto-claimed, so a printer/app reconnect can no longer drain an old backlog. The row is
    -- preserved (never deleted) and stays available to the explicit by-id reprint path.
    and r.captured_at >= now() - interval '60 seconds'
    -- FIX 5: bounded auto retries (attempt 1 + at most one 45s re-serve; then stop, leave for manual).
    and coalesce(r.sticker_print_attempts, 0) < 2
    and (r.sticker_claimed_at is null or r.sticker_claimed_at < now() - interval '45 seconds')
    and length(trim(coalesce(r.ocr->>'fbName', r.ocr->>'fb_name', r.ocr->>'name', ''))) >= 2
    and nullif(substring(coalesce(r.ocr->>'grams', r.ocr->>'weight', r.ocr->>'itemQuery', r.ocr->>'item', '') from '[0-9]+(?:\.[0-9]+)?'), '') is not null
  -- FIX 6: atomic single-device claim (unchanged) — FOR UPDATE SKIP LOCKED hands each row to ONE
  -- device only, so two online devices can never both print the same capture.
  order by r.captured_at asc for update skip locked limit 1;
  if not found then return jsonb_build_object('claimed', false); end if;
  update public.capture_records
     set sticker_claimed_by = nullif(trim(coalesce(p_device, '')), ''),
         sticker_claimed_at = now(),
         sticker_print_attempts = coalesce(sticker_print_attempts, 0) + 1
   where id = v_rec.id;
  v_fb := trim(coalesce(v_rec.ocr->>'fbName', v_rec.ocr->>'fb_name', v_rec.ocr->>'name', ''));
  -- grams = a REAL weight ONLY (ocr.grams/weight); NEVER digit-extracted from a fixed price.
  v_grams := substring(coalesce(v_rec.ocr->>'grams', v_rec.ocr->>'weight', '') from '[0-9]+(?:\.[0-9]+)?');
  -- value = the RAW claim token ("11.5" / "15k" / "15,000") for grams-vs-fixed classification.
  v_value := coalesce(nullif(trim(v_rec.ocr->>'grams'), ''), nullif(trim(v_rec.ocr->>'weight'), ''),
                      nullif(trim(v_rec.ocr->>'itemQuery'), ''), nullif(trim(v_rec.ocr->>'item'), ''));
  return jsonb_build_object('claimed', true, 'capture_record_id', v_rec.id, 'fb_name', v_fb, 'grams', v_grams, 'value', v_value);
end;
$function$;
