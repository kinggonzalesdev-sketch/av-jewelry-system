-- Review Mode (live-readiness): a review-before-create queue. In Review Mode the
-- mobile app ENQUEUES a capture instead of creating an order; a reviewer then
-- approves (which creates the order via the existing create_capture_order) or rejects
-- it. Additive — the Automatic Mode path (direct create) is unchanged. Kept in its own
-- table so capture_records/orders stay clean (only real, approved captures land there).

create table if not exists public.capture_review_queue (
  id uuid primary key default gen_random_uuid(),
  device_installation_id text not null,
  capture_id text not null,
  customer_name text not null,
  inventory_item_id uuid references public.inventory_items(id),
  price numeric(14,2) not null,
  grams numeric,
  screenshot_path text,
  ocr jsonb,
  pancake_conversation_id text,
  pancake_customer_id text,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'rejected')),
  official_order_id uuid references public.official_orders(id),
  reject_reason text,
  created_by uuid references public.staff_profiles(id),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.staff_profiles(id),
  reviewed_at timestamptz,
  is_test boolean not null default false,
  live_session_id uuid references public.live_sessions(id),
  unique (device_installation_id, capture_id)
);

create index if not exists capture_review_queue_pending_idx
  on public.capture_review_queue (created_at) where status = 'pending_review';

alter table public.capture_review_queue enable row level security;

-- Active staff may READ the queue (RLS). All WRITES go only through the DEFINER
-- functions below (which bypass RLS), so there are no INSERT/UPDATE policies.
drop policy if exists capture_review_read on public.capture_review_queue;
create policy capture_review_read on public.capture_review_queue
  for select to authenticated using (app_private.is_active_staff());

-- Enqueue a capture for review (mobile, Review Mode). Idempotent on device+capture.
create or replace function public.enqueue_capture_review(
  p_device text, p_capture_id text, p_customer_name text, p_inventory_item_id uuid,
  p_price numeric, p_grams numeric default null, p_screenshot_path text default null,
  p_ocr jsonb default null, p_pancake_conversation_id text default null,
  p_pancake_customer_id text default null
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_id uuid; v_status text;
begin
  if not app_private.has_permission('claim_capture') then
    raise exception 'Not authorized to capture.' using errcode = 'insufficient_privilege';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'A unit price greater than zero is required.' using errcode = 'check_violation';
  end if;
  if coalesce(trim(p_customer_name), '') = '' then
    raise exception 'A customer name is required.' using errcode = 'check_violation';
  end if;
  select id, status into v_id, v_status from public.capture_review_queue
    where device_installation_id = p_device and capture_id = p_capture_id;
  if v_id is not null then
    return jsonb_build_object('review_id', v_id, 'status', v_status, 'idempotent', true);
  end if;
  insert into public.capture_review_queue (
    device_installation_id, capture_id, customer_name, inventory_item_id, price, grams,
    screenshot_path, ocr, pancake_conversation_id, pancake_customer_id,
    created_by, is_test, live_session_id
  ) values (
    p_device, p_capture_id, trim(p_customer_name), p_inventory_item_id, round(p_price, 2), p_grams,
    p_screenshot_path, p_ocr, p_pancake_conversation_id, p_pancake_customer_id,
    app_private.current_staff_id(), app_private.is_test_mode(), app_private.current_live_session()
  ) returning id into v_id;
  return jsonb_build_object('review_id', v_id, 'status', 'pending_review', 'idempotent', false);
end;
$$;

-- Approve a pending review -> create the order via create_capture_order, mark approved.
create or replace function public.approve_capture_review(p_review_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r public.capture_review_queue; v_order jsonb;
begin
  if not app_private.has_permission('claim_capture') then
    raise exception 'Not authorized to review captures.' using errcode = 'insufficient_privilege';
  end if;
  select * into r from public.capture_review_queue where id = p_review_id for update;
  if not found then
    raise exception 'That capture review could not be found.' using errcode = 'no_data_found';
  end if;
  if r.status <> 'pending_review' then
    return jsonb_build_object('review_id', r.id, 'status', r.status,
      'official_order_id', r.official_order_id);
  end if;
  v_order := public.create_capture_order(
    r.device_installation_id, r.capture_id, r.customer_name, r.inventory_item_id, r.price,
    r.grams, r.screenshot_path, r.ocr, r.pancake_conversation_id, r.pancake_customer_id
  );
  update public.capture_review_queue set
    status = 'approved',
    official_order_id = (v_order->>'official_order_id')::uuid,
    reviewed_by = app_private.current_staff_id(),
    reviewed_at = now()
  where id = r.id;
  return jsonb_build_object('review_id', r.id, 'status', 'approved', 'order', v_order);
end;
$$;

-- Reject a pending review (no order is created).
create or replace function public.reject_capture_review(p_review_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_status text;
begin
  if not app_private.has_permission('claim_capture') then
    raise exception 'Not authorized to review captures.' using errcode = 'insufficient_privilege';
  end if;
  update public.capture_review_queue set
    status = 'rejected',
    reject_reason = nullif(trim(coalesce(p_reason, '')), ''),
    reviewed_by = app_private.current_staff_id(),
    reviewed_at = now()
  where id = p_review_id and status = 'pending_review'
  returning status into v_status;
  if v_status is null then
    raise exception 'That capture review is not pending.' using errcode = 'no_data_found';
  end if;
  return jsonb_build_object('review_id', p_review_id, 'status', 'rejected');
end;
$$;

revoke all on function public.enqueue_capture_review(text, text, text, uuid, numeric, numeric, text, jsonb, text, text) from public;
revoke all on function public.approve_capture_review(uuid) from public;
revoke all on function public.reject_capture_review(uuid, text) from public;
grant execute on function public.enqueue_capture_review(text, text, text, uuid, numeric, numeric, text, jsonb, text, text) to authenticated;
grant execute on function public.approve_capture_review(uuid) to authenticated;
grant execute on function public.reject_capture_review(uuid, text) to authenticated;

alter publication supabase_realtime add table public.capture_review_queue;
