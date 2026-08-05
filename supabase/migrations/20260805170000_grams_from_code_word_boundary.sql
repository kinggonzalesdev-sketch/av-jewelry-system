-- Align the database grams detector with the client parser (code-parser.ts uses
-- /(\d*\.?\d+)\s*g\b/i). The old pattern had no word boundary after "g", so a name
-- like "5gold" wrongly detected 5 grams. Add a word-boundary constraint (\y in
-- Postgres regex) after the g, keeping it case-insensitive ([gG]) and tolerant of a
-- space before g ("1.50 g"). Detection stays the number captured before g:
--   K18-RING-.5g-001 → 0.5   SB-NECKLACE-1.5g → 1.5   BRACELET 10.1g → 10.1
--   ITEM-25G-100 → 25        1.50 g → 1.50            5gold → (none)
create or replace function app_private.grams_from_code(p_code text)
returns numeric
language sql
immutable
as $function$
  select nullif(substring(coalesce(p_code, '') from '([0-9]*\.?[0-9]+)\s*[gG]\y'), '')::numeric;
$function$;
