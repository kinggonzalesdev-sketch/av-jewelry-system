-- BUGFIX (2026-08-13): the layaway "Transfer to Destination" AND "Cancel" actions both
-- threw `layaway_ledger_status_check` violations.
--
--   * transfer_layaway_to_destination (20260801160000) sets status = 'transferred'
--   * cancel_layaway_ledger           (20260803120000) sets status = 'cancelled'
--
-- ...but the live CHECK constraint had been narrowed to ('active','completed') only, so
-- every transfer of an order-linked layaway and every cancel failed at the UPDATE. This
-- restores the full intended lifecycle set from phase1 (20260715120500) PLUS the two states
-- the newer functions set. Widening a CHECK is non-destructive — all existing rows are
-- 'active'/'completed' and remain valid. The ledger readers already `.neq('status',
-- 'transferred')` / `.neq('status','cancelled')`, so those rows correctly leave the ACTIVE
-- layaway list once set (the "auto-disappear on transfer" behaviour the feature intends).
alter table public.layaway_ledger drop constraint if exists layaway_ledger_status_check;
alter table public.layaway_ledger add constraint layaway_ledger_status_check
  check (status in (
    'active',
    'overdue',
    'grace_period',
    'forfeiture_eligible',
    'forfeited',
    'completed',
    'cancelled',
    'transferred'
  ));
