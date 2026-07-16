-- ============================================================================
-- Fix: three more tables whose RLS policies could never run (Bible §30.3 r1-r4)
-- ----------------------------------------------------------------------------
-- Same root cause as 20260716210000. Phase 2's re-grant —
--
--   grant select, insert, update on all tables in schema public to authenticated;
--
-- is migration 20260715130100. `on all tables` is a POINT-IN-TIME snapshot, not
-- a standing rule, so every table created afterwards kept the Phase 1
-- deny-by-default posture and got nothing back. Each of the tables below then
-- had permission-aware policies written FOR `authenticated` that have never once
-- been consulted: RLS is never reached on a table the caller cannot touch.
--
-- The privilege is the GATE; the policy is the CONTROL. These tables had a
-- control and no gate, which fails closed — nothing leaked — but it also means
-- the screens that depend on them are quietly broken.
--
-- THE AUDIT — each grant matches that table's OWN policy set exactly. This is
-- deliberately NOT another blanket grant; a blanket grant is what caused the
-- problem twice already, in both directions.
--
--   claim_evidence            policies: read / insert / update  -> select, insert, update
--     Read by src/lib/claims/review.ts (evidence count on Claim Review) and
--     written by src/lib/claims/capture.ts. Without SELECT the review screen
--     reports "0 evidence" for a claim that has some — a silent wrong answer.
--
--   conditional_capabilities  policies: read / update           -> select, update
--     Read by src/lib/capabilities/service.ts and updated when the Owner
--     enables a validated capability. NO INSERT: the five capabilities are an
--     approved catalog seeded by migration. The application must not be able to
--     invent a sixth capability at runtime.
--
--   capability_validations    policies: read / insert           -> select, insert
--     Read and appended by src/lib/capabilities/service.ts. NO UPDATE, and that
--     is the point: a validation record is EVIDENCE that a real device was
--     tested (§34.2 r14). Evidence that can be edited is not evidence — a failed
--     result must never be rewritten into a passing one to unlock a capability.
--
-- Nothing here is granted DELETE. Nothing here is granted to anon. RLS stays
-- ENABLED and FORCED on all three, and every policy condition is unchanged — a
-- caller still needs an active staff account, and the Owner-only rules still
-- apply. This restores the gate, not the control.
--
-- Locked by supabase/tests/18_policies_without_privileges.test.sql, which
-- asserts the privilege AND the policy for each table as a real Staff JWT, and
-- asserts the absences (no delete, no anon, no capability INSERT, no validation
-- UPDATE) so a future blanket grant cannot quietly widen them.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- claim_evidence — read on Claim Review, written at capture.
-- ---------------------------------------------------------------------------
grant select, insert, update on public.claim_evidence to authenticated;
revoke delete on public.claim_evidence from authenticated;
revoke all on public.claim_evidence from anon;

-- ---------------------------------------------------------------------------
-- conditional_capabilities — an APPROVED CATALOG. Readable and switchable,
-- never extendable at runtime.
-- ---------------------------------------------------------------------------
grant select, update on public.conditional_capabilities to authenticated;
revoke insert, delete on public.conditional_capabilities from authenticated;
revoke all on public.conditional_capabilities from anon;

-- ---------------------------------------------------------------------------
-- capability_validations — APPEND-ONLY EVIDENCE. A recorded real-device result
-- may be added and read, never edited or removed.
-- ---------------------------------------------------------------------------
grant select, insert on public.capability_validations to authenticated;
revoke update, delete on public.capability_validations from authenticated;
revoke all on public.capability_validations from anon;

comment on table public.capability_validations is
  'Append-only evidence that a conditional capability was tested against real hardware (Bible §34.2 r14). authenticated may INSERT and SELECT only: UPDATE and DELETE are revoked so a failed validation can never be rewritten into a passing one to unlock a capability.';

comment on table public.conditional_capabilities is
  'The approved catalog of conditional capabilities. authenticated may SELECT and UPDATE (to enable a validated capability) but never INSERT: the catalog is seeded by migration and the application cannot invent a new capability at runtime.';
