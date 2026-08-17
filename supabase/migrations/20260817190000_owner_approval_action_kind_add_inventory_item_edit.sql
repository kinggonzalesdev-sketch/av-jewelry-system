-- Inventory approval workflow (2026-08-17): an Admin's Inventory Edit routes through the
-- owner_approval_requests queue as action_kind='inventory_item_edit'. The table's CHECK
-- constraint predates that kind, so an Admin Edit request failed with a constraint
-- violation (caught by the pre-role-migration boundary tests). Add the kind; the delete
-- kind was already present. Applied live via MCP migration of the same name.
alter table public.owner_approval_requests
  drop constraint if exists owner_approval_requests_action_kind_check;

alter table public.owner_approval_requests
  add constraint owner_approval_requests_action_kind_check
  check (action_kind = any (array[
    'official_order_cancellation','layaway_forfeiture','price_override',
    'exceptional_fulfillment_release','live_batch_reopen','wrong_payment_to_order_correction',
    'customer_delete','inventory_item_delete','scrap_sale_delete','attendance_delete',
    'layaway_ledger_delete','order_add_item','order_remove_item','order_split_item',
    'order_details_edit','official_order_delete','inventory_item_edit'
  ]::text[]));
