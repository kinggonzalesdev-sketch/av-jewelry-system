-- #6 same-pattern sweep (Owner 2026-08-20): after fixing order_matches_card, swept every
-- LANGUAGE sql function with a `SET search_path` clause (the inlining-blocker) and unpinned the ones
-- that are PURE + IMMUTABLE + per-row in a hot list path. A SQL function with a SET clause is never
-- inlined, so each per-row call paid ~30us of function-call overhead. These bodies reference NO
-- tables/schema objects (only args, literals, CASE, built-in operators; layaway_matches_section
-- calls the fully-qualified public.layaway_is_overdue), so the search_path pin was unnecessary.
--
-- ALTER ... RESET search_path removes ONLY the per-function config — body, args, return type, and
-- grants are untouched — so behavior is provably identical; only inlinability changes.
--
-- Hot list callers: layaway_page (layaway_is_overdue + layaway_matches_section per row),
-- completed_inventory_page (completed_item_stage per row). layaway_fee / layaway_interest_per_gram /
-- order_items_locked are pure money/item helpers.
--
-- VERIFIED on prod: layaway classifier pass 75.3ms -> 4.5ms at 818 rows (~17x); counts byte-identical
-- (overdue:324, active:343, total:818); all six now report proconfig IS NULL (inlinable).
--
-- Rollback: ALTER FUNCTION <sig> SET search_path TO ''  for each.
alter function public.layaway_is_overdue(text, numeric, date, date) reset search_path;
alter function public.layaway_matches_section(text, numeric, numeric, numeric, date, text, date) reset search_path;
alter function public.completed_item_stage(text, text, text) reset search_path;
alter function app_private.layaway_fee(numeric, integer) reset search_path;
alter function app_private.layaway_interest_per_gram() reset search_path;
alter function app_private.order_items_locked(text) reset search_path;

-- NOTE (deliberately NOT changed): pure text helpers app_private.name_key / normalize_name (used in
-- security-adjacent name matching — review bodies first) and the thin STABLE money wrappers
-- (order_item_total, outstanding_balance, overpayment_credit, required_down_payment, is_paid_in_full,
-- available_quantity_for) which wrap table-reading functions and are no longer called per-row in the
-- set-based hot paths. Revisit per-caller if a future profile shows them hot.
