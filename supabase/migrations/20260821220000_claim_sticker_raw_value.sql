-- Fixed Price on the CLAIM path (Owner 2026-08-21). The claim RPCs digit-extracted the value —
-- coalesce(grams, …, itemQuery, …) then substring '[0-9]+…' — so a fixed price "15k"/"15000"/
-- "15,000" came back in `grams` as "15"/"15000"/"15" and the PC/poller printed it as GRAMS.
-- Fix: return the RAW `value` token (so the printer classifies grams vs fixed), and restrict
-- `grams` to a REAL weight from ocr.grams/weight only (null for a fixed price). Eligibility
-- (a printable number exists in grams OR itemQuery) is unchanged — fixed prices now print too.
-- Additive: adds a `value` field; existing `grams` stays but is null for fixed prices.

create or replace function public.claim_next_capture_sticker(p_device text)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare v_rec public.capture_records; v_fb text; v_grams text; v_value text;
begin
  if not app_private.is_active_staff() then raise exception 'Not authorized.' using errcode = 'insufficient_privilege'; end if;
  select * into v_rec from public.capture_records r
  where r.source = 'floating' and coalesce(r.is_test, false) = false
    and r.sticker_printed_at is null and coalesce(r.print_status, '') <> 'printed'
    and (r.sticker_claimed_at is null or r.sticker_claimed_at < now() - interval '45 seconds')
    and length(trim(coalesce(r.ocr->>'fbName', r.ocr->>'fb_name', r.ocr->>'name', ''))) >= 2
    and nullif(substring(coalesce(r.ocr->>'grams', r.ocr->>'weight', r.ocr->>'itemQuery', r.ocr->>'item', '') from '[0-9]+(?:\.[0-9]+)?'), '') is not null
  order by r.captured_at asc for update skip locked limit 1;
  if not found then return jsonb_build_object('claimed', false); end if;
  update public.capture_records set sticker_claimed_by = nullif(trim(coalesce(p_device, '')), ''), sticker_claimed_at = now() where id = v_rec.id;
  v_fb := trim(coalesce(v_rec.ocr->>'fbName', v_rec.ocr->>'fb_name', v_rec.ocr->>'name', ''));
  -- grams = a REAL weight ONLY (ocr.grams/weight); NEVER digit-extracted from a fixed price.
  v_grams := substring(coalesce(v_rec.ocr->>'grams', v_rec.ocr->>'weight', '') from '[0-9]+(?:\.[0-9]+)?');
  -- value = the RAW claim token ("11.5" / "15k" / "15,000") for grams-vs-fixed classification.
  v_value := coalesce(nullif(trim(v_rec.ocr->>'grams'), ''), nullif(trim(v_rec.ocr->>'weight'), ''),
                      nullif(trim(v_rec.ocr->>'itemQuery'), ''), nullif(trim(v_rec.ocr->>'item'), ''));
  return jsonb_build_object('claimed', true, 'capture_record_id', v_rec.id, 'fb_name', v_fb, 'grams', v_grams, 'value', v_value);
end;
$function$;

create or replace function public.claim_capture_sticker_by_id(p_capture_record_id uuid, p_device text)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare v_rec public.capture_records; v_fb text; v_grams text; v_value text;
begin
  if not app_private.is_active_staff() then raise exception 'Not authorized.' using errcode = 'insufficient_privilege'; end if;
  select * into v_rec from public.capture_records r
  where r.id = p_capture_record_id and r.source = 'floating' and coalesce(r.is_test, false) = false
    and r.sticker_printed_at is null and coalesce(r.print_status, '') <> 'printed'
    and (r.sticker_claimed_at is null or r.sticker_claimed_at < now() - interval '45 seconds')
    and length(trim(coalesce(r.ocr->>'fbName', r.ocr->>'fb_name', r.ocr->>'name', ''))) >= 2
    and nullif(substring(coalesce(r.ocr->>'grams', r.ocr->>'weight', r.ocr->>'itemQuery', r.ocr->>'item', '') from '[0-9]+(?:\.[0-9]+)?'), '') is not null
  for update skip locked limit 1;
  if not found then return jsonb_build_object('claimed', false); end if;
  update public.capture_records set sticker_claimed_by = nullif(trim(coalesce(p_device, '')), ''), sticker_claimed_at = now() where id = v_rec.id;
  v_fb := trim(coalesce(v_rec.ocr->>'fbName', v_rec.ocr->>'fb_name', v_rec.ocr->>'name', ''));
  v_grams := substring(coalesce(v_rec.ocr->>'grams', v_rec.ocr->>'weight', '') from '[0-9]+(?:\.[0-9]+)?');
  v_value := coalesce(nullif(trim(v_rec.ocr->>'grams'), ''), nullif(trim(v_rec.ocr->>'weight'), ''),
                      nullif(trim(v_rec.ocr->>'itemQuery'), ''), nullif(trim(v_rec.ocr->>'item'), ''));
  return jsonb_build_object('claimed', true, 'capture_record_id', v_rec.id, 'fb_name', v_fb, 'grams', v_grams, 'value', v_value);
end;
$function$;
