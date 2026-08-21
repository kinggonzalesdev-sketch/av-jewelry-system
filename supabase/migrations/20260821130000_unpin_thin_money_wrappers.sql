-- #9 (low-value cleanup, Owner 2026-08-21): unpin the thin, fully-qualified delegation wrappers so
-- the planner CAN inline them. Body untouched (ALTER ... RESET search_path only); every reference is
-- fully schema-qualified, so nothing depended on search_path. NOTE: negligible runtime gain — these
-- wrap table-reading STABLE functions and are called in single-order/single-item paths, not per-row
-- in the set-based hot paths (order_balances/dashboard already inline their subqueries directly).
-- Done for consistency with the inlining sweep. Rollback: ALTER FUNCTION <sig> SET search_path TO ''.
alter function public.order_item_total(uuid) reset search_path;
alter function public.available_quantity_for(uuid) reset search_path;
alter function app_private.outstanding_balance(uuid) reset search_path;
alter function app_private.overpayment_credit(uuid) reset search_path;
alter function app_private.required_down_payment(uuid) reset search_path;
alter function app_private.is_paid_in_full(uuid) reset search_path;
