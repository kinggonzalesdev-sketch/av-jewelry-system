-- Inventory delete is now gated by the inventory_delete PERMISSION, not the
-- owner/selected_admin ROLE (Owner request 2026-08-17: only Super Admins + Cynthia
-- may delete inventory). app_private.has_permission returns true for the Owner (holds
-- every key) and for anyone with an explicit inventory_delete grant; every other
-- Admin/Staff is denied. The SECURITY DEFINER function is the real backend gate —
-- RLS already denies any direct PostgREST delete (no DELETE policy on inventory_items
-- / item_photos). Owner-approved deletion still works: the /approvals executor runs
-- this RPC in the Owner's session, so has_permission('inventory_delete') = true there.
--
-- The matching per-account grant change (revoke inventory_delete from every Selected
-- Admin / Staff except Cynthia) is data, applied via MCP and recorded in the PR/commit
-- — not a schema migration. Applied live via Supabase MCP; committed here for drift.
create or replace function public.delete_inventory_item_direct(p_item_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_deps int;
begin
  if not app_private.has_permission('inventory_delete') then
    raise exception 'Not authorized: deleting an inventory item requires the inventory_delete permission. No record was changed.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.inventory_items where id = p_item_id) then
    raise exception 'Inventory item not found.';
  end if;

  select count(*) into v_deps from public.inventory_item_dependencies(p_item_id) d;
  if v_deps > 0 then
    raise exception 'This item is linked to % business record(s) and cannot be deleted.', v_deps;
  end if;

  delete from public.item_photos where inventory_item_id = p_item_id;
  delete from public.inventory_items where id = p_item_id;
end;
$function$;
