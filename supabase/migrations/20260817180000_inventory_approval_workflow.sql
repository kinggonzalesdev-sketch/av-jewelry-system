-- Inventory approval workflow (2026-08-17). Admins INITIATE (request); only a Super Admin
-- (owner) EXECUTES — directly or via the approvals executor (which runs in the Owner's
-- session). Direct-mutation RPCs are OWNER-ONLY so an Admin cannot bypass via API/RPC.
-- Applied live via Supabase MCP; the exact production bodies are reproduced below so the
-- repository is not drift-only.
--
-- 1) inventory_item_dependencies gate -> owner|selected_admin. This is the ROOT-CAUSE FIX:
--    the delete path calls this internally, and it previously required the
--    `inventory_monitoring` permission, producing the false "inventory_monitoring
--    permission is required" error when an Admin merely INITIATED a delete.
-- 2) delete_inventory_item_direct -> OWNER-ONLY (superseding the old inventory_delete grant,
--    incl. Cynthia's). Re-counts dependencies at execution (protected-item safety).
-- 3) apply_inventory_item_edit(p_item_id, p_proposed, p_original) -> OWNER-ONLY. Re-reads the
--    row FOR UPDATE, STALE-CHECKS it against the values captured at request time, then
--    validates + applies proposed. New in this workflow.
-- 4) request_inventory_change(p_action_kind, p_item_id, p_reason, p_payload) -> owner|admin.
--    The INITIATE side: inserts a pending owner_approval_request and mutates NO inventory.

create or replace function public.inventory_item_dependencies(p_item_id uuid)
 returns table(dependency_kind text, reference_label text, is_active boolean)
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
begin
  if app_private.current_staff_role() not in ('owner','selected_admin') then
    raise exception 'Not authorized: managing inventory is reserved to the Owner or an Admin.'
      using errcode = 'insufficient_privilege';
  end if;
  return query
  select 'order'::text, coalesce(o.order_number, o.invoice_number, o.id::text),
         (o.status is distinct from 'completed' and o.status is distinct from 'cancelled')
  from public.official_orders o
  join public.official_order_claims ooc on ooc.official_order_id = o.id
  join public.claims c on c.id = ooc.claim_id
  where c.inventory_item_id = p_item_id
  union all
  select 'claim'::text, coalesce(c.claim_reference, c.id::text), false
  from public.claims c
  where c.inventory_item_id = p_item_id
    and not exists (select 1 from public.official_order_claims ooc where ooc.claim_id = c.id)
  union all
  select 'reservation'::text, r.state, (r.state in ('provisional', 'committed'))
  from public.inventory_reservations r where r.inventory_item_id = p_item_id
  union all
  select 'live_batch'::text, coalesce(lb.batch_reference, lb.id::text), false
  from public.live_batch_items lbi
  join public.live_batches lb on lb.id = lbi.live_batch_id
  where lbi.inventory_item_id = p_item_id
  union all
  select 'rts_review'::text, rts.status, (rts.status = 'in_review')
  from public.returned_to_stock_reviews rts where rts.inventory_item_id = p_item_id
  union all
  select 'completed_sale'::text, i.availability_status, false
  from public.inventory_items i
  where i.id = p_item_id and i.availability_status in ('completed', 'released', 'sold_released');
end;
$function$;

create or replace function public.delete_inventory_item_direct(p_item_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_deps int;
begin
  if not app_private.is_owner() then
    raise exception 'Not authorized: executing an inventory delete is reserved to a Super Admin. Admins must submit it for approval.'
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

create or replace function public.apply_inventory_item_edit(p_item_id uuid, p_proposed jsonb, p_original jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_name text; v_grams_txt text; v_grams numeric; v_size text; v_supplier text; v_fb text;
  c_name text; c_grams text; c_size text; c_supplier text; c_fb text;
begin
  if not app_private.is_owner() then
    raise exception 'Not authorized: applying an inventory edit is reserved to a Super Admin.'
      using errcode = 'insufficient_privilege';
  end if;

  select item_name, coalesce(grams_per_piece::text,''), coalesce(size,''),
         coalesce(supplier_name,''), coalesce(facebook_name,'')
    into c_name, c_grams, c_size, c_supplier, c_fb
  from public.inventory_items where id = p_item_id and is_archived = false for update;
  if not found then raise exception 'Inventory item not found (or archived).'; end if;

  -- STALE-CHECK: the row must still match what the requester saw. If any relevant field
  -- changed after the request, refuse and require review — never silently overwrite.
  if p_original is not null then
    if coalesce(c_name,'')  is distinct from coalesce(p_original->>'itemName','')
    or c_grams              is distinct from coalesce(p_original->>'grams','')
    or c_size               is distinct from coalesce(p_original->>'size','')
    or c_supplier           is distinct from coalesce(p_original->>'supplierName','')
    or c_fb                 is distinct from coalesce(p_original->>'facebookName','') then
      raise exception 'This inventory item changed after the request was created — review the current values before approving (stale-data conflict).'
        using errcode = 'check_violation';
    end if;
  end if;

  v_name := nullif(btrim(coalesce(p_proposed->>'itemName','')), '');
  if v_name is null then raise exception 'Item name is required.'; end if;
  if length(v_name) > 160 then raise exception 'Item name must be 160 characters or fewer.'; end if;
  v_grams_txt := nullif(btrim(coalesce(p_proposed->>'grams','')), '');
  if v_grams_txt is not null then
    if v_grams_txt !~ '^\d+(\.\d{1,3})?$' or v_grams_txt::numeric <= 0 then
      raise exception 'Grams must be a positive number like 12.2.';
    end if;
    v_grams := v_grams_txt::numeric;
  end if;
  v_size := nullif(btrim(coalesce(p_proposed->>'size','')), '');
  v_supplier := nullif(btrim(coalesce(p_proposed->>'supplierName','')), '');
  v_fb := nullif(btrim(coalesce(p_proposed->>'facebookName','')), '');

  update public.inventory_items
     set item_name = v_name, grams_per_piece = v_grams, size = v_size,
         supplier_name = v_supplier, facebook_name = v_fb
   where id = p_item_id;
end;
$function$;

create or replace function public.request_inventory_change(p_action_kind text, p_item_id uuid, p_reason text, p_payload jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_staff uuid; v_id uuid;
begin
  if app_private.current_staff_role() not in ('owner','selected_admin') then
    raise exception 'Not authorized: only the Owner or an Admin may request an inventory change.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_action_kind not in ('inventory_item_delete','inventory_item_edit') then
    raise exception 'Invalid inventory action kind.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.inventory_items where id = p_item_id and is_archived = false) then
    raise exception 'Inventory item not found.' using errcode = 'check_violation';
  end if;
  select sp.id into v_staff from public.staff_profiles sp where sp.auth_user_id = (select auth.uid());
  insert into public.owner_approval_requests
    (action_kind, status, entity_type, entity_id, reason, payload, requested_by)
  values (p_action_kind, 'pending_owner_approval', 'inventory_item', p_item_id,
          nullif(btrim(coalesce(p_reason,'')), ''), p_payload, v_staff)
  returning id into v_id;
  return v_id;
end;
$function$;
