-- Force-delete over-refusal fix + repo-drift recovery (Owner 2026-09-08).
--
-- BUG the Owner hit on item BNW-N-6137: the Super-Admin "Force delete" refused an item held ONLY by
-- resolved records — a WITHDRAWN (cancelled) claim and an APPROVED (finished) return review — with
-- the message "linked to an active order, payment, hold, or sale." Neither record is live.
--
-- Root cause: the blocker count treated EVERY claim as active. The claims term had no status filter,
-- while every sibling guard is status-aware (reservations provisional/committed, reviews in_review).
-- A claim is only a live link while its status is pending_claim / in_review / confirmed_claim; the
-- terminal statuses (withdrawn_pre_confirm, withdrawn_confirmed, rejected) are resolved history and
-- must NOT block — they are cleared below.
--
-- Second bug this exposes: claims.inventory_item_id is ON DELETE RESTRICT and the previous function
-- never deleted claim rows (it only ever reached the delete for items that had no claims at all,
-- because the unfiltered count refused every claim-bearing item first). Now that resolved claims can
-- reach the cleanup, we must clear them and their dependent rows, or the final item delete would
-- fail on the RESTRICT foreign key. This mirrors public.force_delete_completed_item.
--
-- Also: this function previously existed ONLY on production (no migration in the repo). This file
-- brings it back under version control.
--
-- UNCHANGED: still Super-Admin only (SECURITY DEFINER re-checks the role), and every real guard
-- stays — an ACTIVE claim, a provisional/committed reservation, an OPEN (in_review) return review, a
-- layaway ledger line, a miner position, or an item already completed/released/sold_released all
-- still refuse the delete. Only the claim STATUS filter and the resolved-claim cleanup are added.

create or replace function public.delete_inventory_item_force(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_blockers int;
begin
  if app_private.current_staff_role() <> 'owner' then
    raise exception 'Not authorized: force-deleting an inventory item is reserved to the Super Admin. No record was changed.';
  end if;

  if not exists (select 1 from public.inventory_items where id = p_item_id) then
    raise exception 'Inventory item not found.';
  end if;

  -- Count ONLY genuinely active / live links. A claim blocks ONLY while it is still active
  -- (pending_claim / in_review / confirmed_claim); a withdrawn or rejected claim is resolved history
  -- and is cleared below (fix 2026-09-08 — this filter was previously missing).
  select
      (select count(*) from public.claims c
         where c.inventory_item_id = p_item_id
           and c.status in ('pending_claim', 'in_review', 'confirmed_claim'))
    + (select count(*) from public.inventory_reservations r
         where r.inventory_item_id = p_item_id and r.state in ('provisional', 'committed'))
    + (select count(*) from public.returned_to_stock_reviews rts
         where rts.inventory_item_id = p_item_id and rts.status = 'in_review')
    + (select count(*) from public.layaway_ledger ll
         where ll.inventory_item_id = p_item_id)
    + (select count(*) from public.layaway_ledger_items lli
         where lli.inventory_item_id = p_item_id)
    + (select count(*) from public.miner_positions mp
         where mp.inventory_item_id = p_item_id)
    + (select count(*) from public.inventory_items i
         where i.id = p_item_id
           and i.availability_status in ('completed', 'released', 'sold_released'))
    into v_blockers;

  if v_blockers > 0 then
    raise exception 'This item is linked to an active order, payment, hold, or sale and cannot be deleted — those records are protected.';
  end if;

  -- Only resolved / historical child rows remain. Clear them (their RESTRICT foreign keys would
  -- otherwise block the delete), then remove the item.

  -- Resolved CLAIMS (withdrawn / rejected only — the active guard above refused any live claim) and
  -- their dependent rows FIRST, because claims.inventory_item_id is ON DELETE RESTRICT.
  delete from public.claim_evidence
    where claim_id in (select id from public.claims where inventory_item_id = p_item_id);
  delete from public.invoice_draft_claims
    where claim_id in (select id from public.claims where inventory_item_id = p_item_id);
  delete from public.label_jobs
    where claim_id in (select id from public.claims where inventory_item_id = p_item_id);
  delete from public.price_overrides
    where claim_id in (select id from public.claims where inventory_item_id = p_item_id);
  delete from public.official_order_claims
    where claim_id in (select id from public.claims where inventory_item_id = p_item_id);
  delete from public.miner_positions
    where claim_id in (select id from public.claims where inventory_item_id = p_item_id)
       or switched_from_claim_id in (select id from public.claims where inventory_item_id = p_item_id);
  delete from public.waitlist_entries
    where claim_id in (select id from public.claims where inventory_item_id = p_item_id);

  delete from public.returned_to_stock_reviews where inventory_item_id = p_item_id;
  delete from public.inventory_reservations where inventory_item_id = p_item_id;

  delete from public.claims where inventory_item_id = p_item_id;

  delete from public.live_batch_items where inventory_item_id = p_item_id;
  delete from public.capture_review_queue where inventory_item_id = p_item_id;
  delete from public.capture_records where inventory_item_id = p_item_id;
  delete from public.waitlist_entries where inventory_item_id = p_item_id;
  delete from public.item_photos where inventory_item_id = p_item_id;
  delete from public.inventory_items where id = p_item_id;
end;
$function$;

revoke all on function public.delete_inventory_item_force(uuid) from public, anon;
grant execute on function public.delete_inventory_item_force(uuid) to authenticated;
