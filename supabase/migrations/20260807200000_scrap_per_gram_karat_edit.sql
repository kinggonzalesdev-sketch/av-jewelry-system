-- Scrap Income: per-gram rate + karat, and an Owner/Admin EDIT path.
--
-- The Owner wants scrap recorded like the Orders "New Entry" flow — a Customer Name,
-- then per item a Per Gram rate + Karat with the amount auto-computed (grams × per
-- gram) — plus an Edit action on each row. Scrap was append-only (insert + delete
-- only); this adds two nullable columns and a gated update RPC. Additive & safe.

alter table public.scrap_sales
  add column if not exists per_gram numeric(14, 2) check (per_gram is null or per_gram >= 0),
  add column if not exists karat text check (karat is null or length(trim(karat)) <= 20);

comment on column public.scrap_sales.per_gram is 'Price per gram used to auto-compute the amount (grams × per_gram). Nullable.';
comment on column public.scrap_sales.karat is 'Karat / purity of the scrap piece, e.g. 18K / 21K / 925. Nullable.';

-- Edit ONE scrap sale (Owner / Selected Admin). SECURITY DEFINER — scrap has no
-- UPDATE RLS policy (append-only for staff); this is the single gated edit path,
-- mirroring delete_scrap_sale.
create or replace function public.update_scrap_sale(
  p_id uuid,
  p_material text,
  p_grams numeric,
  p_amount numeric,
  p_buyer text,
  p_karat text,
  p_per_gram numeric,
  p_sold_on date,
  p_note text
) returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if app_private.current_staff_role() not in ('owner', 'selected_admin') then
    raise exception 'Only the Owner or an Admin can edit a scrap sale.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_material not in ('gold', 'silver') then
    raise exception 'Material must be gold or silver.' using errcode = 'check_violation';
  end if;
  if p_grams is null or p_grams <= 0 then
    raise exception 'Grams must be greater than zero.' using errcode = 'check_violation';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'Amount must be a valid, non-negative number.' using errcode = 'check_violation';
  end if;

  update public.scrap_sales set
    material = p_material,
    grams = p_grams,
    amount = p_amount,
    buyer = nullif(trim(coalesce(p_buyer, '')), ''),
    karat = nullif(trim(coalesce(p_karat, '')), ''),
    per_gram = p_per_gram,
    sold_on = coalesce(p_sold_on, sold_on),
    note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_id;

  if not found then
    raise exception 'That scrap sale no longer exists.' using errcode = 'no_data_found';
  end if;
end;
$function$;

revoke all on function
  public.update_scrap_sale(uuid, text, numeric, numeric, text, text, numeric, date, text)
  from public, anon;
grant execute on function
  public.update_scrap_sale(uuid, text, numeric, numeric, text, text, numeric, date, text)
  to authenticated;
