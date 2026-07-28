# Handoff — current state (2026-07-18)

Read this first in a new session. Concise state so you can pick up cleanly.

## Branch & git

- **Branch:** `production-ui-integration` (all work here). **Nothing pushed, nothing merged.**
- `main` / `master` untouched. Commits are local only.
- The 16 "modified" files in `git status` with zero content diff are CRLF
  artifacts — ignore them; commit only files you actually change.

## How to run locally

1. **Docker Desktop must be running** (it has stopped on its own twice — if login
   shows "Invalid credentials", that's Docker being down, not the password).
   - Start Docker Desktop, wait ~1 min, then `npx supabase start`.
2. Dev server: it's launched via the Browser pane's `preview_start` (name
   `mineflow-dev`, port 3000), or `npx next dev`.
3. **Login:** http://localhost:3000 → `uat-owner@uat.local` / `UatPass123!`
   (Owner, sees everything). Other UAT accounts use the same password.
4. **Landing page** is public at `/` (no login).

### If a migration is added

- To preserve seeded data: `npx supabase migration up`.
- pgTAP tests assume a CLEAN db, so to run them: `npx supabase db reset` →
  `npx supabase test db` → then RE-SEED:
  `export UAT_PASSWORD='UatPass123!' && bash supabase/seed-uat-accounts.sh` then
  `docker exec -i <supabase_db_container> psql -U postgres -d postgres < supabase/seed-uat.sql`.

## Verify commands

`npm run format:check` · `npm run lint` · `npm run typecheck` · `npm run test`
(708 pass) · `npx supabase test db` (530 pgTAP pass) · `npx next build` (clean).

## What was done this stretch

**UI restoration (Owner-approved, on top of the existing Phase 0–11 app):**

- Renamed nav `Dashboard Report` → **Dashboard Profile** (change-control: SOT +
  lock tests updated first).
- **Brand switched to EMERALD GREEN** (`globals.css` tokens; the accent tokens
  keep the NAME `--gold`/`--gold-strong` but hold green — documented in SOT §3).
- **Dashboard Profile** restored to the prototype structure with REAL data: tabs
  (Dashboard · Disassembly Report · Gross Profit · Follow-ups · Reports · Search ·
  Reminders · Audit), date range, Refresh/Export, metric cards, Order Status +
  Sales-for-Period charts (visible at zero with "No data for this period"),
  Money-in-Transit section. Gross Profit + Disassembly Report are honest
  placeholders (no COGS / no disassembly model yet).
- **Orders**: 11 status cards (Total · For Invoice · For Reminder · For Prepare ·
  For Confirm · Ship Confirm · Keep · For Cancel · Cancelled · Unverified Payment ·
  For Layaway); search + Order Date / Ship Date / Hide Keep filters; the existing
  table preserved. **New Order** modal (real Manual Post-Live Entry → Pending
  Claim, real customers/items, photo, honest Reprint Last). Owner removed the
  New Entry / Invoice / Confirm / Layaway buttons (redundant with the sidebar).
- **Payments & Layaway**: New Layaway Entry (activates a real layaway; DB enforces
  verified-deposit ≥ 20%).
- Camera/photo attachments (private bucket + RLS) wired into Customers and the
  New Order item photo. Printer status is a clickable Web-Bluetooth "search"
  control, still honest (never fake "Ready").

**New feature modules (roadmap #1–#6), each with migration + RLS + pgTAP + tests:**

1. **Follow-up Queue** (Dashboard tab) + deposit-deadline flag — `4517627`
2. **Item custody** (on-hand vs financer, location, handler) — `aa883fa`
   (migration `20260717100000`)
3. **Money-in-Transit** (SQL sums) — `25bd087` (migration `20260717110000`)
4. **HR: Attendance & Payroll** — `66b4fcf` (migration `20260717120000`,
   `/admin/attendance`)
5. **Scrap income** — `77da454` (migration `20260717130000`, `/admin/scrap`)
6. **Public landing page** at `/` — `73c5908`
7. **Pancake/Facebook scaffolding** (honest "Not Connected"; Owner-only Test
   connection; needs `PANCAKE_API_URL`/`PANCAKE_API_KEY` server env) — `c574e9f`
   (`/admin/integrations`)

New admin pages are linked under **Settings → Administration** (nav stays locked
at 10 items).

## Honesty rules that MUST NOT regress

- Money is `numeric` in SQL, a **string** in TS — never a JS float. Sums happen in
  SQL functions (security invoker, RLS-scoped, revoke from `public`, grant
  `authenticated`).
- A failed read shows an explicit error, never a false ₱0 / empty.
- Cards/statuses with no real backing (Keep, For Cancel) show an honest **0**.
- Cancellation stays an Owner approval — deposit-overdue FLAGS, never auto-cancels.
- Pancake/printer are never faked as connected.
- `/preview` prototype stays 404 in production; it's the visual reference only.

## Blocked on the Owner (not code)

- **Pancake/Facebook** — needs a Pancake plan + API access (page token).
- **XP-236B printer** — needs the physical device (see `docs/PRINTER-HARDWARE-AUDIT.md`).

## Roadmap remaining (optional)

- ~~**#3 deeper**~~ **DONE (2026-07-21)** — migration `20260721110000`:
  rider-vs-LBC collection split, collected-vs-remitted, printable waybill at
  `/orders/fulfillment/[id]/waybill`. See SOT change log.
- ~~**#4 polish**~~ **DONE (2026-07-21)** — migration `20260721100000`:
  Owner-only hourly-rate editor on `/admin/attendance`. See SOT change log.

## Also added this stretch (2026-07-21)

- **Demo login buttons** on `/sign-in` for client demos. OFF by default; enable
  with `DEMO_LOGIN_ENABLED=true` + `DEMO_LOGIN_PASSWORD` (see `.env.example`).
  Signs into the real seeded UAT accounts; never enable on the live prod tenant.
- **New migrations:** `20260721100000_payroll_hourly_rate_editor`,
  `20260721110000_fulfillment_collection_remittance`. Both apply cleanly via
  `npx supabase migration up`.
- **Verify note:** JS gates all green (typecheck, lint on changed files, 720
  unit). pgTAP verified per-file against the seeded DB (25→11, 26→19, 28→9). A
  full `supabase db reset && test db && re-seed` was NOT run this session — a
  second `next dev` (another chat) held the DB/dev-server; run the clean-DB pgTAP
  sweep before merge. One pre-existing lint error in `integrations/page.tsx`
  (await-thenable) is unrelated and left for a separate task.

## Source of truth

`docs/FINAL-UI-SOURCE-OF-TRUTH.md` (has a Change log of every Owner decision).
Change-control order: Owner requests → update the doc → update lock tests → code.
