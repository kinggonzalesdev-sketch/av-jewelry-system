# Phase 11 — Production Readiness Checklist & Sign-Off Gate

**Bible refs:** §34.6 (readiness categories), §35 (deployment), §36 (release
criteria), §30.20 (security readiness), §32 (recovery) · **Roadmap:** Phase 11

**Current readiness: `Internal Test Ready`.**
**`Pilot Ready` is not claimed. `Production Ready` is not claimable by any
session.**

---

## 1. The gate, quoted rather than paraphrased

§34.6 — **Production Ready must NOT be declared while:**

> critical tests fail · real-device testing is incomplete · backup/restore is
> untested · security blockers remain · core permissions fail · duplicate
> prevention fails · the required pilot is incomplete

Three of those seven are currently true. They are true for reasons no code
change resolves.

| Blocker                            | State                                               | Resolvable by code?           |
| ---------------------------------- | --------------------------------------------------- | ----------------------------- |
| Critical tests fail                | ✅ clear — 463 unit/integration + 370 database pass | —                             |
| **Real-device testing incomplete** | ❌ **blocks** — no XP-236B, no Android/iOS devices  | **No.** Hardware.             |
| **Backup/restore untested**        | ❌ **blocks** — needs the Owner's real project      | **No.** Infrastructure.       |
| Security blockers remain           | ✅ clear — one S3 found and fixed (test plan §5)    | —                             |
| Core permissions fail              | ✅ clear — Owner/Selected Admin/Staff proven        | —                             |
| Duplicate prevention fails         | ✅ clear — confirm and send double-submit proven    | —                             |
| **Pilot incomplete**               | ❌ **blocks** — not started                         | **No.** Owner + real selling. |

---

## 2. What is verified today

Everything below was executed on this branch against a fresh database.

### 2.1 Integrity (§34.6 "duplicate prevention", invariants #3, #5)

- [x] Reserve exactly once at Confirm — proven on a **multi-stock** item, so the
      quantity guard cannot mask `UNIQUE(claim_id)`
- [x] Double-tap Confirm → one reservation, one label job, one deduction
- [x] Repeated Approve & Send → one Official Order, same order/invoice number
- [x] Official Order commits the reservation with **no second deduction**
- [x] Order/invoice numbers allocated by the database, never the application

### 2.2 Authorization (§30, invariants #1, #2)

- [x] Authorization enforced at the trusted boundary, re-checked at execution
- [x] UI hiding is not the control — RPCs called directly refuse identically
- [x] Role title grants nothing; the Owner holds no implicit operational rights
- [x] No permission silently includes another (`claim_capture` ≠ confirm)
- [x] A refused write changes **no** record (§30.3 r18)
- [x] RLS enabled **and FORCED** on every table after all 21 migrations
- [x] No wildcard policy; nothing granted to `anon` or `PUBLIC`
- [x] Every SECURITY DEFINER function pins `search_path`
- [x] Deactivated users lose authority; grants and history survive

### 2.3 Audit (§31, invariant #9)

- [x] Append-only at **all three** layers — privilege, policy, trigger
      (restored; test plan §5)
- [x] Attribution is a snapshot — renaming a departed account cannot rewrite
      history
- [x] Denials and failures are logged, not only successes

### 2.4 Migration (§34.3 stage 16)

- [x] 21 migrations apply cleanly to a fresh database, in order
- [x] Migrated records stay separate from live intake

### 2.5 Manual fallback (§34.2 r13, §35 r10–11)

- [x] Every conditional capability ships **off** and cannot be enabled without a
      passing real-device validation
- [x] Every capability names its manual fallback
- [x] Disabling is never gated — retreating to manual always works

---

## 3. Owner checklist — required before pilot

Nothing here is a code task. Each is a §34.9 or §35.18 open item.

- [ ] **Name the sign-off authority** (§34.9) — who declares Production Ready
- [ ] **Name UAT participants** (§34.9) — Owner, up to 2 Selected Admins, Staff
- [ ] **Run Staff UAT** — `docs/PHASE-11-UAT-SCENARIOS.md`; UAT-12 is decisive
- [ ] **Set pilot duration and transaction volume** (§34.9)
- [ ] **Confirm Supabase plan** — Pro **before** real customer/order/payment
      data (§35.14)
- [ ] **Confirm Vercel plan** — paid before production use (§35.14); verify
      prices fresh at purchase (§35.14)
- [ ] **Domain** (§35.18)
- [ ] **Backup schedule + a real restore drill** (§35.18) — a backup that has
      never been restored is a hope. This is a hard §34.6 blocker.
- [ ] **Monitoring and alerts baseline** (§35.18)
- [ ] **Name the support owner** (§35.18)
- [ ] **Incident-response contacts** (§30.17)
- [ ] **Decide external penetration testing** (§34.9) — in or out of scope
- [ ] **Confirm environment separation** — production credentials never in
      test; test data never in production (§30.3 r16, §34.2 r17)
- [ ] **Answer the §30.23 security items** — session timeout, concurrent-session
      limits, login-attempt thresholds, recovery process, Owner emergency access

---

## 4. Pilot gate (§34.3 stage 18, §36)

The pilot is a **bounded real operation**, not a demo.

- [ ] Bounded: one live batch, agreed volume, agreed duration
- [ ] Real staff, real customers, real money
- [ ] Runs on the **manual fallback path** — every conditional capability off
- [ ] Every S1/S2 recorded and triaged before extending
- [ ] Rollback decided **in advance**: what happens if it goes wrong mid-live
- [ ] Backup verified restorable **before** the first real order

**Pilot passes when:** it completes at the agreed volume with no S1, and the
staff would choose to use it again tomorrow.

---

## 5. Post-deploy (§34.3 stage 20)

- [ ] Smoke-test the critical path in production: capture → confirm → invoice →
      order → payment → release
- [ ] Confirm no test data reached production
- [ ] Confirm monitoring fires
- [ ] Confirm the audit records the smoke test itself

---

## 6. Standing caution

The system's core value is that it refuses to do the wrong thing quietly. Every
guard here exists because something in §28–§32 said it must. **The Phase 11
security review found one that had already been eroded silently, by a phase that
was not thinking about it** (test plan §5). That is the failure mode to watch:
not a dramatic bug, but a later change that widens a rule without anything going
red.

When adding a phase, ask what it _widens_, not only what it adds. Prefer a new
migration over editing a shipped one. Grant to a named table, never `on all
tables`.
