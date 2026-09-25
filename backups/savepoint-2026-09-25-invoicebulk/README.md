# Save point 2026-09-25 — before bulk Send Invoices (migration 20260925090000)

Taken 2026-09-25 02:25 UTC, before applying `supabase/migrations/20260925090000_invoice_bulk_send_and_reminders.sql`
to production (Supabase `eqfddwxsmzzojuasffjx`).

## What was saved (schema `savepoint_20260925_invoicebulk`)

| Table                | Contents                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `_functions`         | `public.record_order_reminder` definition + ACL (md5 `a2e3e102cd10e8e43b642b8f0ec17832`) |
| `_message_templates` | all 3 message templates (the `reminder_1` wording changes in this migration)             |
| `_customer_messages` | copy of `customer_messages` (0 rows at the time)                                         |
| `_order_reminders`   | copy of `order_reminders` (0 rows at the time)                                           |
| `_meta`              | time taken, row counts, note, and `restore_sql`                                          |

The three new functions (`claim_order_invoice_send`, `finalize_order_invoice_send`, `release_order_invoice_send`)
did not exist before this migration.

## Web rollback

Promote the previous READY production deployment in Vercel: `dpl_8VTTQPiZBwsr4yFDsdSfaZjtpfEw` (`576b7b5`).
The old build never calls the new functions, so the database can stay as it is.

## Database rollback (only if needed)

Run the saved script (as the Owner, in the Supabase SQL editor):

```sql
select restore_sql from savepoint_20260925_invoicebulk._meta;
```

It drops the three new functions, re-creates `record_order_reminder` from `_functions`, restores the
`reminder_1` template text from `_message_templates`, and removes the `schema_migrations` row. Invoices and
reminders recorded after go-live stay in `customer_messages` / `order_reminders`; compare with the copies
before deleting anything.
