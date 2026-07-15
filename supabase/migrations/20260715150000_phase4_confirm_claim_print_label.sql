-- ============================================================================
-- Phase 4 — Claim Review, Confirmation, Reservation & Print Queue
-- (Bible §6.4, §12, §13, §22.6, §24)
-- ----------------------------------------------------------------------------
-- Phase 1 already owns almost everything structural here:
--   * inventory_reservations  UNIQUE(claim_id)     -> reserve exactly once
--   * label_jobs              UNIQUE(claim_id)     -> a reprint is an ATTEMPT
--   * print_attempts          UNIQUE(job, number)  -> attempts are numbered
--   * enforce_reservation_rules()                  -> locks the item, checks
--                                                     status/item/quantity
--   * enforce_no_second_deduction()                -> draft/order never re-deduct
--
-- So Phase 4 adds only two things:
--   1. the label PAYLOAD (what actually gets printed) — provisional per §24.17
--   2. ONE atomic confirmation transaction, because the JS client cannot span
--      statements and a Confirmed Claim without a reservation is the exact
--      partial state that must never exist.
--
-- NOT here, on purpose: no automatic miner promotion, no automatic waitlist
-- allocation, no automatic stock return, no Official Order, no invoice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Label payload (Bible §24). PROVISIONAL field set (§24.17) — the exact label
-- fields and the reprint-reason policy are not client-final. The roadmap
-- permits the proposed set; these columns are recorded as provisional below.
--
-- The customer/item values are SNAPSHOTS taken at confirmation. A label
-- reprinted next week must reproduce what was printed then, so it cannot join
-- to a mutable customer row (§31: attribution survives rename).
-- ----------------------------------------------------------------------------
alter table public.label_jobs
  add column customer_display_name text,
  add column item_code text,
  add column item_name text,
  add column grams_per_piece numeric(12, 3),
  add column quantity integer check (quantity is null or quantity >= 1),
  add column total_price numeric(14, 2) check (total_price is null or total_price >= 0),

  -- Target device. PROVISIONAL: the Xprinter XP-236B is the intended target but
  -- Bluetooth compatibility is UNVERIFIED (§27). Nothing here claims otherwise.
  add column printer_target text,
  add column label_size text not null default '40x30mm',

  -- Last transport failure, kept so a failed job explains itself.
  add column last_error text;

comment on column public.label_jobs.customer_display_name is
  'Snapshot at confirmation. A reprint must reproduce what was printed, so this never joins to a mutable customer row (Bible §31).';
comment on column public.label_jobs.printer_target is
  'Intended device. Xprinter XP-236B Bluetooth is UNVERIFIED (Bible §27) — a label job is not a physical print.';
comment on column public.label_jobs.label_size is
  'Approved target 40x30mm. Provisional label field set (§24.17).';

-- ----------------------------------------------------------------------------
-- Print attempts: distinguish a retry from a reprint, and be honest about
-- which transport produced the outcome.
-- ----------------------------------------------------------------------------
alter table public.print_attempts
  -- A retry re-attempts a FAILED job; a reprint deliberately prints again a job
  -- that already succeeded. Different intent, different permission, so they are
  -- distinguishable in the record rather than inferred from timing.
  add column is_reprint boolean not null default false,

  -- Reprint reason. PROVISIONAL (§24.17): whether a reason is mandatory is not
  -- client-final, so it is required for reprints (the safer default) and the
  -- policy is recorded as provisional rather than silently settled.
  add column reason text,

  -- Which transport produced this outcome. 'bluetooth' is NOT claimed as
  -- working — it exists so a real device result is distinguishable from a mock
  -- one, and mock results can never masquerade as real prints.
  add column transport text not null default 'mock'
    check (transport in ('mock', 'browser_preview', 'bluetooth')),

  add constraint print_attempts_reprint_reason_ck check (
    is_reprint = false or (reason is not null and length(trim(reason)) > 0)
  );

comment on column public.print_attempts.transport is
  'How the attempt was made. Bluetooth transport to the Xprinter XP-236B is UNVERIFIED (Bible §27); mock/browser_preview attempts are never presented as real prints.';
comment on column public.print_attempts.is_reprint is
  'Retry (re-attempt a failed job) vs reprint (print again a job that already printed). Neither creates a claim, a reservation, or an order.';

-- ----------------------------------------------------------------------------
-- Void / Cancel Label Job (Bible §24).
--
-- Voiding a label job cancels a PIECE OF PAPER. It must never touch the claim,
-- the reservation, or an order. Enforced here so no future code path can
-- quietly make voiding release stock.
-- ----------------------------------------------------------------------------
create or replace function app_private.enforce_void_label_job_is_paper_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claim_status text;
begin
  if new.status = 'voided' and old.status is distinct from 'voided' then
    select c.status into v_claim_status
    from public.claims c
    where c.id = new.claim_id;

    -- The claim must still stand. Voiding a label is not withdrawing a claim.
    if v_claim_status is distinct from 'confirmed_claim' then
      raise exception
        'A label job may only be voided while its claim stands confirmed (claim status: %). Voiding a label never cancels a claim (Bible §24).',
        coalesce(v_claim_status, 'missing')
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function app_private.enforce_void_label_job_is_paper_only() is
  'Bible §24: Void/Cancel Label Job cancels the label only — never the claim, the reservation, or the order.';

create trigger label_jobs_void_is_paper_only
  before update on public.label_jobs
  for each row execute function app_private.enforce_void_label_job_is_paper_only();

-- ----------------------------------------------------------------------------
-- Readable availability.
--
-- app_private.available_quantity() is the source of truth but app_private is not
-- exposed through PostgREST. Claim Review must show what confirming WOULD cost,
-- so this thin wrapper exposes the read without duplicating the arithmetic —
-- a second implementation could drift, and drift here means double-selling.
--
-- security invoker: RLS still applies, so it reveals nothing the caller could
-- not already read.
-- ----------------------------------------------------------------------------
create or replace function public.available_quantity_for(p_item_id uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.available_quantity(p_item_id);
$$;

comment on function public.available_quantity_for(uuid) is
  'Read-only wrapper over app_private.available_quantity() for Claim Review. Available = total - (provisional + committed); derived, never stored.';

revoke all on function public.available_quantity_for(uuid) from anon;
grant execute on function public.available_quantity_for(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- THE confirmation transaction (Bible §22.3, §22.6, §22.7).
--
-- One function because these must all happen or none of them:
--     claim pending -> confirmed   +   exactly one reservation   +   label job
--
-- A Confirmed Claim with no reservation is the worst partial state in the
-- system: the item looks available and gets sold twice. The Supabase JS client
-- cannot span statements, so the transaction lives here.
--
-- security invoker: RLS still applies to the caller, so this is not a privilege
-- escalation route. The explicit permission check exists for a clear error;
-- RLS remains the guarantee.
--
-- IDEMPOTENT by claim: confirming an already-confirmed claim returns the SAME
-- reservation and label job with deduplicated=true. It never creates a second.
-- Concurrency is handled by locking the claim row: the second caller waits,
-- then observes 'confirmed_claim' and takes the idempotent path.
-- ----------------------------------------------------------------------------
create or replace function public.confirm_claim_and_print(
  p_claim_id uuid,
  p_printer_target text default null,
  p_label_size text default '40x30mm'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claim public.claims%rowtype;
  v_item public.inventory_items%rowtype;
  v_customer_name text;
  v_available integer;
  v_reservation_id uuid;
  v_label_job_id uuid;
  v_staff_id uuid;
begin
  -- Permission, server-side, at execution time. Never inferred from a role.
  if not app_private.has_permission('confirm_claim_print_label') then
    raise exception
      'Not authorized: confirming a claim requires the confirm_claim_print_label permission. No record was changed.'
      using errcode = 'insufficient_privilege';
  end if;

  select sp.id into v_staff_id
  from public.staff_profiles sp
  where sp.auth_user_id = (select auth.uid());

  -- Lock the claim. This is what makes two staff confirming the same claim
  -- produce ONE reservation: the loser waits here, then finds it confirmed.
  select * into v_claim
  from public.claims
  where id = p_claim_id
  for update;

  if v_claim.id is null then
    raise exception 'That claim could not be found.' using errcode = 'no_data_found';
  end if;

  -- Already confirmed: return what exists. A retry must not double-reserve.
  if v_claim.status = 'confirmed_claim' then
    select r.id into v_reservation_id
    from public.inventory_reservations r
    where r.claim_id = p_claim_id;

    select lj.id into v_label_job_id
    from public.label_jobs lj
    where lj.claim_id = p_claim_id;

    return jsonb_build_object(
      'claim_id', p_claim_id,
      'reservation_id', v_reservation_id,
      'label_job_id', v_label_job_id,
      'deduplicated', true
    );
  end if;

  -- Only a Pending Claim may be confirmed. A withdrawn or rejected claim is not
  -- resurrected by confirming it.
  if v_claim.status <> 'pending_claim' then
    raise exception
      'Only a Pending Claim can be confirmed (claim status: %). No record was changed.',
      v_claim.status
      using errcode = 'check_violation';
  end if;

  select * into v_item
  from public.inventory_items
  where id = v_claim.inventory_item_id;

  -- Revalidate availability against STORED state, not against what the screen
  -- showed when it was rendered (Bible §29.8).
  v_available := app_private.available_quantity(v_claim.inventory_item_id);

  if v_available < v_claim.quantity then
    raise exception
      'Not enough available stock: % requested, % available. No record was changed.',
      v_claim.quantity, v_available
      using errcode = 'check_violation';
  end if;

  -- Order matters: the Phase 1 reservation guard REQUIRES the claim to already
  -- read 'confirmed_claim', so the claim transitions first and the guard then
  -- re-locks the item and re-checks quantity underneath us.
  update public.claims
  set status = 'confirmed_claim',
      confirmed_at = now(),
      confirmed_by = v_staff_id
  where id = p_claim_id;

  insert into public.inventory_reservations (inventory_item_id, claim_id, quantity, state)
  values (v_claim.inventory_item_id, p_claim_id, v_claim.quantity, 'provisional')
  returning id into v_reservation_id;

  select c.display_name into v_customer_name
  from public.customers c
  where c.id = v_claim.customer_id;

  -- The label job is queued, NOT printed. A label job is not a physical print.
  insert into public.label_jobs (
    claim_id, status, created_by,
    customer_display_name, item_code, item_name,
    grams_per_piece, quantity, total_price,
    printer_target, label_size
  )
  values (
    p_claim_id, 'pending_print', v_staff_id,
    v_customer_name, v_item.item_code, v_item.item_name,
    v_item.grams_per_piece, v_claim.quantity,
    v_item.total_price_per_piece * v_claim.quantity,
    p_printer_target, coalesce(p_label_size, '40x30mm')
  )
  returning id into v_label_job_id;

  return jsonb_build_object(
    'claim_id', p_claim_id,
    'reservation_id', v_reservation_id,
    'label_job_id', v_label_job_id,
    'deduplicated', false
  );
end;
$$;

comment on function public.confirm_claim_and_print(uuid, text, text) is
  'Confirm Claim & Print Label (Bible §22.3, §22.6, §22.7). Atomic: claim->confirmed + exactly one provisional reservation + one queued label job. Idempotent by claim. Creates NO invoice and NO Official Order.';

revoke all on function public.confirm_claim_and_print(uuid, text, text) from anon;
grant execute on function public.confirm_claim_and_print(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Provisional field sets (§24.17 label fields / reprint-reason policy;
-- §6.22/§19.7 second-miner priority window).
-- ----------------------------------------------------------------------------
insert into app_private.provisional_fields (table_name, column_name, bible_reference, note) values
  ('label_jobs', 'printer_target', '§24.17',
   'Proposed label field. Xprinter XP-236B Bluetooth transport is UNVERIFIED (§27) — no real compatibility is claimed.'),
  ('label_jobs', 'label_size', '§24.17',
   'Proposed 40x30mm default. Exact label field set awaiting client confirmation before pilot.'),
  ('label_jobs', 'total_price', '§24.17',
   'Proposed label payload field. Awaiting confirmation of what actually prints on the label.'),
  ('print_attempts', 'reason', '§24.17',
   'Reprint reason is REQUIRED here as the safer default. Whether the business mandates it is not final.'),
  ('miner_positions', 'assigned_at', '§6.22',
   'The exact 2nd-Miner priority window is unresolved. The timestamp is stored and displayed; NO automatic transfer or promotion exists.');
