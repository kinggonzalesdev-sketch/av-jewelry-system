-- Typed web→native print-job queue (Owner 2026-09-07, SAFE STAGED CUTOVER).
--
-- The native MineFlow Capture app becomes the printer authority for New Order stickers via
-- an explicit job type. This queue is PARALLEL to — and never touches — the capture-sticker
-- queue (capture_records; job type CAPTURE_STICKER, unchanged) or the claim label_jobs queue.
--
-- Staged: the web STILL keeps its browser print fallback. The native path is added alongside
-- it and is not the sole path until physical owner testing passes.
--
-- The `sticker` payload carries the AUTHORITATIVE, pre-rendered sticker lines computed from the
-- order snapshot on the web (stickerLineItems) — so Android reproduces the EXISTING approved
-- Order sticker EXACTLY, laid out by the existing native engine, and never recomputes values.

create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  -- Dedup key: a double-click, refresh, or retry re-enqueuing the SAME sticker collides here
  -- and is ignored, so one intent = exactly one physical print.
  idempotency_key text not null,
  -- Explicit job type. CAPTURE_STICKER is reserved (captures use their own queue today); this
  -- queue currently carries ORDER_STICKER only.
  job_type text not null default 'ORDER_STICKER'
    check (job_type in ('ORDER_STICKER','CAPTURE_STICKER')),
  official_order_id uuid references public.official_orders(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued','claimed','printing','printed','failed','voided')),
  customer_display_name text,
  item_name text,
  item_code text,
  total_price numeric check (total_price is null or total_price >= 0),
  -- { lines:[{text,kind}], ...OrderReceiptData }. jsonb so the approved LAYOUT stays owned by
  -- the renderer and this schema never dictates sticker format.
  sticker jsonb not null,
  label_size text,
  is_test boolean not null default false,
  attempts integer not null default 0,
  claimed_by_device text,
  claimed_at timestamptz,
  printed_at timestamptz,
  failed_reason text,
  created_by uuid references public.staff_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint print_jobs_idempotency_key_uniq unique (idempotency_key)
);

comment on table public.print_jobs is
  'Typed web-originated print jobs (ORDER_STICKER) delivered to the native MineFlow Capture app (Owner 2026-09-07, staged cutover). Browser fallback retained until physical acceptance.';

create index if not exists print_jobs_queued_idx
  on public.print_jobs (created_at) where status = 'queued';
create index if not exists print_jobs_order_idx
  on public.print_jobs (official_order_id);

drop trigger if exists print_jobs_updated_at on public.print_jobs;
create trigger print_jobs_updated_at
  before update on public.print_jobs
  for each row execute function app_private.set_updated_at();

alter table public.print_jobs enable row level security;

drop policy if exists print_jobs_select on public.print_jobs;
create policy print_jobs_select on public.print_jobs
  for select using (app_private.is_active_staff());

revoke all on public.print_jobs from anon;

-- ── Enqueue (web) — active staff; idempotent on the key. job_type is ORDER_STICKER. ──────
create or replace function public.enqueue_order_print_job(
  p_idempotency_key text, p_official_order_id uuid, p_sticker jsonb,
  p_customer text, p_item_name text, p_item_code text, p_total_price numeric, p_label_size text
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_id uuid;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_idempotency_key), '') = '' then
    raise exception 'An idempotency key is required.';
  end if;
  if p_sticker is null then
    raise exception 'A sticker payload is required.';
  end if;
  insert into public.print_jobs (
    idempotency_key, job_type, official_order_id, sticker, customer_display_name,
    item_name, item_code, total_price, label_size, created_by
  ) values (
    p_idempotency_key, 'ORDER_STICKER', p_official_order_id, p_sticker,
    nullif(trim(coalesce(p_customer,'')),''),
    nullif(trim(coalesce(p_item_name,'')),''),
    nullif(trim(coalesce(p_item_code,'')),''),
    p_total_price, nullif(trim(coalesce(p_label_size,'')),''),
    app_private.current_staff_id()
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.print_jobs where idempotency_key = p_idempotency_key;
    return jsonb_build_object('enqueued', false, 'duplicate', true, 'print_job_id', v_id);
  end if;
  return jsonb_build_object('enqueued', true, 'duplicate', false, 'print_job_id', v_id);
end;
$$;

-- ── Claim next (native device) — atomic single-device claim; returns the typed job. ──────
create or replace function public.claim_next_print_job(p_device text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v public.print_jobs;
begin
  if not app_private.has_permission('confirm_claim_print_label') then
    raise exception 'Not authorized to print labels.' using errcode = 'insufficient_privilege';
  end if;
  select * into v from public.print_jobs
    where status = 'queued' and claimed_at is null
    order by created_at asc for update skip locked limit 1;
  if not found then return jsonb_build_object('claimed', false); end if;
  update public.print_jobs set
    status = 'claimed',
    claimed_by_device = nullif(trim(coalesce(p_device,'')),''),
    claimed_at = now(), attempts = attempts + 1
  where id = v.id;
  return jsonb_build_object(
    'claimed', true, 'print_job_id', v.id, 'job_type', v.job_type,
    'official_order_id', v.official_order_id, 'sticker', v.sticker,
    'label_size', v.label_size, 'is_test', v.is_test);
end;
$$;

-- ── Result (native device) — terminal + guarded so a reconnect never reprints. ──────────
create or replace function public.mark_print_job_printed(p_id uuid)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not app_private.has_permission('confirm_claim_print_label') then
    raise exception 'Not authorized to print labels.' using errcode = 'insufficient_privilege';
  end if;
  update public.print_jobs
    set status = 'printed', printed_at = now(), failed_reason = null
    where id = p_id and status in ('claimed','printing');
end;
$$;

create or replace function public.mark_print_job_failed(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not app_private.has_permission('confirm_claim_print_label') then
    raise exception 'Not authorized to print labels.' using errcode = 'insufficient_privilege';
  end if;
  update public.print_jobs
    set status = 'failed', failed_reason = nullif(trim(coalesce(p_reason,'')),''),
        claimed_by_device = null, claimed_at = null
    where id = p_id and status in ('claimed','printing');
end;
$$;

create or replace function public.requeue_print_job(p_id uuid)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  update public.print_jobs
    set status = 'queued', claimed_by_device = null, claimed_at = null, failed_reason = null
    where id = p_id and status = 'failed';
end;
$$;

revoke execute on function public.enqueue_order_print_job(text,uuid,jsonb,text,text,text,numeric,text) from public;
revoke execute on function public.claim_next_print_job(text) from public;
revoke execute on function public.mark_print_job_printed(uuid) from public;
revoke execute on function public.mark_print_job_failed(uuid,text) from public;
revoke execute on function public.requeue_print_job(uuid) from public;
grant execute on function public.enqueue_order_print_job(text,uuid,jsonb,text,text,text,numeric,text) to authenticated;
grant execute on function public.claim_next_print_job(text) to authenticated;
grant execute on function public.mark_print_job_printed(uuid) to authenticated;
grant execute on function public.mark_print_job_failed(uuid,text) to authenticated;
grant execute on function public.requeue_print_job(uuid) to authenticated;
