-- ============================================================================
-- Phase 10 — Conditional Capability Gating (Bible §27, §14, §13, §26)
-- ----------------------------------------------------------------------------
-- Phase 10's exit gate (roadmap): "real-hardware/device/vendor tests pass
-- BEFORE any readiness is claimed; if not validated, the feature stays flagged
-- OFF — launch proceeds on manual fallback."
--
-- This migration builds THE GATE. It does not build the integrations.
--
-- The XP-236B printer, Pancake/Meta, and native capture are all UNVALIDATED.
-- The Bible states the printer is "treated as unverified until tested" (§24.18).
-- No driver, adapter, or SDK is implemented here, because none has been tested
-- against real hardware — and shipping an untested integration that LOOKS
-- functional is how a Live night discovers the printer never worked.
--
-- So instead: a capability cannot be turned on until somebody records a real
-- validation against a real device. The database enforces that. A feature flag
-- that anyone can flip without evidence is not a gate, it is a suggestion.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The conditional capabilities (§35 r10–11, ADR §7 item 7: "default off").
--
-- This was a Phase 0 deliverable that was never built. It is Phase 10's
-- foundation: the roadmap requires every conditional capability to sit behind a
-- flag, and V1 launches on manual fallback if a flag stays off.
-- ----------------------------------------------------------------------------
create table public.conditional_capabilities (
  key text primary key check (key in (
    'printer_xp236b_bluetooth',   -- §27  Xprinter XP-236B, 40x30mm
    'pancake_adapter',            -- §14  Pancake intake/send
    'meta_direct_send',           -- §14, §26  Facebook/Meta direct send
    'android_floating_capture',   -- §13  Android floating capture
    'ios_share_intake'            -- §13  iOS Share sheet intake
  )),

  label text not null,
  bible_reference text not null,

  -- DEFAULT OFF. Not a preference — the roadmap's exit gate. An unvalidated
  -- capability must never be reachable.
  is_enabled boolean not null default false,

  -- Set ONLY by a recorded real-device validation (see the trigger below).
  validated_at timestamptz,
  validated_by uuid references public.staff_profiles (id) on delete restrict,
  validation_note text,

  -- What must be true before this can be enabled. Human-readable on purpose:
  -- the next person to try flipping this flag should read WHY they cannot.
  blocked_reason text not null,

  updated_at timestamptz not null default now(),

  -- A capability is enabled ONLY if it was validated. This is the gate.
  constraint capability_enabled_requires_validation_ck check (
    is_enabled = false
    or (validated_at is not null and validated_by is not null)
  )
);

comment on table public.conditional_capabilities is
  'Bible §27/§14/§13, roadmap Phase 10: conditional capabilities are DEFAULT OFF and cannot be enabled without a recorded real-device validation. If a flag stays off, V1 launches on manual fallback. A flag anyone can flip without evidence is not a gate.';

create trigger conditional_capabilities_updated_at before update on public.conditional_capabilities
  for each row execute function app_private.set_updated_at();

alter table public.conditional_capabilities enable row level security;
alter table public.conditional_capabilities force row level security;
revoke all on public.conditional_capabilities from anon, authenticated;

-- Any active staff member may READ which capabilities are available: the app
-- needs to know whether to offer the printer button or the manual fallback.
create policy capabilities_read on public.conditional_capabilities
  for select to authenticated using (app_private.is_active_staff());

-- Only the Owner may change a capability. Enabling an unvalidated integration
-- is a business-risk decision, not an operational one.
create policy capabilities_update on public.conditional_capabilities
  for update to authenticated
  using (app_private.is_owner())
  with check (app_private.is_owner());

-- ----------------------------------------------------------------------------
-- Real-device validation records (§34 stages 12–14).
--
-- Evidence that somebody actually put a physical device / real vendor account
-- in front of this system and watched it work. A claim of readiness with no
-- record behind it is exactly what the exit gate forbids.
-- ----------------------------------------------------------------------------
create table public.capability_validations (
  id uuid primary key default gen_random_uuid(),
  capability_key text not null references public.conditional_capabilities (key) on delete restrict,

  -- What was actually tested against. Free text on purpose: "Xprinter XP-236B
  -- serial 12345, Android 14, paired over BT" is worth more than an enum.
  device_or_vendor text not null check (length(trim(device_or_vendor)) between 1 and 200),

  outcome text not null check (outcome in ('passed', 'failed')),
  evidence_note text not null check (length(trim(evidence_note)) between 1 and 2000),

  tested_at timestamptz not null default now(),
  tested_by uuid not null references public.staff_profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table public.capability_validations is
  'Bible §34 stages 12-14: evidence that a real device or vendor account was tested. Readiness may not be claimed without one (roadmap Phase 10 exit gate).';

create index capability_validations_key_idx
  on public.capability_validations (capability_key, tested_at desc);

alter table public.capability_validations enable row level security;
alter table public.capability_validations force row level security;
revoke all on public.capability_validations from anon, authenticated;

create policy capability_validations_read on public.capability_validations
  for select to authenticated using (app_private.is_active_staff());

-- Recording a validation is an Owner act: it is the evidence that unlocks a
-- capability, so it must not be self-served by whoever wants the feature on.
create policy capability_validations_insert on public.capability_validations
  for insert to authenticated with check (app_private.is_owner());

-- ----------------------------------------------------------------------------
-- THE GATE: a capability may only be enabled if a PASSING validation exists.
--
-- The check constraint above proves "someone claimed validation". This proves
-- the claim is backed by an actual passing test record — otherwise
-- `validated_at = now()` would be a rubber stamp anyone could apply.
-- ----------------------------------------------------------------------------
create or replace function app_private.enforce_capability_validation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_passed integer;
begin
  if new.is_enabled and not old.is_enabled then
    select count(*)::int into v_passed
    from public.capability_validations v
    where v.capability_key = new.key and v.outcome = 'passed';

    if v_passed = 0 then
      raise exception
        'Capability "%" cannot be enabled: no PASSING real-device validation exists. %  Until it is validated, the feature stays off and the manual fallback is used (roadmap Phase 10 exit gate).',
        new.key, new.blocked_reason
        using errcode = 'check_violation';
    end if;
  end if;

  -- Turning a capability OFF is always allowed and never needs evidence:
  -- retreating to the manual fallback must never be harder than staying on it.
  return new;
end;
$$;

comment on function app_private.enforce_capability_validation() is
  'Roadmap Phase 10 exit gate: a capability may be enabled ONLY when a passing real-device validation exists. Disabling is always permitted — falling back to manual must never be gated.';

create trigger capabilities_enforce_validation
  before update on public.conditional_capabilities
  for each row execute function app_private.enforce_capability_validation();

-- ----------------------------------------------------------------------------
-- Seed the capability REGISTRY.
--
-- This is structural reference data, not operational data: it is the list of
-- things that are switched OFF and why. Every row ships disabled.
-- ----------------------------------------------------------------------------
insert into public.conditional_capabilities (key, label, bible_reference, is_enabled, blocked_reason) values
  ('printer_xp236b_bluetooth', 'Xprinter XP-236B Bluetooth (40x30mm)', '§27',
   false,
   'No XP-236B has ever been tested against this system. The protocol/SDK/pairing behaviour is unknown (§27.18), and the Bible treats the printer as unverified until tested (§24.18). Label rendering works and the browser preview is the fallback.'),

  ('pancake_adapter', 'Pancake intake adapter', '§14',
   false,
   'Pancake API access, feature set, and plan are unconfirmed (§14.28). No adapter exists. Claims are captured manually.'),

  ('meta_direct_send', 'Facebook/Meta direct send', '§14, §26',
   false,
   'No Meta integration exists and no delivery channel is observable. Sent is a human attestation; Delivered and Read are never claimed (§26). Messages are copied and sent manually.'),

  ('android_floating_capture', 'Android floating capture', '§13',
   false,
   'Android capture feasibility is unconfirmed (§13.29). Capture is manual entry or screenshot upload.'),

  ('ios_share_intake', 'iOS Share sheet intake', '§13',
   false,
   'iOS Share feasibility is unconfirmed (§13.29). Capture is manual entry or screenshot upload.');

-- ----------------------------------------------------------------------------
-- Readiness view: what may be claimed, and what may not.
-- ----------------------------------------------------------------------------
create or replace function public.capability_status()
returns table (
  key text,
  label text,
  bible_reference text,
  is_enabled boolean,
  has_passing_validation boolean,
  blocked_reason text,
  manual_fallback text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.key,
    c.label,
    c.bible_reference,
    c.is_enabled,
    exists (
      select 1 from public.capability_validations v
      where v.capability_key = c.key and v.outcome = 'passed'
    ),
    c.blocked_reason,
    -- The manual fallback is ALWAYS available. Bible §24.18: "Manual workflow
    -- remains available when the printer is unavailable."
    case c.key
      when 'printer_xp236b_bluetooth' then 'Browser preview, then print manually'
      when 'pancake_adapter' then 'Manual claim capture'
      when 'meta_direct_send' then 'Copy Invoice Message, send manually, Mark as Sent'
      when 'android_floating_capture' then 'Manual entry or screenshot upload'
      when 'ios_share_intake' then 'Manual entry or screenshot upload'
    end
  from public.conditional_capabilities c
  order by c.key;
$$;

comment on function public.capability_status() is
  'Bible §27/§24.18: every conditional capability names its manual fallback. The fallback is always available — a disabled integration degrades the workflow, it never blocks it.';

revoke all on function public.capability_status() from anon;
grant execute on function public.capability_status() to authenticated;

-- ----------------------------------------------------------------------------
-- Provisional / blocked records.
-- ----------------------------------------------------------------------------
insert into app_private.provisional_fields (table_name, column_name, bible_reference, note) values
  ('conditional_capabilities', 'is_enabled', '§27.18, §14.28, §13.29',
   'BLOCKED, not provisional: every capability is off because none has been validated against real hardware or a real vendor account. Enabling requires a passing validation record. V1 launches on manual fallback (roadmap Phase 10, non-blocking).');
