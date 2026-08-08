-- Batch available-quantity reader — performance only, NO formula change, NO data change.
--
-- The Live session batch view (listLiveBatchItems) reads stock by calling
-- public.available_quantity_for() ONCE PER ITEM in the batch — one PostgREST
-- round-trip per row. This collapses those into ONE round-trip.
--
-- It does NOT reimplement anything: it calls the same app_private.available_quantity()
-- that available_quantity_for() wraps, so the number is identical and cannot drift.
-- SECURITY INVOKER + empty search_path match available_quantity_for() exactly, so
-- RLS/visibility is unchanged. Per-row BEGIN/EXCEPTION preserves resilience: an
-- item whose quantity cannot be computed yields NULL (rendered as "—"), never a
-- broken view. Read-only — creates a function; touches no table and no row.

create or replace function public.available_quantities_for(p_item_ids uuid[])
returns table (item_id uuid, available_quantity integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  iid uuid;
begin
  foreach iid in array coalesce(p_item_ids, array[]::uuid[]) loop
    begin
      item_id := iid;
      available_quantity := app_private.available_quantity(iid);
    exception
      when others then
        item_id := iid;
        available_quantity := null;
    end;
    return next;
  end loop;
end;
$$;

-- Mirror available_quantity_for(): PUBLIC execute (the default on CREATE FUNCTION),
-- made explicit for the app's role.
grant execute on function public.available_quantities_for(uuid[]) to authenticated, service_role;

comment on function public.available_quantities_for(uuid[]) is
  'Batch wrapper over available_quantity_for() — one round-trip for many items. '
  'Same computation, same RLS (SECURITY INVOKER). Performance only; no data change.';
