-- #6 auto-link scale (Owner 2026-08-20): the webhook auto-link scans customers per Live comment
-- (webhook_store_pancake_live_comment: `where is_active and app_private.normalize_name(display_name)
-- = v_norm`), and webhook_upsert_conversation_identity runs the same equality. Both are O(customers)
-- per event today. This functional index turns that equality into an index lookup. normalize_name is
-- IMMUTABLE (required for an expression index) and now inlinable. Partial on is_active (every
-- customers-table equality caller filters it); NON-unique (duplicate normalized names are expected —
-- the callers gate on count()=1 for uniqueness, so a unique index would wrongly reject dup names).
--
-- VERIFIED on prod (enable_seqscan=off): the auto-link equality uses
-- `Bitmap Index Scan on idx_customers_active_normalized_name`; the Index Cond is the INLINED form
-- (btrim(regexp_replace(...))), i.e. Postgres inlines normalize_name identically in both the query
-- clause and the index expression, so inlining + the functional index compose (no trade-off).
--
-- CAVEAT (standard for functional indexes): if app_private.normalize_name's body is ever changed,
-- REINDEX this index (stored values are computed by the old body until rebuilt).
create index if not exists idx_customers_active_normalized_name
  on public.customers (app_private.normalize_name(display_name))
  where is_active;
