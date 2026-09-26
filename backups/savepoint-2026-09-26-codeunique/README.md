# Save point 2026-09-26 — before complete-code inventory uniqueness (migration 20260926110000)

Taken 2026-09-26, right before `supabase/migrations/20260926110000_inventory_full_code_uniqueness.sql` was
applied to production (Supabase `eqfddwxsmzzojuasffjx`).

## Code

- Annotated tag `mineflow-known-good-before-code-uniqueness` = `b05327a` (pushed) — the live web code then.
- Live web at the time: `dpl_GwiaYWUnt1hBDkAwrqhVHBoRkWjS` (`b05327a`), aliased to avjewelry.online.

## Database (schema `savepoint_20260926_codeunique`, owner-only)

| Table             | Contents                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `_functions`      | `enforce_unique_inventory_code_number` (md5 `dd8303ce…`), `inventory_code_number`, `inventory_code_canonical` |
| `_triggers`       | the 6 triggers on `inventory_items`, as they were                                                             |
| `_indexes`        | the 11 indexes on `inventory_items`, as they were                                                             |
| `inventory_items` | copy of all 5,934 rows (count and md5 matched the live table — see `_counts`)                                 |
| `_meta`           | time taken, note, `restore_sql`                                                                               |

The migration changes no inventory row: it drops the numeric trigger, adds `app_private.inventory_code_key`,
the trigger `inventory_items_unique_code_key` and the unique index `inventory_items_code_key_uidx`.

## Rollback

1. Web: promote `dpl_GwiaYWUnt1hBDkAwrqhVHBoRkWjS` in Vercel.
2. Database (only if needed), as the Owner in the Supabase SQL editor:

```sql
select restore_sql from savepoint_20260926_codeunique._meta;
```

Execute the text it returns: it drops the new index, trigger and functions, re-creates the numeric trigger
on its unchanged function, and removes the `schema_migrations` row. Items created meanwhile with a number
another prefix already uses stay as they are — the numeric trigger only checks new codes.
