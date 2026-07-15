-- ============================================================================
-- Phase 11 — Restore the audit privilege layer (Bible §31, §30.3 r19)
-- ----------------------------------------------------------------------------
-- Found by the Phase 11 security review sweep (stage 9), which is the first
-- test to check the grant posture across the WHOLE migration chain rather than
-- within the phase that set it.
--
-- WHAT HAPPENED
-- Phase 1 built audit append-only with three independent defences, and said so
-- (20260715120000_phase1_foundation.sql):
--
--     "append-only: UPDATE and DELETE are blocked by trigger AND by revoked grants"
--     revoke all on public.audit_events from anon, authenticated;
--
-- Phase 2 then had to grant table privileges back, because RLS is never
-- consulted on a table the caller cannot touch at all — without a grant,
-- Postgres refuses at the privilege layer and the policies never run
-- (20260715130100_phase2_rls_policies.sql):
--
--     grant select, insert, update on all tables in schema public to authenticated;
--     revoke delete on all tables in schema public from authenticated;
--
-- That blanket grant is correct and deliberate for the ~40 business tables it
-- targets. But `on all tables` swept up audit_events too, and re-granted the
-- UPDATE that Phase 1 had deliberately revoked. DELETE survived, because the
-- very next line revokes it globally. UPDATE did not.
--
-- WHAT THE IMPACT IS — deliberately stated in full, because the fix is small
-- and the temptation is to oversell the finding:
--
--   * NOT exploitable. Two defences still hold. audit_events has exactly two
--     policies (audit_read for select, audit_insert_self_attributed for insert)
--     and NO update policy, so RLS refuses every UPDATE. The
--     audit_events_no_update trigger refuses as well.
--   * What was lost is the THIRD layer, and the accuracy of Phase 1's comment.
--     Defence in depth is the point of an append-only audit: it is the record
--     that proves what everything else did, so it is the one table where "two
--     layers still hold" is not a reason to leave the third one broken.
--
-- THE FIX
-- Re-revoke UPDATE on audit_events alone. Phase 2's blanket grant is left
-- untouched — the other tables genuinely need it, and rewriting a shipped
-- migration would be the more dangerous change.
--
-- Nothing legitimate regresses: no policy permits UPDATE, no trigger updates
-- this table (audit_events carries only no_update/no_delete triggers, never
-- set_updated_at), and src/lib/audit/log.ts only ever inserts. The write path
-- is INSERT-only by design.
--
-- Locked by supabase/tests/16_phase11_security_review.test.sql, which asserts
-- the privilege posture at both layers so a future `on all tables` grant fails
-- a test instead of quietly eroding the audit again.
-- ============================================================================

revoke update on public.audit_events from authenticated;

-- anon holds nothing anywhere; restated here so the audit table's posture is
-- readable in one place rather than inferred from three migrations.
revoke all on public.audit_events from anon;

comment on table public.audit_events is
  'Append-only (Bible §31). Defended three ways: no UPDATE/DELETE privilege for authenticated, no UPDATE/DELETE policy, and the audit_events_no_update / audit_events_no_delete triggers. Phase 11 restored the privilege layer after a Phase 2 blanket grant re-granted UPDATE.';
