# Save point — 2026-08-24 · capture-reactivation

Restore point taken **after** the capture genuine-reply reactivation batch (Cases A/B), verified live
(King's `link_sent` capture flipped to `sent` / "AUTO SS Sent to Messenger ✓" via the server-side
reactivation).

## Identifiers
- **Git tag:** `savepoint-2026-08-24-capture-reactivation` (commit `7ed2664`)
- **In-DB snapshot schema:** `savepoint_20260824_reactivation`
- **Known-good prod deployment:** `av-jewelry-apcsdar2j` (aliases `avjewelry.online`, `www.avjewelry.online`, `av-jewelry.vercel.app`)
- **Verified:** live == snapshot — inventory 3713 / orders 1172 / customers 1205; 78 base tables +
  `_functions` 276 + `_policies` 162 + `_indexes` 233 + `_meta`. `message_templates` (incl. `auto_text`)
  and all new RPCs (`reset_capture_for_retry`, `resolve_exact_live_comment`, `claim_capture_photo_send`,
  `save_message_template`) captured.

## What this save point contains (since the prior point)
- **Case B (King):** genuine-reply reactivation. `isGenuineInboxDmEvent` no longer rejects a genuine
  Messenger INBOX reply that carries an EMPTY `data.post: {}` (only a POPULATED post/comment/reaction
  ref disqualifies; `message.type='INBOX'` is a positive signal). New
  `reactivatePhotoForConversationSystem` (webhook-triggered + cron fallback) re-checks media
  eligibility for the exact conversation and sends the actual screenshot PHOTO for the customer's
  waiting captures — idempotent (`claim_capture_photo_send`), exact-identity, server-side.
- **Case A (Ericka):** linked-without-a-customer-record now shows the resolved Facebook name (not
  "Facebook customer"); `reset_capture_for_retry` RPC + "⚠ AUTO TEXT not sent / 🔄 Retry Auto Text"
  finite state.
- **Issue 3:** manual Send independent of the reply wait (`canSend = chatLinked && !photoSent`).
- Migration: `reset_capture_for_retry`. (Earlier this session: mode-aware `auto_text` template +
  `add_auto_text_message_template`, `resolve_exact_live_comment_multi_fallback`,
  `capture_share_link_ciphertext_optional`.)

## Rollback — CODE (instant, no rebuild)
Re-promote the known-good production deployment (all aliases follow):
```bash
npx vercel promote av-jewelry-apcsdar2j --yes
```
Or check out the tag and redeploy:
```bash
git checkout savepoint-2026-08-24-capture-reactivation
npx vercel deploy --prod --yes
```

## Rollback — DATABASE (selective, manual — last resort)
`pg_dump` / Supabase CLI are NOT installed locally; the DB restore layer is the in-DB snapshot schema
`savepoint_20260824_reactivation` (business tables only — the append-only logs
`pancake_webhook_events`, `audit_events`, `capture_device_heartbeats` are intentionally EXCLUDED, so
they are never rolled back and never lose newer data).

To inspect a table's snapshot: `select * from savepoint_20260824_reactivation.public__<table>;`
To recover a function def: `select def from savepoint_20260824_reactivation._functions where name='<fn>';`

Restore a single table (example — verify first, this OVERWRITES live rows):
```sql
begin;
truncate public.<table>;
insert into public.<table> select * from savepoint_20260824_reactivation.public__<table>;
commit;
```
Prefer a **targeted** fix (re-apply the specific migration/RPC from `_functions`) over a wholesale
table restore, because live business data (orders/payments/inventory/customers) has advanced since the
snapshot and a blind restore would lose it.

## Off-site layer (Owner)
The in-DB snapshot dies with the project. The true off-site backup is **Supabase → Database →
Backups** (dashboard) — the Owner's responsibility.

## Cleanup
Drop the snapshot once this change is confirmed safe in production:
```sql
drop schema savepoint_20260824_reactivation cascade;
```
(Currently kept two-deep: `savepoint_20260821_pinclosed` + `savepoint_20260824_reactivation`.)
