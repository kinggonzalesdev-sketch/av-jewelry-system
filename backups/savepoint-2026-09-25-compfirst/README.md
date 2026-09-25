# Save point 2026-09-25 — before Computation First (migration 20260925120000)

Taken 2026-09-25, before applying `supabase/migrations/20260925120000_capture_computation_first_sequence.sql`
to production (Supabase `eqfddwxsmzzojuasffjx`). Settings → Messages was **Classic** at the time (the Owner
chose it at 16:51 PHT).

## What was saved (schema `savepoint_20260925_compfirst`)

| Table              | Contents                                                                  |
| ------------------ | ------------------------------------------------------------------------- |
| `_functions`       | the 12 functions the migration replaces: definition, md5 and ACL          |
| `_constraints`     | the two check constraints the migration widens, as they were              |
| `_config`          | `private_reply_sequence` and `text_send_attempts` (no tokens)             |
| `_capture_records` | copy of `capture_records` (89 rows, hash-verified against the live table) |
| `_meta`            | time taken, note, and `restore_sql`                                       |

The saved md5s match the "LIVE BODIES" list in the migration header. The six new functions
(`claim_capture_photo_leg`, `finalize_capture_photo_leg`, `park_capture_photo_leg`,
`set_capture_sequence_conversation`, `list_due_capture_photo_legs`, `list_waiting_capture_photos`) did not exist
before this migration.

## How it was applied

Staged text md5 `dc9784769f0152875feb8879c6efda93` (47,229 bytes) = the file. Dry run as the real roles (Owner,
non-owner staff, service_role, anon): 59/59 checks passed, rolled back, nothing left behind. Applied with a
5-second lock timeout and recorded in `supabase_migrations.schema_migrations` under `20260925120000`.

## Web rollback

Promote the previous READY production deployment in Vercel: `dpl_5168mYjF4wAC5c9eJaxJEHbCS9DS` (`a5a3373`).
Choose Classic or Screenshot First in Settings → Messages first. The old build never calls the new functions,
so the database can stay as it is.

## Database rollback (only if needed)

1. Settings → Messages: choose Classic or Screenshot First. Finish or dismiss any capture still on
   Computation First.
2. Run the saved script (as the Owner, in the Supabase SQL editor):

```sql
select restore_sql from savepoint_20260925_compfirst._meta;
```

It moves the setting off Computation First, drops the six new functions, re-creates the twelve replaced
functions exactly (with their grants), and removes the `schema_migrations` row. The new columns, the partial
index and the widened checks stay: they are unused by the old functions and harmless.
