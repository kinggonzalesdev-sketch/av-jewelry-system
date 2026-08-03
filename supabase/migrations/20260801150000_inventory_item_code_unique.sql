-- Enforce a UNIQUE inventory code (case-insensitive) at the DATABASE level, so a
-- duplicate code can never be saved by ANY path (Inventory New Entry, bulk import,
-- or a race) — not only by the app-level check (which is RLS-scoped and could miss
-- archived rows). No existing case-insensitive duplicates exist, so this is safe.
drop index if exists public.inventory_items_code_idx;
create unique index inventory_items_code_idx
  on public.inventory_items (lower(item_code));
