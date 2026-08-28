-- Value-only Pancake canonical safety net — leading-decimal grams correction (Owner 2026-08-28).
--
-- Android OCR sometimes drops an explicit LEADING decimal ("mine .33" read as "33"). When a Capture
-- is matched to its EXACT Pancake Live comment (PSID-exact, single qualifying comment), and that
-- comment text carries the same digits as a leading decimal (".33"), the value is canonicalized to
-- "0.33". This is a DOWNSTREAM safety net only — Android OCR + the immediate local sticker are
-- untouched, and the RAW OCR value is PRESERVED (never overwritten). Additive + non-destructive; no
-- historical capture is rewritten. See src/lib/capture/canonical-value.ts for the digit-agreement rule.

-- 1) Additive canonical fields on capture_records (raw OCR truth stays in ocr.* — never overwritten).
alter table public.capture_records
  add column if not exists canonical_grams text,
  add column if not exists canonical_source text,
  add column if not exists canonical_comment_id text,
  add column if not exists canonicalized_at timestamptz;

-- 2) Companion read: the exact matched comment's text, by comment_id (the resolver already proved the
--    comment identity). Kept SEPARATE from resolve_exact_live_comment so that complex, critical
--    resolver is not touched. Active-staff / service-role only.
create or replace function public.resolve_capture_comment_text(p_comment_id text)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_text text;
begin
  if not (app_private.is_active_staff() or app_private.is_service_role()) then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_comment_id, '') = '' then
    return null;
  end if;
  select e.comment_text into v_text
  from public.pancake_webhook_events e
  where e.comment_id = p_comment_id
  order by e.received_at desc
  limit 1;
  return v_text;
end
$function$;

revoke all on function public.resolve_capture_comment_text(text) from public, anon;
grant execute on function public.resolve_capture_comment_text(text) to authenticated, service_role;

-- 3) Persist a canonical grams value — SET-ONCE (never overwrites an existing canonical value, and
--    never touches the raw ocr). Returns true when it wrote. Active-staff / service-role only.
create or replace function public.set_capture_canonical_grams(
  p_capture_id uuid,
  p_grams text,
  p_source text,
  p_comment_id text
) returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare v_updated int;
begin
  if not (app_private.is_active_staff() or app_private.is_service_role()) then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  if p_capture_id is null or coalesce(trim(p_grams), '') = '' then
    return false;
  end if;
  update public.capture_records
    set canonical_grams = trim(p_grams),
        canonical_source = coalesce(nullif(trim(p_source), ''), 'pancake_exact_comment'),
        canonical_comment_id = nullif(trim(p_comment_id), ''),
        canonicalized_at = now()
  where id = p_capture_id
    and canonical_grams is null;   -- set-once: raw OCR + first canonical are preserved
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end
$function$;

revoke all on function public.set_capture_canonical_grams(uuid, text, text, text) from public, anon;
grant execute on function public.set_capture_canonical_grams(uuid, text, text, text) to authenticated, service_role;
