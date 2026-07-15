-- ============================================================================
-- Phase 10 — Conditional Capability Gating (Bible §27, §14, §13, §26)
-- ============================================================================
begin;
select plan(14);

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users (id, instance_id, email, aud, role)
values ('aaaa0000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
        'phase10-owner@test.local', 'authenticated', 'authenticated'),
       ('aaaa0000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000',
        'phase10-staff@test.local', 'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key)
values ('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaa0000-0000-0000-0000-0000000000a1',
        'Phase10 Owner', 'owner'),
       ('aaaaaaaa-0000-0000-0000-0000000000a2', 'aaaa0000-0000-0000-0000-0000000000a2',
        'Phase10 Staff', 'staff');

-- ============================================================================
-- RULE: every conditional capability ships OFF (ADR §7 item 7, roadmap P10)
-- ============================================================================
select is(
  (select count(*)::int from public.conditional_capabilities where is_enabled),
  0,
  'Every conditional capability ships DISABLED — nothing has been validated'
);

select is(
  (select count(*)::int from public.conditional_capabilities),
  5,
  'All five conditional capabilities are registered'
);

select is(
  (select is_enabled from public.conditional_capabilities
    where key = 'printer_xp236b_bluetooth'),
  false,
  'The XP-236B printer is off — the Bible treats it as unverified until tested'
);

-- ============================================================================
-- RULE: no readiness without a PASSING real-device validation (exit gate)
-- ============================================================================
select is(
  (select count(*)::int from public.capability_validations),
  0,
  'No capability has ever been validated against real hardware'
);

select throws_ok(
  $$update public.conditional_capabilities
      set is_enabled = true,
          validated_at = now(),
          validated_by = 'aaaaaaaa-0000-0000-0000-0000000000a1'
      where key = 'printer_xp236b_bluetooth'$$,
  '23514',
  null,
  'A capability cannot be enabled without a PASSING validation — a rubber-stamped timestamp is not evidence'
);

-- The check constraint blocks the cruder attempt too: enabling with no
-- validation attribution at all.
select throws_ok(
  $$update public.conditional_capabilities set is_enabled = true
      where key = 'pancake_adapter'$$,
  '23514',
  null,
  'A capability cannot be enabled with no validation attribution at all'
);

-- A FAILED validation is not a passing one.
insert into public.capability_validations
  (capability_key, device_or_vendor, outcome, evidence_note, tested_by)
values ('printer_xp236b_bluetooth', 'Xprinter XP-236B (bench unit)', 'failed',
        'Pairing succeeded but the print job never reached the device.',
        'aaaaaaaa-0000-0000-0000-0000000000a1');

select throws_ok(
  $$update public.conditional_capabilities
      set is_enabled = true,
          validated_at = now(),
          validated_by = 'aaaaaaaa-0000-0000-0000-0000000000a1'
      where key = 'printer_xp236b_bluetooth'$$,
  '23514',
  null,
  'A FAILED validation does not unlock the capability'
);

-- ============================================================================
-- RULE: a PASSING validation unlocks it — the gate opens on evidence
-- ============================================================================
insert into public.capability_validations
  (capability_key, device_or_vendor, outcome, evidence_note, tested_by)
values ('printer_xp236b_bluetooth', 'Xprinter XP-236B s/n 12345, Android 14, BT paired',
        'passed', 'Printed 10 consecutive 40x30mm labels; no duplicates; retry reprinted once.',
        'aaaaaaaa-0000-0000-0000-0000000000a1');

select lives_ok(
  $$update public.conditional_capabilities
      set is_enabled = true,
          validated_at = now(),
          validated_by = 'aaaaaaaa-0000-0000-0000-0000000000a1'
      where key = 'printer_xp236b_bluetooth'$$,
  'A passing real-device validation unlocks the capability'
);

select is(
  (select has_passing_validation from public.capability_status()
    where key = 'printer_xp236b_bluetooth'),
  true,
  'Readiness is reported only once evidence exists'
);

-- ============================================================================
-- RULE: retreating to manual is NEVER gated (Bible §24.18)
-- ============================================================================
select lives_ok(
  $$update public.conditional_capabilities set is_enabled = false
      where key = 'printer_xp236b_bluetooth'$$,
  'Disabling a capability is always allowed — falling back to manual is never gated'
);

-- Evidence survives being switched off, so re-enabling needs no re-test.
select is(
  (select count(*)::int from public.capability_validations
    where capability_key = 'printer_xp236b_bluetooth' and outcome = 'passed'),
  1,
  'Validation evidence survives the capability being switched off'
);

-- ============================================================================
-- RULE: every capability names a manual fallback (Bible §24.18)
-- ============================================================================
select is(
  (select count(*)::int from public.capability_status() where manual_fallback is null),
  0,
  'Every capability names its manual fallback — a disabled integration degrades the workflow, never blocks it'
);

select is(
  (select manual_fallback from public.capability_status()
    where key = 'meta_direct_send'),
  'Copy Invoice Message, send manually, Mark as Sent',
  'Meta direct send falls back to copy-and-send-manually'
);

-- ============================================================================
-- RULE: a blocked capability explains itself
-- ============================================================================
select is(
  (select count(*)::int from public.conditional_capabilities
    where length(trim(blocked_reason)) = 0),
  0,
  'Every capability records WHY it is blocked, so the next person reads the reason'
);

select * from finish();
rollback;
