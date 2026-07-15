# Phase 2 — Authentication & Permissions Foundation

> **Status:** Phase 2 complete on `phase-2-auth-permissions`. **Not merged. Not production-ready.**
>
> Authorization is now enforced. Business workflows still do not exist — that is
> Phase 3 onward.

**Source of truth:** `Development-Bible.md` (§1–36, APPROVED). Where this document
and the Bible disagree, the Bible governs.

---

## The three rules everything here serves

1. **Role title is not authority.** A role grants nothing. There is deliberately no
   role→permission map anywhere in the codebase, and a test asserts its absence.
2. **Assignment is not permission.** Scope narrows access; it never grants it.
3. **UI visibility is not authorization.** Hiding a button is a convenience. Every
   protected action is checked server-side _and_ by RLS.

The sharpest proof: the Owner is the highest authority, yet **an Owner with no
grants cannot capture a claim**. A Selected Admin holding _every_ permission
**still cannot approve an Owner-only action**. Both are tested.

---

## Permission catalog — the approved 23

The 20 reconciled permissions, plus three named directly in Bible §22:

| Permission                      | Governs                                               |
| ------------------------------- | ----------------------------------------------------- |
| `claim_capture`                 | Capture claims                                        |
| `claim_review`                  | Review, correct, withdraw claims                      |
| `confirm_claim_print_label`     | Confirm a claim — **reserves inventory exactly once** |
| `invoice_preparation`           | Build drafts; Approve & Send Invoice                  |
| `payment_verification`          | Verify payment evidence                               |
| `layaway_monitoring`            | Monitor layaway                                       |
| `fulfillment_preparation`       | Prepare for shipping/pickup                           |
| `fulfillment_release`           | Normal release                                        |
| `existing_record_entry`         | Migration / historical entry                          |
| `live_batch_operation`          | Create/start/pause/end batches                        |
| `live_batch_closure`            | Close a batch                                         |
| `current_flex_item_control`     | Set/switch Current Flex Item                          |
| `item_withdrawal`               | Withdraw an item                                      |
| `post_live_item_entry`          | Post-live item entry                                  |
| `message_preparation`           | Prepare messages                                      |
| `message_sending`               | Send / attest sending                                 |
| `retry_reprint_label`           | Retry or reprint a label                              |
| `void_cancel_label_job`         | Void or cancel a label job                            |
| `export_data_reports`           | Export data and reports                               |
| `payment_correction`            | Correct payments                                      |
| **`inventory_monitoring`**      | Returned-to-Stock Review outcomes (§22.5, §22.15)     |
| **`miner_allocation_review`**   | Miner allocation review (§22.5, §22.6)                |
| **`initiate_high_risk_action`** | **Create** an Owner Approval Request (§22.14)         |

**No permission grants another.** `claim_capture` does not imply `claim_review`;
`claim_review` does not imply `confirm_claim_print_label`. Tested.

**`initiate_high_risk_action` is request-only** (`permissions.is_request_only = true`):
creating a request **executes nothing**.

Default grants and production assignments remain a decision for whoever provisions
real accounts. Nothing is granted by default — a new account holds **zero**
permissions.

### Role vs permission

|                           | Owner    | Selected Admin | Staff    |
| ------------------------- | -------- | -------------- | -------- |
| Max accounts              | —        | **2 active**   | —        |
| Automatic permissions     | **none** | **none**       | **none** |
| Six Owner approvals       | ✅ only  | ❌ never       | ❌ never |
| Manage staff/roles/grants | ✅ only  | ❌             | ❌       |

The Owner role confers exactly one thing: authority over the six non-delegable
approvals, and staff management. It confers **no operational permission**.

---

## Authorization helpers (database)

All in `app_private`, all `SECURITY DEFINER`, all `search_path = ''`.

| Function                         | Answers                                             |
| -------------------------------- | --------------------------------------------------- |
| `current_staff_id()`             | Which staff profile is acting (from `auth.uid()`)   |
| `current_staff_role()`           | Role **title** only                                 |
| `is_active_staff()`              | Authenticated **and** active                        |
| `has_permission(key)`            | Is there an **explicit grant**? (ignores role)      |
| `has_scope(scope_id)`            | Does the caller hold this scope?                    |
| `is_owner()`                     | Active Owner?                                       |
| `can_decide_owner_only_action()` | Owner-only approval authority                       |
| `current_auth_aal()`             | `aal1` / `aal2` (defaults to `aal1` — fails closed) |
| `owner_mfa_ready()`              | Have all active Owners enrolled TOTP?               |

### Why `SECURITY DEFINER` is necessary and safe

Phase 1 forced RLS on `staff_profiles` and `staff_permission_grants`. A policy on
`claims` asking "does this caller hold `claim_review`?" cannot read those tables as
the calling user — their own RLS denies it, and recursive evaluation would loop.

Each helper is safe because it:

- pins `search_path = ''`, closing the object-shadowing escalation path;
- takes identity from `auth.uid()` **only** — never a caller-supplied actor id;
- answers one narrow question and **grants nothing**;
- fails closed (returns false/null rather than raising).

None is in the `public` schema, so **none is callable over the API**. Tested.

---

## RLS policies

Every table keeps RLS **enabled and forced**. Phase 1's deny-by-default became
permission-aware policies.

Shape of every policy:

- **anon gets nothing.** No policy names `anon`; privileges stay revoked. Tested.
- **Reads** require `is_active_staff()`.
- **Writes** require an **explicit permission**, never a role.
- **Owner-only** paths use `is_owner()` / `can_decide_owner_only_action()`.
- **Scope** narrows where a record carries one.
- **DELETE is revoked from `authenticated` entirely** — records are withdrawn or
  deactivated, never destroyed (attribution must survive).

Explicitly **not** created: `authenticated can read all`, `authenticated can write
all`, `role = admin ⇒ all permissions`, `assigned user ⇒ permission`. A test fails
the build if any policy uses `using (true)` or `with check (true)`.

### An important consequence

`authenticated` now holds table privileges — a **prerequisite** for RLS to be
consulted at all. Without the GRANT, Postgres refuses at the privilege layer and
RLS never runs. So a merely-authenticated non-staff caller now reads **zero rows**
rather than getting a permission error. Both outcomes are safe; the mechanism
changed, and the tests were updated to assert the row count rather than an error.

### Notable read restrictions

- `staff_profiles`: you read **your own** profile. Only the Owner reads others —
  an ordinary account cannot enumerate the roster.
- `audit_events`: insert-only, and `actor_auth_uid` must equal `auth.uid()`. **You
  cannot forge an audit entry attributed to someone else.** Tested.
- `notifications`: your own only.

---

## Server-side authorization

`src/lib/authz/guard.ts` — every one re-checks at **execution** time:

| Guard                             | Behaviour                                       |
| --------------------------------- | ----------------------------------------------- |
| `requireAuthenticatedStaff()`     | Session or redirect to `/sign-in`               |
| `requireActiveStaff()`            | Active staff or redirect to `/account-disabled` |
| `requirePermission(key)`          | Explicit grant or **throw**                     |
| `requireScope(id)`                | Scope held or **throw**                         |
| `requireOwner()`                  | Owner or **throw**                              |
| `requireOwnerApprovalAuthority()` | Owner or **throw** (never permission-based)     |
| `requireAal2()`                   | Elevated session or **throw**                   |

`requirePermission` **throws** rather than redirecting: a denied action must not
silently become a navigation, and the write must not run. `getGrantedPermissions()`
**fails closed** — an unreadable grant list yields an empty set, never all.

Server checks and RLS **agree by construction**: both read the same grants. The
server layer gives clear errors; RLS guarantees a bug in the server layer cannot
expose data.

---

## Account management (Owner-only)

`src/lib/authz/account-management.ts`: grant/revoke permissions, activate/deactivate,
promote/demote Selected Admin, assign/remove scope, list accounts.

- **Deactivation is not deletion.** The row, grants, and audit trail survive; a
  trigger revokes the account's trusted devices. Attribution is permanent.
- **Max two Selected Admins**, enforced atomically by a database trigger under an
  exclusive lock — a concurrent double-promotion cannot slip through. The
  application surfaces that rejection rather than re-implementing the rule.
- **Only the Owner** may promote/demote, enforced by RLS **and** a trigger.
- An Owner cannot deactivate their own account.

### Account creation — NOT implemented

Creating an account needs the Supabase Admin API and the **service-role key**,
which is deliberately unwired (ADR §11) and has no caller. It is the one path that
mints credentials, so it belongs with the phase that owns provisioning and its
audit trail. Create development accounts directly in your local Supabase project.

---

## Password policy

- **Minimum 12 characters**, enforced wherever a password is **set**.
- **Not** applied at sign-in — doing so would tell a user with an older password
  that it is "invalid" rather than wrong, leaking policy state and blocking reset.
- **No public registration. No customer login.** No `signUp` call exists anywhere.
- Passwords are handled entirely by Supabase Auth. **No plaintext, no recoverable
  passwords, no custom hashing** — a test scans the whole codebase for hashing
  primitives.
- Reset goes to the staff member's verified email via Supabase Auth.

---

## Session & device status

| Target                 | Value   | Enforced?           |
| ---------------------- | ------- | ------------------- |
| Idle timeout           | 8 hours | ❌ **Not enforced** |
| Max session            | 7 days  | ❌ **Not enforced** |
| Owner devices          | 2       | ⚠️ Registry only    |
| Selected Admin devices | 2       | ⚠️ Registry only    |
| Staff devices          | 1       | ⚠️ Registry only    |

### `role_device_limits.enforcement_implemented` stays **FALSE**

**What works and is tested:** the device registry caps active devices per role
atomically (a Staff member cannot register a second device; an Owner cannot register
a third). Revocation frees a slot and **retains the revoked row**. Deactivating an
account revokes all its devices.

**Why the flag is still false — the exact limitation:** Supabase (GoTrue) issues and
validates sessions independently of this table. A JWT already minted stays valid
until it expires, whether or not its device row is revoked, and **RLS cannot see a
device fingerprint** (it is not a JWT claim). So the registry constrains what the
_application_ accepts; it cannot revoke a provider session. Idle and maximum session
durations are GoTrue settings that this project does not yet configure or verify.

**Therefore: the concurrent-device limits are NOT fully enforced, and this document
does not claim they are.** Closing the gap requires either provider-level session
control (admin sign-out on revocation) or a device claim in the JWT.

---

## MFA status

**Approved method: Supabase TOTP (authenticator app).** No SMS, WhatsApp, or email
MFA exists — tested.

**Implemented and tested:** enrollment (`enrollTotp`), challenge + verification
(`verifyTotp`), cancellation of incomplete enrollment (`cancelTotpEnrollment`),
status reporting (`getMfaStatus`), aal1/aal2 detection server-side and in the
database (defaults to `aal1` — **fails closed**), `requireAal2()` as a working
enforcement primitive, and Owner readiness (`owner_mfa_ready()`).

### `MFA_ENFORCEMENT_IMPLEMENTED` stays **FALSE**

**MFA is not required of anyone.** An Owner without an enrolled factor can still
sign in and exercise Owner authority. Requiring it now would make initial setup
impossible — an Owner cannot enroll if they cannot first sign in and reach the
enrollment screen. And **no action currently calls `requireAal2()`**: deciding which
actions demand elevation is an open business decision.

Flip the flag **only** in the same commit as real enforcement plus tests. A test
asserts it is false, so a premature flip fails the suite. That is deliberate.

**Owner MFA is required before pilot and production.** `owner_mfa_ready()` reports
that state; it does not gate development.

### Recovery

Supabase exposes **no recovery-code API** for TOTP factors, and none is invented
here. The approved process:

- the **Owner stores recovery material offline**;
- lost-device recovery follows a **controlled Owner-account recovery process** — a
  documented human procedure, not code;
- **Staff and Selected Admin cannot reset Owner MFA.** Nothing in the codebase
  permits it: MFA factors belong to the auth user, and no admin path exists.

---

## UI added

Minimal, only to exercise the boundaries: `/account-disabled`, `/admin/staff`
(Owner-only, real data), `/security` (real MFA state), plus Owner-only header
navigation. **No operational business UI. No fake staff or metrics.**

---

## Testing

```bash
npx supabase start && npx supabase db reset   # apply all migrations
npx supabase test db                          # 146 pgTAP assertions
npm test                                      # 94 unit tests
npm run verify                                # format, lint, typecheck, test, build
```

**146 database assertions** (80 Phase 1 + 66 Phase 2) run as **real impersonated
JWT users**, never via the service role. **94 unit tests.**

Phase 2 proves: anonymous denied · inactive staff denied even holding a grant ·
role title grants nothing · a grant permits only its named action · revocation is
immediate · Owner-only rejects a fully-granted Selected Admin · max-two Selected
Admins · audit actor cannot be forged · audit immutable · device limits · aal1/aal2
· readiness reporting.

---

## Known limitations

1. **Session idle (8h) / max (7d) are NOT enforced** — GoTrue settings, unconfigured.
2. **Concurrent-device limits are NOT fully enforced** — see above.
3. **MFA is NOT required** — see above.
4. **Account creation is not implemented.**
5. **`enforce_owner_only_admin_management` skips when `auth.uid()` is null**, so
   migrations and admin tooling can bootstrap. It protects against a mis-wired
   application, **not** against a holder of the service-role key.
6. **A Phase 1 bug was found and corrected forward** (`20260715130300`):
   `enforce_reservation_rules` and `enforce_selected_admin_limit` were
   `SECURITY INVOKER`, so under Phase 2's RLS their `SELECT … FOR UPDATE` and counts
   read a _filtered_ view. Confirming a claim would have failed with a misleading
   "item does not exist". Both are now `SECURITY DEFINER` with pinned `search_path`.
7. **Status-transition sequences are still not fully enforced** — the critical
   invariants are; a full §22 state machine belongs to the workflow phases.
8. **Not production-ready.**

---

## Readiness for Phase 3

Before operational workflows begin:

- **Decide default permission grants** per role for real provisioning.
- **Decide which actions require aal2**, then implement enforcement and flip the flag.
- **Resolve the device/session gap** (provider sign-out on revocation, or a JWT
  device claim) — or accept and record it.
- **Wire account provisioning** with its invitation flow and audit trail.
- Bible §22.19 still lists **"Section 4–5 permission reconciliation"** as open; the
  23-permission catalog is confirmed structurally but rests on a reconciliation the
  Bible has not closed.

Phase 3 can now build on `requirePermission()` and permission-aware RLS. Every new
business table must add its policies in the same migration that creates it, and
every sensitive write must re-check at execution time.
