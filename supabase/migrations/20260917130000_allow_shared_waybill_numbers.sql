-- SHARED LBC WAYBILL / TRACKING NUMBERS (Owner request 2026-09-17).
--
-- Business rule: a waybill / tracking number identifies a SHIPMENT (one package), not an order.
-- Several orders shipped together in one package legitimately carry the same number, so the
-- same value may now be saved on any number of orders. Orders are never merged: each order
-- keeps its own payments, items and history, and simply shows the shared shipment reference.
--
-- ROOT CAUSE of the refusal. Production migration `ship_confirm_waybill_and_destinations`
-- (applied directly on 2026-07-30, no file in this repository) created the partial UNIQUE index
--   official_orders_waybill_uidx ON public.official_orders (lower(waybill_number))
--   WHERE waybill_number IS NOT NULL AND status <> 'cancelled'
-- and `set_order_waybill(p_order_id, p_waybill)` turns that index's unique_violation into
-- "That waybill number is already used by another active order." A repository-wide and
-- transcript-wide audit found no other check anywhere: no web or server validation, no API route,
-- no other index, constraint, trigger or function. Nothing looks an order up by its waybill, and
-- no foreign key can reference an expression index.
--
-- THE CHANGE: drop that one unique index, after proving it is exactly the index described
-- above and backs no constraint. Then assert no other UNIQUE index on official_orders mentions
-- the waybill; if one exists the migration FAILS instead of silently leaving duplicates blocked.
-- No replacement index is created, because no query uses this one. The Orders search is
-- coalesce(waybill_number, '') ilike '%term%', which never used it. The existing non-unique
-- trigram index official_orders_waybill_trgm is left untouched.
--
-- `set_order_waybill` is deliberately NOT rewritten. Its live body exists only in production,
-- and after this change its unique_violation handler can no longer fire. Everything else it does
-- is preserved as-is:
--   * the fulfillment_release permission check,
--   * trimming and refusal of a blank value,
--   * locking and updating the one order row IN PLACE. Saving twice cannot create a second
--     record; it only restamps the same row.
--   * waybill_set_at / waybill_set_by and the order.waybill_set audit event,
--   * the shipping completion gate in order_completion_block.
--
-- DATA: no row is updated, inserted or deleted. Existing waybill numbers stay exactly as they are.
-- LOCKING: DROP INDEX briefly takes an ACCESS EXCLUSIVE lock on official_orders; the lock_timeout
-- below makes it give up quickly instead of queueing app traffic behind a long transaction.
-- RUNNER: execute this ONE file on the production project, via the SQL editor, psql or
-- apply_migration. Do not use `supabase db push`: it would also push every other unapplied local
-- migration.
--
-- ROLLBACK. This is effectively one-way once orders share a waybill.
--   (1) Pre-check, which must return ZERO rows:
--       select lower(waybill_number), count(*) from public.official_orders
--        where waybill_number is not null and status <> 'cancelled' group by 1 having count(*) > 1;
--   (2) Only then:
--       set lock_timeout = '5s';
--       create unique index official_orders_waybill_uidx on public.official_orders (lower(waybill_number))
--         where waybill_number is not null and status <> 'cancelled';
--   If (1) returns rows, (2) fails with unique_violation. Rolling back would then mean editing real
--   orders' waybills, which the business rules forbid.

set lock_timeout = '5s';

do $$
declare
  v_idx oid;
  v_def text;
  v_left text;
begin
  select i.indexrelid, pg_get_indexdef(i.indexrelid)
    into v_idx, v_def
  from pg_catalog.pg_index i
  join pg_catalog.pg_class c on c.oid = i.indexrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'official_orders_waybill_uidx';

  if v_idx is null then
    raise notice 'official_orders_waybill_uidx is not present; nothing to drop.';
  else
    if not exists (
      select 1
      from pg_catalog.pg_index i
      where i.indexrelid = v_idx
        and i.indisunique
        and i.indrelid = 'public.official_orders'::regclass
    ) then
      raise exception 'official_orders_waybill_uidx is not a UNIQUE index on public.official_orders (%). Refusing to drop it.', v_def;
    end if;

    if position('lower(waybill_number)' in v_def) = 0 then
      raise exception 'official_orders_waybill_uidx does not index lower(waybill_number) (%). Refusing to drop it.', v_def;
    end if;

    if exists (select 1 from pg_catalog.pg_constraint where conindid = v_idx) then
      raise exception 'official_orders_waybill_uidx backs a constraint. Refusing to drop it.';
    end if;

    execute 'drop index public.official_orders_waybill_uidx';
    raise notice 'Dropped official_orders_waybill_uidx (%).', v_def;
  end if;

  -- Fail loudly if waybill uniqueness survives under any other index name.
  select string_agg(pg_get_indexdef(i.indexrelid), '; ')
    into v_left
  from pg_catalog.pg_index i
  where i.indrelid = 'public.official_orders'::regclass
    and i.indisunique
    and pg_get_indexdef(i.indexrelid) ilike '%waybill%';

  if v_left is not null then
    raise exception 'A UNIQUE index on official_orders still covers the waybill: %. Duplicate waybills would stay blocked.', v_left;
  end if;
end $$;

comment on column public.official_orders.waybill_number is
  'Shipping waybill / tracking number of the package this order shipped in. NOT unique: orders shipped together in one package share one number. Required before a shipping order completes.';

reset lock_timeout;
