-- ============================================================================
-- Phase 5 — Invoicing, Customer Message & Official Order
-- (Bible §15, §6.7–6.8, §22.8–22.9)
-- ----------------------------------------------------------------------------
-- Phase 1 already owns the idempotency spine:
--   * official_orders  UNIQUE(invoice_draft_id)  -> ONE order per draft
--   * official_orders  UNIQUE(order_number), UNIQUE(invoice_number)
--   * official_order_claims UNIQUE(claim_id)     -> a claim is never sold twice
--   * invoice_draft_claims  partial UNIQUE       -> one ACTIVE draft per claim
--   * enforce_no_second_deduction()              -> provisional->committed only,
--                                                   quantity may not change
--   * enforce_draft_claim_rules()                -> only Confirmed Claims
--
-- Phase 5 therefore adds only:
--   1. the GROUPING KEYS (payment + fulfillment arrangement) and their rule
--   2. ONE atomic Approve & Send transaction
--
-- NOT here: no automatic cancellation on hold expiry, no automatic stock
-- return, no real Facebook/Pancake delivery.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Grouping keys (Bible §11.17, §22.8).
--
-- Grouping requires same customer + same payment arrangement + same fulfillment
-- arrangement. Phase 1 has no column for either, so the rule had nowhere to
-- live. They sit on the CLAIM because that is where the arrangement is agreed
-- (the approved New Entry screen collects both), and the draft carries the
-- group's keys so a mismatch is refused rather than silently absorbed.
--
-- PROVISIONAL (§4, §12.74): the vocabularies below are the approved UI's set
-- (Settings → Defaults). The exact business vocabulary is not client-final.
-- Nullable: Phase 1–4 claims predate this and are not back-filled or guessed.
-- ----------------------------------------------------------------------------
alter table public.claims
  add column payment_arrangement text
    check (payment_arrangement is null or payment_arrangement in (
      'full_payment',
      'layaway',
      'deposit'
    )),
  add column fulfillment_arrangement text
    check (fulfillment_arrangement is null or fulfillment_arrangement in (
      'shipping',
      'pickup'
    ));

comment on column public.claims.payment_arrangement is
  'Grouping key (Bible §11.17). Provisional vocabulary (§4) — not client-final. Nullable: pre-Phase-5 claims are not back-filled.';
comment on column public.claims.fulfillment_arrangement is
  'Grouping key (Bible §11.17). Provisional vocabulary (§4) — not client-final.';

-- The draft carries the group's keys. Stored, not derived from the first claim:
-- a draft must be able to REFUSE a mismatching claim, which needs a fixed
-- reference to compare against.
alter table public.invoice_drafts
  add column payment_arrangement text
    check (payment_arrangement is null or payment_arrangement in (
      'full_payment', 'layaway', 'deposit'
    )),
  add column fulfillment_arrangement text
    check (fulfillment_arrangement is null or fulfillment_arrangement in (
      'shipping', 'pickup'
    ));

create index claims_grouping_idx
  on public.claims (customer_id, payment_arrangement, fulfillment_arrangement)
  where status = 'confirmed_claim';

-- ----------------------------------------------------------------------------
-- THE grouping rule (Bible §11.17, §22.8).
--
-- Phase 1 already refuses a non-confirmed claim. This adds the other three:
-- same customer, same payment arrangement, same fulfillment arrangement.
--
-- Enforced at the database because "silently grouped the wrong customer" is a
-- business-visible failure that no amount of application care can be trusted
-- to prevent forever.
-- ----------------------------------------------------------------------------
create or replace function app_private.enforce_draft_grouping_rules()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_draft public.invoice_drafts%rowtype;
  v_claim public.claims%rowtype;
begin
  select * into v_draft from public.invoice_drafts where id = new.invoice_draft_id;
  select * into v_claim from public.claims where id = new.claim_id;

  if v_draft.id is null or v_claim.id is null then
    raise exception 'Invoice Draft or claim does not exist'
      using errcode = 'foreign_key_violation';
  end if;

  -- Same customer. Never merge customers silently (Bible §22.15).
  if v_claim.customer_id <> v_draft.customer_id then
    raise exception
      'Only claims for the same customer may be grouped into one Invoice Draft (Bible §11.17).'
      using errcode = 'check_violation';
  end if;

  -- Same payment arrangement.
  if v_draft.payment_arrangement is not null
     and v_claim.payment_arrangement is distinct from v_draft.payment_arrangement then
    raise exception
      'Only claims with the same payment arrangement may be grouped (draft: %, claim: %).',
      v_draft.payment_arrangement, coalesce(v_claim.payment_arrangement, 'unset')
      using errcode = 'check_violation';
  end if;

  -- Same fulfillment arrangement.
  if v_draft.fulfillment_arrangement is not null
     and v_claim.fulfillment_arrangement is distinct from v_draft.fulfillment_arrangement then
    raise exception
      'Only claims with the same fulfillment arrangement may be grouped (draft: %, claim: %).',
      v_draft.fulfillment_arrangement, coalesce(v_claim.fulfillment_arrangement, 'unset')
      using errcode = 'check_violation';
  end if;

  -- A confirmed claim holds a reservation. Grouping a claim without one would
  -- put an unreserved item on an invoice.
  if not exists (
    select 1 from public.inventory_reservations r
    where r.claim_id = new.claim_id and r.state in ('provisional', 'committed')
  ) then
    raise exception
      'That claim holds no active reservation and cannot be invoiced (Bible §22.3).'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function app_private.enforce_draft_grouping_rules() is
  'Bible §11.17/§22.8: same customer + same payment arrangement + same fulfillment arrangement, and the claim must already hold a reservation.';

create trigger invoice_draft_claims_enforce_grouping
  before insert on public.invoice_draft_claims
  for each row when (new.is_active)
  execute function app_private.enforce_draft_grouping_rules();

-- ----------------------------------------------------------------------------
-- Approved hold length (Bible §15.16, §4.11): three days, shared across the
-- whole order. Named rather than inlined so it cannot drift between the
-- transaction and anything that later reads it.
-- ----------------------------------------------------------------------------
create or replace function app_private.official_order_hold_interval()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '3 days'; $$;

comment on function app_private.official_order_hold_interval() is
  'The approved shared 3-day hold (Bible §15.16, §4.11). One definition, so the hold cannot drift.';

-- ----------------------------------------------------------------------------
-- THE Approve & Send transaction (Bible §6.7–6.8, §15, §22.9).
--
-- This is the COMMIT POINT of the whole system. One successful approval creates
-- exactly one Official Order, one order number, one invoice number, and one
-- shared hold, and converts every provisional reservation to committed WITHOUT
-- deducting anything a second time.
--
-- Idempotent by draft: UNIQUE(invoice_draft_id) is the guarantee, and the
-- pre-check is a courtesy. A retried send returns the SAME order. Concurrency is
-- settled by locking the draft row.
--
-- security invoker: RLS still applies. The permission check gives a clear error;
-- RLS remains the guarantee.
--
-- It does NOT send anything. Message delivery is a separate, separately
-- observable step — "Official Order created — message sending failed" must be
-- representable, so creating the order cannot depend on a message succeeding.
-- ----------------------------------------------------------------------------
create or replace function public.approve_and_send_invoice(p_invoice_draft_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_draft public.invoice_drafts%rowtype;
  v_order public.official_orders%rowtype;
  v_staff_id uuid;
  v_claim_count integer;
  v_bad_claim record;
  v_hold timestamptz;
begin
  if not app_private.has_permission('invoice_preparation') then
    raise exception
      'Not authorized: Approve & Send Invoice requires the invoice_preparation permission. No record was changed.'
      using errcode = 'insufficient_privilege';
  end if;

  select sp.id into v_staff_id
  from public.staff_profiles sp
  where sp.auth_user_id = (select auth.uid());

  -- Lock the draft. Two staff approving at once: the loser waits here, then
  -- finds it sent and takes the idempotent path.
  select * into v_draft
  from public.invoice_drafts
  where id = p_invoice_draft_id
  for update;

  if v_draft.id is null then
    raise exception 'That Invoice Draft could not be found.' using errcode = 'no_data_found';
  end if;

  -- Already sent: return the existing order. A retry must never create a second.
  if v_draft.status = 'sent' then
    select * into v_order
    from public.official_orders
    where invoice_draft_id = p_invoice_draft_id;

    return jsonb_build_object(
      'official_order_id', v_order.id,
      'order_number', v_order.order_number,
      'invoice_number', v_order.invoice_number,
      'hold_expires_at', v_order.hold_expires_at,
      'deduplicated', true
    );
  end if;

  if v_draft.status = 'dissolved' then
    raise exception 'That Invoice Draft was dissolved and cannot be approved.'
      using errcode = 'check_violation';
  end if;

  -- Revalidate EVERY claim from stored state (Bible §29.8). The screen's opinion
  -- of eligibility is not evidence.
  select count(*)::int into v_claim_count
  from public.invoice_draft_claims idc
  where idc.invoice_draft_id = p_invoice_draft_id and idc.is_active;

  if v_claim_count = 0 then
    raise exception 'That Invoice Draft has no claims. There is nothing to invoice.'
      using errcode = 'check_violation';
  end if;

  -- Any claim that drifted out of eligibility since the draft was built.
  select c.claim_reference, c.status into v_bad_claim
  from public.invoice_draft_claims idc
  join public.claims c on c.id = idc.claim_id
  where idc.invoice_draft_id = p_invoice_draft_id
    and idc.is_active
    and c.status <> 'confirmed_claim'
  limit 1;

  if v_bad_claim.claim_reference is not null then
    raise exception
      'Claim % is no longer a Confirmed Claim (status: %). No Official Order was created.',
      v_bad_claim.claim_reference, v_bad_claim.status
      using errcode = 'check_violation';
  end if;

  -- Every claim must still own an active reservation.
  select c.claim_reference into v_bad_claim
  from public.invoice_draft_claims idc
  join public.claims c on c.id = idc.claim_id
  where idc.invoice_draft_id = p_invoice_draft_id
    and idc.is_active
    and not exists (
      select 1 from public.inventory_reservations r
      where r.claim_id = c.id and r.state in ('provisional', 'committed')
    )
  limit 1;

  if v_bad_claim.claim_reference is not null then
    raise exception
      'Claim % no longer holds a reservation. No Official Order was created.',
      v_bad_claim.claim_reference
      using errcode = 'check_violation';
  end if;

  -- Grouping rules, revalidated rather than trusted from when the draft was built.
  select c.claim_reference into v_bad_claim
  from public.invoice_draft_claims idc
  join public.claims c on c.id = idc.claim_id
  where idc.invoice_draft_id = p_invoice_draft_id
    and idc.is_active
    and (
      c.customer_id <> v_draft.customer_id
      or (v_draft.payment_arrangement is not null
          and c.payment_arrangement is distinct from v_draft.payment_arrangement)
      or (v_draft.fulfillment_arrangement is not null
          and c.fulfillment_arrangement is distinct from v_draft.fulfillment_arrangement)
    )
  limit 1;

  if v_bad_claim.claim_reference is not null then
    raise exception
      'Claim % no longer matches this draft''s customer or arrangements. No Official Order was created.',
      v_bad_claim.claim_reference
      using errcode = 'check_violation';
  end if;

  v_hold := now() + app_private.official_order_hold_interval();

  -- ONE order. order_number and invoice_number come from their sequences by
  -- DEFAULT, so they are allocated by the database, never by the application,
  -- and never regenerated on a message retry.
  insert into public.official_orders (invoice_draft_id, customer_id, status,
                                      hold_expires_at, created_by)
  values (p_invoice_draft_id, v_draft.customer_id, 'invoiced', v_hold, v_staff_id)
  returning * into v_order;

  -- Link every claim. UNIQUE(claim_id) means a claim can never reach two orders.
  insert into public.official_order_claims (official_order_id, claim_id)
  select v_order.id, idc.claim_id
  from public.invoice_draft_claims idc
  where idc.invoice_draft_id = p_invoice_draft_id and idc.is_active;

  -- Provisional -> committed. The quantity is untouched, so nothing is deducted
  -- a second time; enforce_no_second_deduction() refuses if that ever changes.
  update public.inventory_reservations r
  set state = 'committed', committed_at = now()
  from public.invoice_draft_claims idc
  where idc.invoice_draft_id = p_invoice_draft_id
    and idc.is_active
    and r.claim_id = idc.claim_id
    and r.state = 'provisional';

  -- Marking the draft sent flips is_active off via the Phase 1 trigger, which
  -- releases the claims from the "one active draft" index.
  update public.invoice_drafts
  set status = 'sent', sent_at = now()
  where id = p_invoice_draft_id;

  return jsonb_build_object(
    'official_order_id', v_order.id,
    'order_number', v_order.order_number,
    'invoice_number', v_order.invoice_number,
    'hold_expires_at', v_hold,
    'claim_count', v_claim_count,
    'deduplicated', false
  );
end;
$$;

comment on function public.approve_and_send_invoice(uuid) is
  'Approve & Send Invoice (Bible §6.7-6.8, §15, §22.9). Atomic: ONE Official Order + one order number + one invoice number + one shared 3-day hold, and provisional->committed exactly once. Idempotent by draft. Sends no message.';

revoke all on function public.approve_and_send_invoice(uuid) from anon;
grant execute on function public.approve_and_send_invoice(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Provisional records (§28.27 number formats, §4 arrangement vocabulary).
-- ----------------------------------------------------------------------------
insert into app_private.provisional_fields (table_name, column_name, bible_reference, note) values
  ('claims', 'payment_arrangement', '§4',
   'Proposed vocabulary from the approved Settings screen (full_payment/layaway/deposit). Not client-final.'),
  ('claims', 'fulfillment_arrangement', '§4',
   'Proposed vocabulary from the approved Settings screen (shipping/pickup). Not client-final.'),
  ('official_orders', 'order_number', '§28.27',
   'Format ORD-<year>-<6 digits> is PROPOSED. Generated by sequence, so the format can be migrated without reusing or regenerating existing numbers.'),
  ('official_orders', 'invoice_number', '§28.27',
   'Format INV-<year>-<6 digits> is PROPOSED. Separate sequence from the order number; never regenerated on a message retry.');
