# A.V. Jewelry System — working rules for Claude

Background reading: `docs/HANDOFF-CURRENT.md` (dated 2026-08-19; older than the code, so check facts
against the repository and the live systems before relying on them).

## Owner rules (always)

- **Fewest agents.** Use the minimum needed (small fix 1–2, feature 2–4, migration or security review 3–6,
  full audit at most 8). One coordinator, no two agents reading the same thing.
- **Nothing more, nothing less.** Only an explicit click makes the system print or ingest. Never add an
  automatic retry to printing or ingestion; fail loudly and let a person click again.
- **Evidence before editing:** root cause, files and objects involved, current vs expected behaviour, risks,
  rollback point. Then one bounded change per batch: implement, test, verify, commit.
- **Save point before risky work** (see "Database changes" below).
- **Report CODE / DB / DEPLOYED / PHYSICAL separately.** Never say "fixed" because tests pass. Mark progress
  with ✅ done, ❌ not yet, 🔄 in progress.
- **Secrets never enter the chat or the repo.** For a one-off local script, the Owner pastes the service-role
  key into the empty `SUPABASE_SERVICE_ROLE_KEY=` line of `.env.local`, and it is blanked again afterwards.
- **Screenshot-first messaging** (Settings → Messages) is switched on by the Owner only. Never enable it.
- **Parked items** stay parked until the Owner raises them.

## Where things are

| What        | Value                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| Web app     | Next.js 16 App Router, server actions; production <https://avjewelry.online>                          |
| Database    | Supabase project `eqfddwxsmzzojuasffjx` (Postgres 17, Pro plan, region ap-southeast-1)                |
| Hosting     | Vercel project `av-jewelry` (`prj_ggLMma7UEjGjlWE7m8LdtGOXqzzf`), team `avjewelry`                    |
| Branches    | Production is deployed from `feature/mineflow-pwa`; GitHub `kinggonzalesdev-sketch/av-jewelry-system` |
| Android app | `mobile/mineflow-capture` (builds with JDK 17; package id stays `com.mineflow.capture`)               |
| Backups     | Supabase daily backups, 7 days; see `docs/BACKUP-RESTORE-DRILL.md` §0                                 |

## Checks before every commit

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run verify` also runs `format:check`. About 96 files have known formatting drift (parked), so format
only the files you touch.

## Deploying to production

1. A GitHub push does **not** deploy.
2. Deploy either with the Vercel CLI signed in as `kinggonzalesavjewelry`
   (`npx vercel --prod --yes --scope avjewelry`; run `npx vercel whoami` first, because this PC's CLI has
   been signed in to a different account), or with the Vercel connector's `create_deployment`
   (`gitSource` = GitHub `kinggonzalesdev-sketch/av-jewelry-system`, branch and full commit SHA,
   `target` = production).
3. Verify, never assume: the deployment is READY, `avjewelry.online` is among its aliases, and the runtime
   logs show no new errors.
4. Instant rollback: promote the previous READY production deployment in Vercel.

## Database changes (production)

1. **Save point:** an in-database snapshot schema `savepoint_YYYYMMDD_<name>` (business tables, functions with
   their ACLs, policies, indexes, triggers), plus a restore guide in `backups/`.
2. **Live check:** confirm the functions a migration replaces still match what it was written against.
3. **Exact text:** stage the file's text in the database and compare its md5 with the file.
4. **Dry run:** run it inside a `DO` block that raises at the end, so everything rolls back. Test as real
   roles (`set local role authenticated` plus JWT claims).
5. **Apply one at a time** with `set local lock_timeout`. Record it in `supabase_migrations.schema_migrations`
   under the file's version, verify, then continue.
6. Never run `supabase db push`: older migrations were applied under different version numbers.
7. Every new `SECURITY DEFINER` function: `revoke all ... from public, anon`, then grant only what is needed.
   Role checks must refuse the `'inactive'` role sentinel.

## Gotchas

- The file writer can turn backslash-u escape sequences into raw characters. Keep backslashes out of generated
  scripts, or verify the bytes afterwards.
- Never put backticks inside a double-quoted `node -e "..."` in bash; bash runs them as commands.
- JavaScript `String.replace()` treats `$$` in the replacement as a single `$`.
- Grams live in the `item_code` text, not in `grams_per_piece`.
- Search matches only fields the user can see. Invoice Number and Order Number are retired from the UI.
- A local "Invalid credentials" error usually means the local Docker/Supabase stack is down.
