-- INVENTORY DELETE: SHOW EVERY LINKED RECORD, AND LET THE SUPER ADMIN FORCE-DELETE AN ITEM THAT IS
-- HELD ONLY BY CLOSED HISTORY (Owner 2026-09-26).
--
-- The Owner could not force-delete WBN-E-3759 (Returned To Available): its only links are an order
-- line on ORD-2026-000145, which was CANCELLED with no payment, and a finished return-to-stock
-- review. delete_inventory_item_force counted every confirmed_claim as active, even when its only
-- order was cancelled — 8 of the 10 Returned To Available items were stuck the same way. The delete
-- popup also said "linked to 2 business record(s)" without saying which.
--
-- 1. app_private.inventory_item_link_rows(item) — ONE list of everything that links to an item:
--    what it is, a label a person recognises (customer + date, never an order/invoice number or a
--    UUID), its status, the order or layaway account to open, whether it BLOCKS a force delete,
--    and why. The popup and the force delete read the SAME list, so they can never disagree.
-- 2. public.inventory_item_delete_links(item) — that list for the delete popup (Owner or Admin).
-- 3. public.delete_inventory_item_force(item) — refuses while ANY link blocks.
--
-- What blocks (protected, never ignored):
--   - the item is sold, on a live order or hold, or in a return review (any status except
--     available, returned_to_available and held_unavailable — a piece held after a rejected return
--     is not a live order, layaway, payment or sale, and could be force-deleted before too);
--   - any order that is not CANCELLED (live orders and completed sales), whatever the line's state;
--   - a cancelled order with any payment recorded on it;
--   - an open claim that never became an order line;
--   - an active hold (provisional / committed reservation);
--   - an open return-to-stock review;
--   - any layaway account, open or closed — a layaway account carries payment history. That
--     includes an account the item's ORDER was converted into (official_orders.
--     converted_layaway_ledger_id): most conversions link the item only that way, and a forfeited
--     one leaves the item in stock on a cancelled order (review 2026-09-26);
--   - any miner (queue) position that involves the item or its claims;
--   - a live selling batch that is not closed, while the item is not withdrawn from it;
--   - a capture that is not linked to a cancelled order (one with no order is still waiting in
--     Incoming Captures);
--   - a capture review still pending, or approved into an order that is not cancelled;
--   - an active waitlist entry.
-- What may be ignored (closed history): cancelled orders with no payment, withdrawn or rejected
-- claims, released holds, finished return reviews, closed or withdrawn batch rows, captures of
-- cancelled orders, rejected capture reviews, closed waitlist entries.
--
-- A force delete removes the item and its closed history rows — including its LINE on each
-- cancelled order, and the print attempts of that line's labels. The cancelled orders themselves,
-- their customers and every payment stay.
-- Also fixed: the role check was `current_staff_role() <> 'owner'`, which a caller with NO staff
-- profile (NULL) passed; it is now `is distinct from 'owner'`.
--
-- LIVE BODY this was written against (re-check before apply):
--   public.delete_inventory_item_force(uuid)   md5 db3d1532ed7292a66c6610a3130fe938
-- Unchanged: delete_inventory_item_direct (the normal delete) and inventory_item_dependencies.
-- Save point: schema savepoint_20260926_deletelinks (restore_sql in its _meta table).

-- ---------------------------------------------------------------------------
-- 1. The link list.
-- ---------------------------------------------------------------------------
create or replace function app_private.inventory_item_link_rows(p_item_id uuid)
returns table (
  kind      text,
  record_id uuid,
  order_id  uuid,
  ledger_id uuid,
  label     text,
  state     text,
  blocks    boolean,
  reason    text
)
language sql
stable
set search_path to ''
as $function$
  with item_claims as (
    select c.id, c.status, c.claim_reference
    from public.claims c
    where c.inventory_item_id = p_item_id
  )
  -- The item itself: a sold piece, or one on a live order, hold or return review.
  select 'item_status'::text, i.id, null::uuid, null::uuid,
         'This item'::text, i.availability_status, true,
         case when i.availability_status in ('completed', 'released', 'sold_released')
                then 'The item was sold.'
              when i.availability_status = 'in_returned_to_stock_review'
                then 'The item is in a return review.'
              else 'The item is on a live order or hold.' end
  from public.inventory_items i
  where i.id = p_item_id
    and i.availability_status not in ('available', 'returned_to_available', 'held_unavailable')

  union all
  -- Orders the item is, or was, a line of.
  select 'order', o.id, o.id, null,
         concat_ws(' · ', coalesce(cust.display_name, 'Order'),
                          to_char(o.created_at at time zone 'Asia/Manila', 'YYYY-MM-DD')),
         o.status,
         o.status is distinct from 'cancelled' or pay.n > 0,
         case when o.status = 'completed' then 'Completed sale.'
              when o.status is distinct from 'cancelled' then 'Live order.'
              when pay.n > 0 then 'Cancelled, but a payment is recorded on this order.'
              else 'Cancelled order with no payment. A force delete removes only this item''s line; the order stays.' end
  from item_claims c
  join public.official_order_claims ooc on ooc.claim_id = c.id
  join public.official_orders o on o.id = ooc.official_order_id
  left join public.customers cust on cust.id = o.customer_id
  cross join lateral (
    select count(*) as n from public.payments p where p.official_order_id = o.id
  ) pay

  union all
  -- Claims that never became an order line.
  select 'claim', c.id, null, null,
         coalesce(c.claim_reference, 'Claim'), c.status,
         c.status in ('pending_claim', 'in_review', 'confirmed_claim'),
         case when c.status in ('pending_claim', 'in_review', 'confirmed_claim')
              then 'Open claim.' else 'Withdrawn or rejected claim.' end
  from item_claims c
  where not exists (select 1 from public.official_order_claims ooc where ooc.claim_id = c.id)

  union all
  -- Holds.
  select 'reservation', r.id,
         (select ooc.official_order_id from public.official_order_claims ooc
           where ooc.claim_id = r.claim_id limit 1),
         null,
         'Hold · ' || to_char(r.reserved_at at time zone 'Asia/Manila', 'YYYY-MM-DD'),
         r.state,
         r.state in ('provisional', 'committed'),
         case when r.state in ('provisional', 'committed')
              then 'Active hold.' else 'Released hold.' end
  from public.inventory_reservations r
  where r.inventory_item_id = p_item_id

  union all
  -- Return-to-stock reviews (opens the order the item came back from, when known).
  select 'return_review', rts.id,
         (select ooc.official_order_id
            from public.inventory_reservations r
            join public.official_order_claims ooc on ooc.claim_id = r.claim_id
           where r.id = rts.inventory_reservation_id limit 1),
         null,
         'Return to stock · ' || to_char(rts.created_at at time zone 'Asia/Manila', 'YYYY-MM-DD'),
         rts.status,
         rts.status = 'in_review',
         case when rts.status = 'in_review'
              then 'Return review still open.' else 'Finished return review.' end
  from public.returned_to_stock_reviews rts
  where rts.inventory_item_id = p_item_id

  union all
  -- Layaway accounts: the whole-account link, one of the account's items, or the account an order
  -- of this item was converted into. Always protected.
  select 'layaway', l.id, null, l.id,
         concat_ws(' · ', coalesce(l.layaway_code, l.account_no, 'Layaway'), l.customer_name),
         l.status,
         true,
         case when l.status in ('completed', 'cancelled', 'forfeited', 'transferred')
              then 'Closed layaway account. It holds payment history, so it stays protected.'
              else 'Active layaway.' end
  from public.layaway_ledger l
  where l.inventory_item_id = p_item_id
     or exists (select 1 from public.layaway_ledger_items li
                 where li.ledger_id = l.id and li.inventory_item_id = p_item_id)
     or l.id in (select o.converted_layaway_ledger_id
                   from item_claims c
                   join public.official_order_claims ooc on ooc.claim_id = c.id
                   join public.official_orders o on o.id = ooc.official_order_id)

  union all
  -- Miner (queue) positions on the item, or holding one of its claims. Always protected.
  select 'miner', m.id, null, null,
         'Miner position ' || m.position::text, 'queued', true,
         'A customer is queued for this item.'
  from public.miner_positions m
  where m.inventory_item_id = p_item_id
     or m.claim_id in (select c.id from item_claims c)
     or m.switched_from_claim_id in (select c.id from item_claims c)

  union all
  -- Live selling batches.
  select 'live_batch', lbi.id, null, null,
         coalesce(lb.title, lb.batch_reference, 'Live batch'),
         case when lbi.withdrawn_at is not null then 'withdrawn' else lb.status end,
         lbi.withdrawn_at is null and lb.status is distinct from 'closed',
         case when lbi.withdrawn_at is null and lb.status is distinct from 'closed'
              then 'On a live batch that is not closed.' else 'Closed live batch.' end
  from public.live_batch_items lbi
  join public.live_batches lb on lb.id = lbi.live_batch_id
  where lbi.inventory_item_id = p_item_id

  union all
  -- Captures.
  select 'capture', cr.id, cr.official_order_id, null,
         'Capture · ' || to_char(coalesce(cr.captured_at, cr.created_at) at time zone 'Asia/Manila', 'YYYY-MM-DD'),
         coalesce(o.status, 'pending'),
         o.id is null or o.status is distinct from 'cancelled',
         case when o.id is null then 'Capture still waiting in Incoming Captures.'
              when o.status is distinct from 'cancelled' then 'Capture of a live order.'
              else 'Capture of a cancelled order.' end
  from public.capture_records cr
  left join public.official_orders o on o.id = cr.official_order_id
  where cr.inventory_item_id = p_item_id

  union all
  -- Capture review queue.
  select 'capture_review', q.id, q.official_order_id, null,
         concat_ws(' · ', coalesce(q.customer_name, 'Capture review'),
                          to_char(q.created_at at time zone 'Asia/Manila', 'YYYY-MM-DD')),
         q.status,
         q.status = 'pending_review' or (o.id is not null and o.status is distinct from 'cancelled'),
         case when q.status = 'pending_review' then 'Capture review still pending.'
              when o.id is not null and o.status is distinct from 'cancelled' then 'Approved into a live order.'
              else 'Closed capture review.' end
  from public.capture_review_queue q
  left join public.official_orders o on o.id = q.official_order_id
  where q.inventory_item_id = p_item_id

  union all
  -- Waitlist entries (on the item, or on one of its claims).
  select 'waitlist', w.id, null, null,
         'Waitlist · ' || to_char(w.created_at at time zone 'Asia/Manila', 'YYYY-MM-DD'),
         w.status,
         w.status in ('waitlisted', 'excess'),
         case when w.status in ('waitlisted', 'excess')
              then 'Active waitlist entry.' else 'Closed waitlist entry.' end
  from public.waitlist_entries w
  where w.inventory_item_id = p_item_id
     or w.claim_id in (select c.id from item_claims c)
$function$;

-- Only the SECURITY DEFINER functions below call it.
revoke all on function app_private.inventory_item_link_rows(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The list for the delete popup. Owner or Admin; the 'inactive' sentinel and a caller with no
--    staff profile are refused.
-- ---------------------------------------------------------------------------
create or replace function public.inventory_item_delete_links(p_item_id uuid)
returns table (
  kind      text,
  record_id uuid,
  order_id  uuid,
  ledger_id uuid,
  label     text,
  state     text,
  blocks    boolean,
  reason    text
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if coalesce(app_private.current_staff_role(), '') not in ('owner', 'selected_admin') then
    raise exception 'Not authorized: managing inventory is reserved to the Owner or an Admin.'
      using errcode = 'insufficient_privilege';
  end if;
  return query
    select l.kind, l.record_id, l.order_id, l.ledger_id, l.label, l.state, l.blocks, l.reason
    from app_private.inventory_item_link_rows(p_item_id) l
    order by l.blocks desc, l.kind, l.label;
end;
$function$;

revoke all on function public.inventory_item_delete_links(uuid) from public, anon;
grant execute on function public.inventory_item_delete_links(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The Super Admin force delete.
-- ---------------------------------------------------------------------------
create or replace function public.delete_inventory_item_force(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_block text;
begin
  if app_private.current_staff_role() is distinct from 'owner' then
    raise exception 'Not authorized: force-deleting an inventory item is reserved to the Super Admin. No record was changed.';
  end if;

  -- Lock the item first. An order, hold, layaway or capture being created for it right now either
  -- commits before the check below (and blocks this delete) or waits for this transaction.
  perform 1 from public.inventory_items where id = p_item_id for update;
  if not found then
    raise exception 'Inventory item not found.';
  end if;

  select l.reason into v_block
  from app_private.inventory_item_link_rows(p_item_id) l
  where l.blocks
  limit 1;

  if v_block is not null then
    raise exception 'This item is still linked to a live order, layaway, payment, hold, or sale, so it cannot be deleted — those records are protected. (%)',
      v_block;
  end if;

  -- Only closed history remains. Remove it, then the item.
  delete from public.claim_evidence
    where claim_id in (select id from public.claims where inventory_item_id = p_item_id);
  delete from public.invoice_draft_claims
    where claim_id in (select id from public.claims where inventory_item_id = p_item_id);
  delete from public.print_attempts
    where label_job_id in (select lj.id from public.label_jobs lj
                            where lj.claim_id in (select id from public.claims
                                                   where inventory_item_id = p_item_id));
  delete from public.label_jobs
    where claim_id in (select id from public.claims where inventory_item_id = p_item_id);
  delete from public.price_overrides
    where claim_id in (select id from public.claims where inventory_item_id = p_item_id);
  delete from public.official_order_claims
    where claim_id in (select id from public.claims where inventory_item_id = p_item_id);
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
grant execute on function public.delete_inventory_item_force(uuid) to authenticated, service_role;
