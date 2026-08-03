-- MineFlow Capture (Android app) backend. A capture is a live-selling screenshot
-- turned into an order. capture_records is the idempotency + audit spine: one row
-- per (device, capture) so a retried tap never creates a second order.
create table if not exists public.capture_records (
  id uuid primary key default gen_random_uuid(),
  device_installation_id text not null,
  capture_id text not null,
  idempotency_key text generated always as
    ('capture:' || device_installation_id || ':' || capture_id) stored,
  official_order_id uuid references public.official_orders(id) on delete set null,
  inventory_item_id uuid references public.inventory_items(id),
  customer_id uuid references public.customers(id),
  captured_by uuid references public.staff_profiles(id),
  captured_at timestamptz not null default now(),
  screenshot_path text,
  ocr jsonb,
  confirmed jsonb,
  pancake_conversation_id text,
  pancake_customer_id text,
  pancake_message_id text,
  message_status text not null default 'pending',
  print_status text not null default 'pending',
  source text not null default 'MineFlow Capture App',
  created_at timestamptz not null default now(),
  constraint capture_records_idem_uk unique (idempotency_key)
);

alter table public.capture_records enable row level security;
drop policy if exists capture_records_read on public.capture_records;
create policy capture_records_read on public.capture_records for select
  using (app_private.has_permission('claim_capture'));

-- Idempotent capture-order creation lives on the database. See the applied
-- migration for the full create_capture_order(...) body: it reserves the inventory
-- item like the Walk-In path, creates a single-item For Invoice order, records the
-- capture audit row, and returns the SAME order for a repeated (device, capture).
