-- INVENTORY CODE UNIQUENESS = THE COMPLETE CODE, NOT THE NUMBER (Owner 2026-09-26).
--
-- Supersedes the numeric-identity rule of 20260915120000 (applied 2026-09-24). That rule refused a
-- new code whenever its sequence NUMBER already existed under any prefix, so the Owner could not
-- encode BNA-E-6158 2.48G because BNW-N-6158 2.55g 20" exists. The real A.V. Jewelry rule: the
-- number may repeat across prefixes, grams and sizes; only the same COMPLETE code is a duplicate.
--
-- 1. app_private.inventory_code_key(code) — the comparison form of a complete code: typographic
--    quotes/primes become ASCII quotes, a no-break space becomes a space, whitespace runs collapse
--    to one space, the ends are trimmed, and letters are upper-cased. Nothing else changes, so
--    18" vs 20", BNA vs BNW and 2.48g vs 2.55g stay different. MUST mirror inventoryCodeKey in
--    src/lib/inventory/code-number.ts.
-- 2. The numeric trigger inventory_items_unique_code_number is dropped. Its function stays in
--    place, unused, so a rollback is one CREATE TRIGGER.
-- 3. A new trigger refuses an exact normalized duplicate with a clear message naming the existing
--    item (raised as unique_violation, so every 23505 handler treats it as a duplicate).
-- 4. A UNIQUE index on the key is the concurrency guard: two sessions inserting the same complete
--    code at the same moment cannot both commit (the trigger alone cannot see the other session's
--    uncommitted row; the index can). One pre-existing pair already collides under the key — the
--    available "SBA-E-6012 2.27g  22K" (two spaces) and the committed "SBA-E-6012 2.27g 22K". It
--    is left untouched: the index excludes that one row by id, and the trigger still refuses any
--    NEW row with that code.
--
-- Unchanged: every inventory row, the unique lower(item_code) index inventory_items_code_idx, the
-- non-unique inventory_items_code_number_idx (numeric search ranking), inventory_code_number /
-- inventory_code_canonical, and both inventory search RPCs.

-- ---------------------------------------------------------------------------
-- 1. The complete-code key. chr() instead of escape sequences keeps the function body ASCII:
--    8220 8221 8222 8223 8243 = typographic double quotes and the double prime,
--    8216 8217 8218 8219 8242 = typographic single quotes and the prime, 160 = no-break space.
-- ---------------------------------------------------------------------------
create or replace function app_private.inventory_code_key(p_code text)
returns text
language sql
immutable
parallel safe
set search_path to ''
as $function$
  select upper(
    btrim(
      regexp_replace(
        translate(
          coalesce(p_code, ''),
          chr(8220) || chr(8221) || chr(8222) || chr(8223) || chr(8243)
            || chr(8216) || chr(8217) || chr(8218) || chr(8219) || chr(8242)
            || chr(160),
          repeat(chr(34), 5) || repeat(chr(39), 5) || chr(32)
        ),
        '\s+', ' ', 'g'
      )
    )
  )
$function$;

revoke all on function app_private.inventory_code_key(text) from public, anon;
-- The key is the EXPRESSION of inventory_items_code_key_uidx below. Postgres checks EXECUTE on an
-- index expression as the role WRITING the row; the apps write inventory_items as authenticated
-- (RLS) and as service_role, so both need it or every insert and re-code would fail.
grant execute on function app_private.inventory_code_key(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Retire the numeric rule.
-- ---------------------------------------------------------------------------
drop trigger if exists inventory_items_unique_code_number on public.inventory_items;

-- ---------------------------------------------------------------------------
-- 3. The friendly guard. BEFORE INSERT, and BEFORE UPDATE only when the complete code changes —
--    re-saving an item under its own code (including the grandfathered pair) is always allowed.
--    Archived items keep their code, exactly as the existing lower(item_code) index already does.
-- ---------------------------------------------------------------------------
create or replace function app_private.enforce_unique_inventory_code_key()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_key      text;
  v_existing text;
begin
  v_key := app_private.inventory_code_key(new.item_code);
  if tg_op = 'UPDATE' and app_private.inventory_code_key(old.item_code) = v_key then
    return new; -- the complete code did not change
  end if;

  -- The id predicate matches the unique index's, so this lookup uses that index.
  select i.item_code into v_existing
  from public.inventory_items i
  where app_private.inventory_code_key(i.item_code) = v_key
    and i.id <> 'e8202f4b-d86c-420b-acfc-1ab622ac4a23'::uuid
    and i.id is distinct from new.id
  limit 1;

  -- The one row outside the index (primary-key lookup).
  if v_existing is null then
    select i.item_code into v_existing
    from public.inventory_items i
    where i.id = 'e8202f4b-d86c-420b-acfc-1ab622ac4a23'::uuid
      and i.id is distinct from new.id
      and app_private.inventory_code_key(i.item_code) = v_key;
  end if;

  if v_existing is not null then
    raise exception 'This exact Inventory Code already exists: %. Please review the existing item or use a different complete code.',
      v_existing
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$function$;

revoke all on function app_private.enforce_unique_inventory_code_key() from public, anon;

drop trigger if exists inventory_items_unique_code_key on public.inventory_items;
create trigger inventory_items_unique_code_key
  before insert or update of item_code on public.inventory_items
  for each row execute function app_private.enforce_unique_inventory_code_key();

-- ---------------------------------------------------------------------------
-- 4. The concurrency guard.
-- ---------------------------------------------------------------------------
create unique index if not exists inventory_items_code_key_uidx
  on public.inventory_items ((app_private.inventory_code_key(item_code)))
  where id <> 'e8202f4b-d86c-420b-acfc-1ab622ac4a23'::uuid;
