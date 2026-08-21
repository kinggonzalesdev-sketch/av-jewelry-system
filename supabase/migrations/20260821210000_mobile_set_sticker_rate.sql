-- Mobile Save Rate push (Owner 2026-08-21). A capture phone's explicit Save Rate propagates to the
-- ONE shared Sticker Settings so other phones sync it later. Active-staff gated (the capture
-- operator can already set the rate locally). Returns the new revision (updated_at epoch ms) so the
-- phone records it and a stale server copy can never revert a newer save. Purely additive.
create or replace function public.mobile_set_sticker_rate(p_rate text)
returns bigint
language plpgsql
security definer
set search_path to ''
as $$
declare v_price text; v_updated timestamptz;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  v_price := trim(coalesce(p_rate, ''));
  if v_price <> '' and v_price !~ '^\d{1,9}(\.\d{1,2})?$' then
    raise exception 'Enter a valid price per gram (e.g. 7500 or 7500.50).'
      using errcode = 'check_violation';
  end if;

  update public.sticker_settings
    set price_per_gram = v_price,
        show_price_per_gram = (v_price <> ''),  -- a saved rate is shown; a cleared rate is hidden
        updated_at = now()
    where id = 1
    returning updated_at into v_updated;

  if v_updated is null then
    insert into public.sticker_settings(id, show_name, show_price_per_gram, show_date, price_per_gram, updated_at)
    values (1, true, (v_price <> ''), true, v_price, now())
    on conflict (id) do update
      set price_per_gram = excluded.price_per_gram,
          show_price_per_gram = excluded.show_price_per_gram,
          updated_at = excluded.updated_at
    returning updated_at into v_updated;
  end if;

  return (extract(epoch from v_updated) * 1000)::bigint;
end $$;

revoke execute on function public.mobile_set_sticker_rate(text) from anon, public;
