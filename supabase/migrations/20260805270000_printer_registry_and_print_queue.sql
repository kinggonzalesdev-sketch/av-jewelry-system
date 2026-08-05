-- Printer registry + single-claim print queue (live-readiness). Register named
-- printers and pick a default; a print queue where each label job is CLAIMED by
-- exactly one device (FOR UPDATE SKIP LOCKED) so two phones never print the same
-- sticker. Additive: label_jobs gains nullable claim columns; the existing
-- server-side print/attempt flow is untouched.

create table if not exists public.printers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target text,
  transport text not null default 'bluetooth'
    check (transport in ('bluetooth', 'escpos', 'tspl', 'browser_preview')),
  label_size text,
  is_active boolean not null default true,
  is_default boolean not null default false,
  registered_by uuid references public.staff_profiles(id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
create unique index if not exists printers_one_default on public.printers (is_default)
  where is_default;

alter table public.printers enable row level security;
drop policy if exists printers_read on public.printers;
create policy printers_read on public.printers
  for select to authenticated using (app_private.is_active_staff());

alter table public.label_jobs
  add column if not exists claimed_by_printer uuid references public.printers(id),
  add column if not exists claimed_by_device text,
  add column if not exists claimed_at timestamptz;

create or replace function public.register_printer(
  p_name text, p_target text default null, p_transport text default 'bluetooth',
  p_label_size text default null
) returns uuid language plpgsql security definer set search_path to '' as $$
declare v_id uuid; v_first boolean;
begin
  if app_private.current_staff_role() not in ('owner', 'selected_admin') then
    raise exception 'Only the Owner or an Admin can register a printer.'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'A printer name is required.' using errcode = 'check_violation';
  end if;
  select not exists (select 1 from public.printers) into v_first;
  insert into public.printers (name, target, transport, label_size, is_default, registered_by, last_seen_at)
    values (
      trim(p_name), nullif(trim(coalesce(p_target, '')), ''),
      coalesce(nullif(trim(coalesce(p_transport, '')), ''), 'bluetooth'),
      nullif(trim(coalesce(p_label_size, '')), ''), v_first,
      app_private.current_staff_id(), now())
    returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_printer(
  p_id uuid, p_name text default null, p_active boolean default null,
  p_make_default boolean default null
) returns void language plpgsql security definer set search_path to '' as $$
begin
  if app_private.current_staff_role() not in ('owner', 'selected_admin') then
    raise exception 'Only the Owner or an Admin can change a printer.'
      using errcode = 'insufficient_privilege';
  end if;
  update public.printers set
    name = coalesce(nullif(trim(coalesce(p_name, '')), ''), name),
    is_active = coalesce(p_active, is_active)
  where id = p_id;
  if p_make_default is true then
    update public.printers set is_default = false where is_default and id <> p_id;
    update public.printers set is_default = true where id = p_id;
  end if;
end;
$$;

create or replace function public.delete_printer(p_id uuid)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if app_private.current_staff_role() not in ('owner', 'selected_admin') then
    raise exception 'Only the Owner or an Admin can remove a printer.'
      using errcode = 'insufficient_privilege';
  end if;
  update public.label_jobs
    set claimed_by_printer = null, claimed_by_device = null, claimed_at = null
    where claimed_by_printer = p_id and status = 'pending_print';
  delete from public.printers where id = p_id;
end;
$$;

create or replace function public.claim_next_label_job(
  p_printer_id uuid default null, p_device text default null
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_job public.label_jobs;
begin
  if not app_private.has_permission('confirm_claim_print_label') then
    raise exception 'Not authorized to print labels.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_job from public.label_jobs
    where status = 'pending_print' and claimed_at is null
    order by created_at asc
    for update skip locked
    limit 1;
  if not found then
    return jsonb_build_object('claimed', false);
  end if;
  update public.label_jobs set
    claimed_by_printer = p_printer_id,
    claimed_by_device = nullif(trim(coalesce(p_device, '')), ''),
    claimed_at = now()
  where id = v_job.id;
  if p_printer_id is not null then
    update public.printers set last_seen_at = now() where id = p_printer_id;
  end if;
  return jsonb_build_object(
    'claimed', true, 'label_job_id', v_job.id, 'claim_id', v_job.claim_id,
    'item_code', v_job.item_code, 'item_name', v_job.item_name,
    'customer_display_name', v_job.customer_display_name,
    'grams_per_piece', v_job.grams_per_piece, 'quantity', v_job.quantity,
    'total_price', v_job.total_price, 'label_size', v_job.label_size);
end;
$$;

create or replace function public.mark_label_job_printed(p_job_id uuid)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not app_private.has_permission('confirm_claim_print_label') then
    raise exception 'Not authorized to print labels.' using errcode = 'insufficient_privilege';
  end if;
  update public.label_jobs set
    status = 'printed', last_error = null,
    claimed_at = null, claimed_by_printer = null, claimed_by_device = null
  where id = p_job_id and status <> 'voided';
  insert into public.print_attempts (label_job_id, attempt_number, outcome, is_reprint, transport, attempted_by)
    values (
      p_job_id,
      (select coalesce(max(attempt_number), 0) + 1 from public.print_attempts where label_job_id = p_job_id),
      'printed', false, 'device', app_private.current_staff_id());
end;
$$;

create or replace function public.mark_label_job_failed(p_job_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare v_reason text;
begin
  if not app_private.has_permission('confirm_claim_print_label') then
    raise exception 'Not authorized to print labels.' using errcode = 'insufficient_privilege';
  end if;
  v_reason := coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Print failed on the device.');
  update public.label_jobs set
    status = 'failed_print', last_error = v_reason,
    claimed_at = null, claimed_by_printer = null, claimed_by_device = null
  where id = p_job_id and status <> 'voided';
  insert into public.print_attempts (label_job_id, attempt_number, outcome, failure_reason, is_reprint, transport, attempted_by)
    values (
      p_job_id,
      (select coalesce(max(attempt_number), 0) + 1 from public.print_attempts where label_job_id = p_job_id),
      'failed', v_reason, false, 'device', app_private.current_staff_id());
end;
$$;

create or replace function public.release_label_claim(p_job_id uuid)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not app_private.has_permission('confirm_claim_print_label') then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  update public.label_jobs set
    claimed_at = null, claimed_by_printer = null, claimed_by_device = null
  where id = p_job_id and status = 'pending_print';
end;
$$;

revoke all on function public.register_printer(text, text, text, text) from public;
revoke all on function public.update_printer(uuid, text, boolean, boolean) from public;
revoke all on function public.delete_printer(uuid) from public;
revoke all on function public.claim_next_label_job(uuid, text) from public;
revoke all on function public.mark_label_job_printed(uuid) from public;
revoke all on function public.mark_label_job_failed(uuid, text) from public;
revoke all on function public.release_label_claim(uuid) from public;
grant execute on function public.register_printer(text, text, text, text) to authenticated;
grant execute on function public.update_printer(uuid, text, boolean, boolean) to authenticated;
grant execute on function public.delete_printer(uuid) to authenticated;
grant execute on function public.claim_next_label_job(uuid, text) to authenticated;
grant execute on function public.mark_label_job_printed(uuid) to authenticated;
grant execute on function public.mark_label_job_failed(uuid, text) to authenticated;
grant execute on function public.release_label_claim(uuid) to authenticated;

alter publication supabase_realtime add table public.printers;
