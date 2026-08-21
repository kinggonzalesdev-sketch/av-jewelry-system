-- #8 (Owner 2026-08-21): unpin the inner money helpers so they can inline. All SECURITY INVOKER,
-- STABLE, with fully-qualified bodies (public.* / app_private.*) — RESET search_path changes nothing
-- about resolution or output, only inlinability. Low value (single-order paths; the set-based hot
-- paths order_balances/dashboard already inline these subqueries directly), done to complete the
-- inlining pass. Rollback: ALTER FUNCTION <sig> SET search_path TO ''.
alter function app_private.total_amount_payable(uuid) reset search_path;
alter function app_private.verified_net_payments(uuid) reset search_path;
alter function app_private.layaway_amount_payable(uuid) reset search_path;
alter function app_private.approved_charge_total(uuid, boolean) reset search_path;
alter function app_private.order_item_total(uuid) reset search_path;
