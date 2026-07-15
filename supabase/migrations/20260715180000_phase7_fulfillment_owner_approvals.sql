-- ============================================================================
-- Phase 7 — Fulfillment & Owner Approval Center (Bible §18, §5.13, §22.13-22.14)
-- ----------------------------------------------------------------------------
-- Phase 1 already owns:
--   * fulfillment_records  UNIQUE(official_order_id), status vocabulary,
--     fulfillment_exceptional_ck (pending exceptional release needs an approval)
--   * owner_approval_requests + owner_approval_execution_ck
--     (executed_at only when status = 'approved')
--
-- Phase 7 adds:
--   1. shipping/pickup preparation fields (PROVISIONAL, §18.25)
--   2. the RELEASE RULES: verified-before-release, deposit floor, COD
--   3. execute-once for Owner approvals, with state re-validation
--
-- NOT here: no auto dispatch, no auto complete, no auto release, no auto stock
-- return. A request never executes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Approved deposit floor (Bible §4): shipping needs >= PHP 1,000 verified
-- deposit plus approved COD where applicable. Named once so it cannot drift.
-- ----------------------------------------------------------------------------
create or replace function app_private.shipping_deposit_floor()
returns numeric
language sql
immutable
set search_path = ''
as $$ select 1000.00::numeric; $$;

comment on function app_private.shipping_deposit_floor() is
  'Approved shipping deposit floor (Bible §4): PHP 1,000 verified, plus approved COD where applicable.';

-- ----------------------------------------------------------------------------
-- Preparation fields. PROVISIONAL (§18.25): shipping/pickup fields, the courier
-- list, and exact COD rules are not client-final. The roadmap marks them
-- "before pilot", not blocking, so a proposed set is used and recorded.
-- ----------------------------------------------------------------------------
alter table public.fulfillment_records
  add column courier text,
  add column tracking_number text,
  add column pickup_location text,
  add column pickup_contact text,
  add column prepared_at timestamptz,
  add column prepared_by uuid references public.staff_profiles (id) on delete restrict,

  -- COD is an explicit, approved decision — never inferred from the amount.
  add column is_cod boolean not null default false,
  add column cod_approved_at timestamptz,
  add column cod_approved_by uuid references public.staff_profiles (id) on delete restrict,

  add column dispatched_at timestamptz,
  add column picked_up_at timestamptz,
  add column completed_at timestamptz,
  add column release_note text,

  add constraint fulfillment_cod_ck check (
    (cod_approved_at is null) = (cod_approved_by is null)
  );

comment on column public.fulfillment_records.is_cod is
  'COD is an explicit approved decision (Bible §4), never inferred. Approval is recorded separately.';
comment on column public.fulfillment_records.courier is
  'Provisional field (§18.25) — the courier list is not client-final.';

-- ----------------------------------------------------------------------------
-- THE RELEASE RULE (Bible §18, §22.13).
--
-- Release is where goods leave. The guard below is the last line before that,
-- and it enforces what the Bible requires:
--
--   * an order must have its REQUIRED PAYMENT VERIFIED before release — an
--     unverified screenshot must never open the door;
--   * shipping needs a verified deposit >= PHP 1,000, and COD must be approved
--     where it applies;
--   * an EXCEPTIONAL release (below the floor / unpaid) needs an APPROVED and
--     UNEXECUTED Owner approval — a pending request releases nothing.
--
-- Normal release is permission-based, NOT Owner-only (§18). The Owner gate
-- applies only to the exceptional path.
-- ----------------------------------------------------------------------------
create or replace function app_private.enforce_release_rules()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_verified numeric;
  v_payable numeric;
  v_approval public.owner_approval_requests%rowtype;
begin
  -- Only guard the transition INTO a released state.
  if new.status not in ('approved_for_release', 'dispatched', 'picked_up')
     or old.status = new.status then
    return new;
  end if;

  v_verified := app_private.verified_net_payments(new.official_order_id);
  v_payable := app_private.total_amount_payable(new.official_order_id);

  -- An exceptional release is the sanctioned way past these rules. It requires
  -- an Owner approval that is APPROVED and NOT YET EXECUTED.
  if new.exceptional_release_approval_request_id is not null then
    select * into v_approval
    from public.owner_approval_requests
    where id = new.exceptional_release_approval_request_id;

    if v_approval.id is null then
      raise exception 'That exceptional-release approval does not exist.'
        using errcode = 'foreign_key_violation';
    end if;

    if v_approval.action_kind <> 'exceptional_fulfillment_release' then
      raise exception
        'That approval is for %, not an exceptional fulfillment release.',
        v_approval.action_kind
        using errcode = 'check_violation';
    end if;

    -- A REQUEST IS NOT A RELEASE (§22.14). Pending or rejected releases nothing.
    if v_approval.status <> 'approved' then
      raise exception
        'The exceptional release is not approved (status: %). A request never releases goods.',
        v_approval.status
        using errcode = 'insufficient_privilege';
    end if;

    if v_approval.entity_id <> new.official_order_id then
      raise exception
        'That approval was granted for a different order. No release was performed.'
        using errcode = 'check_violation';
    end if;

    return new;
  end if;

  -- NORMAL release from here on. Required payment must be VERIFIED.
  if v_verified <= 0 then
    raise exception
      'No verified payment on this order. Release requires verified payment — evidence alone is not payment (Bible §18).'
      using errcode = 'check_violation';
  end if;

  if new.method = 'shipping' then
    -- COD, when it applies, must be explicitly approved.
    if new.is_cod and new.cod_approved_at is null then
      raise exception
        'This is a COD shipment and COD has not been approved. No release was performed.'
        using errcode = 'check_violation';
    end if;

    -- Non-COD shipping requires the order settled OR the deposit floor met.
    if not new.is_cod
       and v_verified < v_payable
       and v_verified < app_private.shipping_deposit_floor() then
      raise exception
        'Shipping requires a verified deposit of at least % or full payment (verified: %). Use an Owner-approved exceptional release otherwise.',
        app_private.shipping_deposit_floor(), v_verified
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function app_private.enforce_release_rules() is
  'Bible §18/§22.13: verified payment before release; shipping needs the PHP 1,000 deposit floor or full payment; COD must be approved; an exceptional release needs an APPROVED Owner approval. A request never releases.';

create trigger fulfillment_enforce_release_rules
  before update on public.fulfillment_records
  for each row execute function app_private.enforce_release_rules();

-- ----------------------------------------------------------------------------
-- No automatic completion (Bible §18).
--
-- Dispatch/pickup and completion are attributed human acts. A record cannot
-- jump straight to completed without having been released and dispatched or
-- picked up first.
-- ----------------------------------------------------------------------------
create or replace function app_private.enforce_fulfillment_progression()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status not in ('dispatched', 'picked_up') then
    raise exception
      'A fulfillment cannot be completed from % — it must be dispatched or picked up first. Nothing completes automatically (Bible §18).',
      old.status
      using errcode = 'check_violation';
  end if;

  if new.status in ('dispatched', 'picked_up')
     and old.status not in ('approved_for_release', 'dispatched', 'picked_up') then
    raise exception
      'A fulfillment cannot be dispatched or picked up from % — it must be released first.',
      old.status
      using errcode = 'check_violation';
  end if;

  -- Releasing records WHO released and WHEN (Bible §31).
  if new.status = 'approved_for_release' and old.status <> 'approved_for_release'
     and (new.released_at is null or new.released_by is null) then
    raise exception 'A release must record who released it and when.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function app_private.enforce_fulfillment_progression() is
  'Bible §18: no auto dispatch, no auto complete. Release is attributed; completion follows dispatch or pickup.';

create trigger fulfillment_enforce_progression
  before update on public.fulfillment_records
  for each row execute function app_private.enforce_fulfillment_progression();

-- ----------------------------------------------------------------------------
-- Owner Approval Center: EXECUTE ONCE, and re-validate on execution
-- (Bible §22.14).
--
-- Phase 1 guarantees executed_at only exists on an approved request. This adds
-- the other half: an approved request may be executed exactly ONCE. A retried
-- execute must not run the action twice — cancelling an order twice, or
-- releasing twice, is a real-world loss.
-- ----------------------------------------------------------------------------
create or replace function app_private.enforce_approval_executes_once()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- An EXECUTED approval is frozen. Deliberately not "reject a different
  -- executed_at": now() is constant within a transaction, so a retried execute
  -- writes an IDENTICAL timestamp and a value comparison waves it through.
  -- Immutability is the guarantee that actually holds — cancelling an order or
  -- releasing goods twice is a real-world loss, not a cosmetic one.
  if old.executed_at is not null then
    raise exception
      'That Owner approval was already executed at %. An approval executes exactly once (Bible §22.14).',
      old.executed_at
      using errcode = 'check_violation';
  end if;

  -- A decided request is final. Re-deciding would let a rejection become an
  -- approval after the fact.
  if old.status in ('approved', 'rejected') and new.status is distinct from old.status then
    raise exception
      'That request was already decided as %. A decision is final.',
      old.status
      using errcode = 'check_violation';
  end if;

  if new.executed_at is not null and new.executed_by is null then
    raise exception 'Executing an approval must record who executed it.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function app_private.enforce_approval_executes_once() is
  'Bible §22.14: an approved request executes exactly once, by an attributed actor. A decision is final. A retry cannot run the action twice.';

create trigger owner_approval_executes_once
  before update on public.owner_approval_requests
  for each row execute function app_private.enforce_approval_executes_once();

-- ----------------------------------------------------------------------------
-- RLS for the new columns is inherited from Phase 2's fulfillment policies.
-- Confirm the release permission split is expressible: preparation and release
-- are DIFFERENT permissions (Bible §5.13), and both already exist in the
-- catalog (fulfillment_preparation, fulfillment_release).
-- ----------------------------------------------------------------------------

insert into app_private.provisional_fields (table_name, column_name, bible_reference, note) values
  ('fulfillment_records', 'courier', '§18.25',
   'Proposed field. The courier list is not client-final — awaiting confirmation before pilot.'),
  ('fulfillment_records', 'tracking_number', '§18.25',
   'Proposed field. Shipping/pickup field set is not client-final.'),
  ('fulfillment_records', 'is_cod', '§18.25',
   'Exact COD rules are not client-final. COD is recorded as an explicit approved decision, never inferred.'),
  ('fulfillment_records', 'pickup_location', '§18.25',
   'Proposed field. Failed-delivery / unclaimed-pickup workflow remains unresolved before pilot.');
