-- ============================================================================
-- Returned delivered/shipped item → Returned-to-Stock Review (spec §10). A sold
-- item that comes back is NEVER silently made available — it enters the existing
-- Returned-to-Stock Review flow (inspection + authorized approval) before it can
-- go back to available. Adds the 'delivered_return' trigger kind + a guarded,
-- atomic entry point.
-- ============================================================================

alter table public.returned_to_stock_reviews
  drop constraint returned_to_stock_reviews_trigger_kind_check;
alter table public.returned_to_stock_reviews
  add constraint returned_to_stock_reviews_trigger_kind_check
  check (trigger_kind in (
    'withdrawal_confirmed',
    'order_cancelled',
    'order_expired',
    'claim_rejected',
    'layaway_forfeited_disposition',
    'delivered_return'
  ));

-- SECURITY DEFINER (it inserts into returned_to_stock_reviews, whose RLS does not
-- offer a direct client insert), so it does its OWN permission check. The item
-- stays completed/unavailable until the review is APPROVED and returned through
-- the normal flow — this only opens the review.
create or replace function public.return_completed_item_to_review(
  p_item_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_open int;
begin
  if not app_private.has_permission('inventory_monitoring') then
    raise exception 'Not authorized: the inventory_monitoring permission is required. No record was changed.';
  end if;

  select availability_status into v_status
  from public.inventory_items where id = p_item_id;

  if v_status is null then
    raise exception 'Inventory item not found.';
  end if;
  if v_status not in ('completed', 'released') then
    raise exception 'Only a completed/released item can be returned to stock review.';
  end if;

  -- One open review at a time.
  select count(*) into v_open
  from public.returned_to_stock_reviews
  where inventory_item_id = p_item_id and status = 'in_review';
  if v_open > 0 then
    raise exception 'This item already has an open Returned-to-Stock Review.';
  end if;

  insert into public.returned_to_stock_reviews
    (inventory_item_id, trigger_kind, status, quantity, review_note)
  values (p_item_id, 'delivered_return', 'in_review', 1, nullif(trim(p_note), ''));
end;
$$;

grant execute on function public.return_completed_item_to_review(uuid, text) to authenticated;
