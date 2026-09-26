# Save point 2026-09-26 — before the Inventory delete links (migration 20260926120000)

Taken 2026-09-26, before `supabase/migrations/20260926120000_inventory_delete_links.sql` was applied to
production (Supabase `eqfddwxsmzzojuasffjx`).

## Code

- Annotated tag `mineflow-known-good-before-inventory-delete-links` = `71d3f43` (pushed). That commit is the
  live web code `e880d2f` plus the Android app version bump only.
- Live web at the time: `dpl_G1uTE3VfYjN2H6Sg8UCsV7Qui7n8` (`e880d2f`), aliased to avjewelry.online.

## Database (schema `savepoint_20260926_deletelinks`, owner-only)

| Table        | Contents                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `_functions` | `delete_inventory_item_force` (md5 `db3d1532…`), `inventory_item_dependencies`, `delete_inventory_item_direct`: definition, md5, ACL |
| 21 copies    | every table a force delete touches, plus orders, payments and layaway (see `_counts`)                                                |
| `_counts`    | live vs copy row count and md5 of every copied table — all 21 matched when taken                                                     |
| `_meta`      | time taken, note, `restore_sql`                                                                                                      |

Copied tables: `inventory_items` (5,932), `claims` (3,896), `official_order_claims` (3,879), `official_orders`
(2,903), `payments` (750), `layaway_ledger` (833), `layaway_ledger_items` (137), `returned_to_stock_reviews`
(527), `capture_records` (85), and the empty `claim_evidence`, `invoice_draft_claims`, `label_jobs`,
`price_overrides`, `miner_positions`, `waitlist_entries`, `inventory_reservations`, `live_batch_items`,
`capture_review_queue`, `item_photos`; added after the code review: `print_attempts` (0) and
`layaway_ledger_payments` (978).

## Web rollback

Promote `dpl_G1uTE3VfYjN2H6Sg8UCsV7Qui7n8` in Vercel. The old build never calls the new list function, and
its force delete calls the same `delete_inventory_item_force`, which then applies the new rules — so the
database can stay as it is.

## Database rollback (only if needed)

Run as the Owner in the Supabase SQL editor:

```sql
select restore_sql from savepoint_20260926_deletelinks._meta;
```

and execute the text it returns. It drops the two new functions, re-creates the old
`delete_inventory_item_force` exactly from the saved definition (with its grants), and removes the
`schema_migrations` row.

## Restoring an item that was force-deleted by mistake

The copies hold every row as it was at the save point. Re-insert in parent-to-child order, for one item id
`:id` (replace it):

```sql
insert into public.inventory_items select * from savepoint_20260926_deletelinks.inventory_items where id = :id;
insert into public.claims select * from savepoint_20260926_deletelinks.claims where inventory_item_id = :id;
insert into public.official_order_claims select * from savepoint_20260926_deletelinks.official_order_claims
  where claim_id in (select id from savepoint_20260926_deletelinks.claims where inventory_item_id = :id);
insert into public.inventory_reservations select * from savepoint_20260926_deletelinks.inventory_reservations where inventory_item_id = :id;
insert into public.returned_to_stock_reviews select * from savepoint_20260926_deletelinks.returned_to_stock_reviews where inventory_item_id = :id;
```

`capture_records.idempotency_key` is a generated column, so a capture row is restored by naming every other
column (`insert into public.capture_records (id, device_installation_id, capture_id, …) select id,
device_installation_id, capture_id, … from savepoint_20260926_deletelinks.capture_records where
inventory_item_id = :id`).

Only items that existed at the save point can be restored this way. The audit event
`inventory_item.force_delete` records, for every force delete, which closed records it removed
(`removed_history`: kind, state, record id, order id).
