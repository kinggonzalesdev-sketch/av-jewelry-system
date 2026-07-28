-- Additive columns (Owner request 2026-07-22). Nothing dropped.
--   customers.address        — shown in the Customers table (empty until entered).
--   inventory_items.supplier_name, size — captured by the Inventory New Entry form.
alter table public.customers add column if not exists address text;
alter table public.inventory_items add column if not exists supplier_name text;
alter table public.inventory_items add column if not exists size text;
