-- Extend the inventory status integrity guard (20260818200000) to INSERT.
--
-- The AFTER UPDATE constraint trigger left an INSERT bypass: a row could be born
-- 'committed'/'completed' out of band with no backing sale/claim/layaway. Verified safe to
-- guard INSERT: every legitimate insert path (Inventory New Entry, manual New-Order create, and
-- the CSV/workbook import) inserts availability_status='available', and 0 of the 1,252
-- committed/completed items in production were ever inserted in that status (all reached it via
-- UPDATE — created_at <> updated_at for every one). So this can only ever block out-of-band
-- inserts; a normal New Entry (status 'available') never trips the WHEN clause.
--
-- A SEPARATE INSERT trigger is required because a WHEN clause on an INSERT trigger cannot
-- reference OLD. It shares the same DEFERRABLE INITIALLY DEFERRED enforce function, so a future
-- legitimate flow that inserts a committed item and writes its backer later in the same
-- transaction still passes (the check runs at COMMIT against the final state).
drop trigger if exists inventory_status_integrity_insert on public.inventory_items;
create constraint trigger inventory_status_integrity_insert
  after insert on public.inventory_items
  deferrable initially deferred
  for each row
  when (new.availability_status in ('completed','committed','provisionally_reserved'))
  execute function app_private.enforce_inventory_status_integrity();
