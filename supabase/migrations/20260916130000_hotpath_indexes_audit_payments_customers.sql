-- ============================================================================
-- Hot-path indexes (system audit 2026-09-16). NOT APPLIED TO PRODUCTION yet.
--
-- Each index matches a query pattern that exists in code TODAY; nothing speculative.
-- Plain CREATE INDEX (not CONCURRENTLY) because migrations run inside a transaction; the
-- tables are small enough (thousands of rows) that the brief lock is negligible.
-- Rollback: drop index if exists <name>;
-- ============================================================================

-- Recent-activity feed + Excel audit export sort the whole append-only table by time
-- (src/lib/dashboard/service.ts listAuditEvents, src/lib/export/data-export.ts audit sheet).
create index if not exists audit_events_occurred_at_idx
  on public.audit_events (occurred_at desc);

-- Every date-bounded payments list / sales summary keys on recorded_at
-- (src/lib/payments/workspace.ts, report_sales_summary).
create index if not exists payments_recorded_at_idx
  on public.payments (recorded_at desc);

-- Dashboard "awaiting verification" counts (dashboard_counts, dashboard_metrics_ranged,
-- src/lib/followups/service.ts).
create index if not exists payments_unverified_idx
  on public.payments (recorded_at desc)
  where status = 'submitted_unverified';

-- Customers list: ORDER BY display_name with a contains-search on the contact number
-- (src/lib/customers/service.ts, src/lib/customers/matching.ts).
create index if not exists customers_display_name_idx
  on public.customers (display_name);
-- The trigram operator class lives wherever pg_trgm is installed (it was moved from public to
-- extensions in 20260821180000). Resolve its schema at apply time so this cannot abort the whole
-- migration on either layout.
do $$
declare
  v_schema text;
begin
  select n.nspname into v_schema
  from pg_catalog.pg_opclass c
  join pg_catalog.pg_namespace n on n.oid = c.opcnamespace
  join pg_catalog.pg_am am on am.oid = c.opcmethod
  where c.opcname = 'gin_trgm_ops' and am.amname = 'gin'
  limit 1;
  if v_schema is null then
    raise notice 'pg_trgm is not installed; customers_contact_trgm_idx was skipped.';
  else
    execute format(
      'create index if not exists customers_contact_trgm_idx on public.customers using gin (contact_number %I.gin_trgm_ops)',
      v_schema
    );
  end if;
end $$;

-- Incoming Captures poll / auto-router / sticker claim: floating captures not yet on an order
-- (src/lib/capture/pending.ts, auto-router.ts, claim_next_capture_sticker).
create index if not exists capture_records_floating_open_idx
  on public.capture_records (captured_at desc)
  where source = 'floating' and official_order_id is null;

-- Completed Items + layaway readers join the ledger by item (completed_inventory_page,
-- completed_items_money, layaway_page).
-- layaway_ledger exists only in the live DB (no migration creates it), so guard on the column.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'layaway_ledger' and column_name = 'inventory_item_id'
  ) then
    execute 'create index if not exists layaway_ledger_inventory_item_idx on public.layaway_ledger (inventory_item_id) where inventory_item_id is not null';
  else
    raise notice 'public.layaway_ledger.inventory_item_id not found; layaway_ledger_inventory_item_idx was skipped.';
  end if;
end $$;
