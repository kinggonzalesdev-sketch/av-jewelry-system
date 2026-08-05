-- Owner request: the bulk "Delete All" (Active Inventory) must NOT be visible to or
-- usable by Admin/Staff — it is the one irreversible, everything-at-once action, so
-- it is SUPER ADMIN (owner) only, the same rule the layaway ledger's Delete All
-- already follows (delete_all_layaway_ledger checks is_owner). Previously this RPC
-- allowed owner OR selected_admin; tighten it to owner only. The button and the TS
-- guard (requireOwner) are updated in the same change; this is the database floor.
create or replace function public.delete_all_inventory_items()
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_id uuid;
  v_deleted int := 0;
  v_skipped int := 0;
begin
  if not app_private.is_owner() then
    raise exception 'Not authorized: deleting all inventory is reserved to the Super Admin. No record was changed.';
  end if;

  for v_id in select id from public.inventory_items where is_archived = false loop
    if (select count(*) from public.inventory_item_dependencies(v_id) d) > 0 then
      v_skipped := v_skipped + 1;
    else
      delete from public.item_photos where inventory_item_id = v_id;
      delete from public.inventory_items where id = v_id;
      v_deleted := v_deleted + 1;
    end if;
  end loop;

  return jsonb_build_object('deleted', v_deleted, 'skipped', v_skipped);
end;
$function$;
