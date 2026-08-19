-- Hot-path foreign-key indexes (2026-08-19).
--
-- The Supabase performance advisor flags ~60 unindexed foreign keys, but almost all are
-- audit "who-did-it" columns (created_by / recorded_by / verified_by / *_by → staff_profiles)
-- and one-off provenance columns (migration_batch_id) on SMALL tables. Those columns are never
-- used as a query predicate, so indexing them is pure write + storage churn with no read
-- benefit — deliberately NOT added here.
--
-- This adds indexes ONLY for the FK columns that are actually used as JOIN / lookup keys in the
-- capture, payment, and layaway read paths — the ones that also grow during live selling.
-- Every target table is tiny (<= ~3.2k rows), so a plain CREATE INDEX builds in sub-milliseconds
-- (no ACCESS EXCLUSIVE concern); all are additive + reversible (DROP INDEX).

-- Capture pipeline: captures are linked to their order / customer / item, and the linkage is
-- read on every capture render + Send-Invoice. This table grows fastest during a live.
create index if not exists idx_capture_records_official_order_id
  on public.capture_records (official_order_id);
create index if not exists idx_capture_records_customer_id
  on public.capture_records (customer_id);
create index if not exists idx_capture_records_inventory_item_id
  on public.capture_records (inventory_item_id);

-- Payment reassignment: history is looked up by the source order it was moved from.
create index if not exists idx_payments_reassigned_from_order_id
  on public.payments (reassigned_from_order_id);

-- Layaway ledger items join back to their inventory item.
create index if not exists idx_layaway_ledger_items_inventory_item_id
  on public.layaway_ledger_items (inventory_item_id);
