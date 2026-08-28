-- Inventory Total Grams summary cards (Owner 2026-08-28). Two GLOBAL, database-backed
-- totals shown at the top of the Inventory page (Super Admin + Admin only, gated by the
-- page): "Active Inventory Total Grams" and "Completed Items Total Grams".
--
-- WHY AN RPC (not a client sum): the totals must be a single database aggregate over ALL
-- rows (scales to 50k), never a browser row-loop, and never tied to the current
-- search/filter/page. This ONE function returns both totals + their item counts.
--
-- GRAMS SOURCE OF TRUTH: `inventory_items.grams_per_piece` is NULL for essentially every
-- item — the real per-piece grams is written INSIDE `item_code` (e.g. "ASB-E-3147 4.76g").
-- The Inventory table's Grams column therefore derives grams by parsing the code with
-- code-parser.ts `GRAMS_RE = /(\d*\.?\d+)\s*g\b/i` (first number followed by "g"). To keep
-- the cards equal to the sum of the visible Grams column ROW-FOR-ROW (Owner: "Literal —
-- include everything"), this function replicates that exact regex in SQL and uses the SAME
-- per-tab expression the UI uses:
--   * Active table  (inventory-workspace.tsx:643): gramsPerPiece ?? parsed  -> coalesce(gpp, parsed)
--   * Completed tbl (inventory-workspace.tsx:791): parsed grams only
--
-- CANONICAL SETS (byte-identical to the paginated readers, so the card counts match each
-- tab's total with NO discrepancy):
--   * Active    = inventory_active_ids_page  : not is_archived AND status in (available, returned_to_available)
--   * Completed = completed_inventory_page   : status in (5 consumed) AND no in-review RTS row
--
-- NOTE (data quality, non-destructive): ~10 malformed codes carry a stray "g" on the
-- sequence number or a space-for-dot typo, so a single piece parses as 200-2,544 g and
-- inflates the totals (Completed most). These are DATA issues in `item_code`, surfaced to
-- the Owner to correct at the source — fixing a code corrects the table AND this total
-- together. This function intentionally alters no rows.

create or replace function public.inventory_grams_totals()
returns table (
  active_grams numeric,
  active_items bigint,
  completed_grams numeric,
  completed_items bigint
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  -- Active-staff gate (same as inventory_monitor / completed_inventory_page). The
  -- Super-Admin/Admin-only DISPLAY restriction is enforced by the page; this guard only
  -- stops anon / non-staff. The totals expose nothing beyond the item rows a staff member
  -- can already read, so an active-staff gate is sufficient.
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;

  return query
  with parsed as (
    select
      i.id,
      i.availability_status,
      i.is_archived,
      i.grams_per_piece,
      -- Mirror code-parser.ts GRAMS_RE on the whitespace-collapsed code: the FIRST number
      -- (optional leading dot / zero) immediately followed by "g" at a word boundary.
      substring(regexp_replace(i.item_code, '\s+', ' ', 'g') from '(\d*\.?\d+)\s*[gG]\y')::numeric
        as parsed_grams
    from public.inventory_items i
  ),
  active_set as (
    select coalesce(p.grams_per_piece, p.parsed_grams) as g
    from parsed p
    where not p.is_archived
      and p.availability_status in ('available', 'returned_to_available')
  ),
  completed_set as (
    select p.parsed_grams as g
    from parsed p
    where p.availability_status in
          ('provisionally_reserved', 'committed', 'sold_released', 'completed', 'released')
      and not exists (
        select 1 from public.returned_to_stock_reviews r
        where r.inventory_item_id = p.id and r.status = 'in_review'
      )
  )
  select
    round(coalesce((select sum(g) from active_set), 0), 2)::numeric,
    (select count(*) from active_set)::bigint,
    round(coalesce((select sum(g) from completed_set), 0), 2)::numeric,
    (select count(*) from completed_set)::bigint;
end;
$function$;

-- Advisor-clean: no anon execute. Session (authenticated) callers only; the in-body guard
-- still requires active staff.
revoke all on function public.inventory_grams_totals() from public, anon;
grant execute on function public.inventory_grams_totals() to authenticated;
