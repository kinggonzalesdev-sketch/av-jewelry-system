-- Scale indexes (performance audit) — NON-DESTRUCTIVE, additive only.
--
-- Prepares the hot query paths for 20k–50k rows. Every statement is IF NOT EXISTS and
-- adds an index (or the pg_trgm extension); nothing is dropped, altered, or deleted, so
-- 0 rows change and all data/relationships are preserved. Tables are currently small,
-- so building these locks writes only for milliseconds.
--
-- Only columns verified to exist are indexed (customers has no normalized_name /
-- pancake_customer_id / facebook_sender_id column, so those are skipped).

-- Trigram matching for fast ILIKE '%…%' substring search (name / item name).
create extension if not exists pg_trgm;

-- customers: name search + reverse look-ups used by capture auto-link / resolve.
create index if not exists customers_display_name_trgm_idx
  on public.customers using gin (display_name gin_trgm_ops);
create index if not exists customers_pancake_conv_idx
  on public.customers (pancake_conversation_id) where pancake_conversation_id is not null;
create index if not exists customers_contact_idx
  on public.customers (contact_number) where contact_number is not null;

-- inventory_items: the available-item dropdown/list hot query + name search + date sort.
create index if not exists inventory_items_avail_code_idx
  on public.inventory_items (availability_status, item_code) where is_archived = false;
create index if not exists inventory_items_name_trgm_idx
  on public.inventory_items using gin (item_name gin_trgm_ops);
create index if not exists inventory_items_created_idx
  on public.inventory_items (created_at desc);

-- orders + layaway: recent-first sorting / status filters at scale.
create index if not exists official_orders_created_idx
  on public.official_orders (created_at desc);
create index if not exists layaway_ledger_status_idx
  on public.layaway_ledger (status);
create index if not exists layaway_ledger_created_idx
  on public.layaway_ledger (created_at desc);
