-- ============================================================================
-- Phase 6 — Payment & Layaway (Bible §16, §17)
-- ----------------------------------------------------------------------------
-- Implements the Owner-approved decisions recorded in
-- docs/PHASE-6-APPROVED-DECISIONS.md, which resolved the items the roadmap
-- marked "(blocks this phase)" (§16.23, §17.28). Nothing here invents a money
-- rule: every formula below is written in that document.
--
-- Phase 1 already owns:
--   * payments / payment_evidence / payment_verifications  (evidence != verification)
--   * payment_verifications UNIQUE(payment_id)             -> verify once, retry-safe
--   * layaway_arrangements  UNIQUE(official_order_id)      -> one layaway per order
--   * layaway_active_deposit_ck                            -> active needs a verified deposit
--
-- ALL MONEY IS numeric. Never float: 0.1 + 0.2 <> 0.3 is not an acceptable
-- property for a system that decides whether a customer still owes money.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Payment method + reference (approved decision §3).
-- ----------------------------------------------------------------------------
alter table public.payments
  add column payment_method text
    check (payment_method is null or payment_method in (
      'bank_transfer',
      'e_wallet',      -- GCash / Maya / approved wallet
      'cash',
      'card',
      'other'
    )),

  -- Transaction / reference number. Duplicates are FLAGGED, never silently
  -- accepted (§3), so this is deliberately NOT unique — a unique index would
  -- reject the second one outright and hide the collision instead of surfacing
  -- it for review.
  add column reference_number text
    check (reference_number is null or length(trim(reference_number)) between 1 and 120),

  add column provider text,          -- bank / wallet provider / payment channel
  add column transacted_at timestamptz,
  add column received_by uuid references public.staff_profiles (id) on delete restrict,
  add column collection_location text,
  add column method_detail_note text,

  -- Void / reverse. Neither counts toward Paid in Full (§1).
  add column voided_at timestamptz,
  add column voided_reason text,
  add column reversed_at timestamptz,
  add column reversed_reason text,

  -- A pending correction disqualifies the payment from counting (§1).
  add column correction_pending boolean not null default false,

  add constraint payments_void_ck check (
    voided_at is null or (voided_reason is not null and length(trim(voided_reason)) > 0)
  ),
  add constraint payments_reverse_ck check (
    reversed_at is null or (reversed_reason is not null and length(trim(reversed_reason)) > 0)
  );

comment on column public.payments.reference_number is
  'Transaction/reference number. NOT unique on purpose: a duplicate must be FLAGGED for review (approved decision §3), not silently rejected.';
comment on column public.payments.correction_pending is
  'A payment under correction does not count toward Paid in Full or the Outstanding Balance (approved decision §1).';

create index payments_reference_idx on public.payments (reference_number)
  where reference_number is not null;

-- Cash requires the receiving staff identity and a reference number; photo
-- evidence is optional for cash only (approved decision §3).
alter table public.payments
  add constraint payments_cash_attribution_ck check (
    payment_method is distinct from 'cash'
    or (received_by is not null and reference_number is not null)
  );

-- ⚠️  CARD DATA IS NEVER STORED (approved decision §3). There is deliberately no
--     column for a card number, CVV, PIN, or any authentication data, and none
--     may ever be added. `provider` holds the CHANNEL, `reference_number` the
--     approval reference. That is the whole permitted card footprint.

-- ----------------------------------------------------------------------------
-- Approved order charges and discounts (approved decision §1).
--
-- "Total Amount Payable" includes other charges explicitly recorded AND APPROVED
-- on the Official Order, minus approved discounts/credits. Neither existed, so
-- the payable total had nowhere to come from.
--
-- Shipping/COD live here and are NOT part of the Layaway balance unless
-- explicitly added as an approved order charge (§2) — `include_in_layaway_balance`
-- is what makes that distinction explicit rather than implied.
-- ----------------------------------------------------------------------------
create table public.official_order_charges (
  id uuid primary key default gen_random_uuid(),
  official_order_id uuid not null references public.official_orders (id) on delete restrict,

  kind text not null check (kind in ('charge', 'discount', 'credit')),
  label text not null check (length(trim(label)) between 1 and 160),

  -- Always positive. `kind` decides the sign, so a "negative charge" can never
  -- silently become a discount nobody approved.
  amount numeric(14, 2) not null check (amount > 0),

  -- Only an APPROVED charge counts toward the payable total (§1).
  approved_at timestamptz,
  approved_by uuid references public.staff_profiles (id) on delete restrict,

  include_in_layaway_balance boolean not null default false,

  created_at timestamptz not null default now(),
  created_by uuid references public.staff_profiles (id) on delete restrict,

  constraint order_charges_approved_ck check (
    (approved_at is null) = (approved_by is null)
  )
);

comment on table public.official_order_charges is
  'Approved charges/discounts/credits on an Official Order (approved decision §1). Only APPROVED rows count toward Total Amount Payable. Shipping/COD stay outside the Layaway balance unless include_in_layaway_balance is set (§2).';

create index order_charges_order_idx on public.official_order_charges (official_order_id);

alter table public.official_order_charges enable row level security;
alter table public.official_order_charges force row level security;
revoke all on public.official_order_charges from anon, authenticated;

create policy order_charges_read on public.official_order_charges
  for select to authenticated using (app_private.is_active_staff());
create policy order_charges_insert on public.official_order_charges
  for insert to authenticated
  with check (app_private.has_permission('invoice_preparation'));
create policy order_charges_update on public.official_order_charges
  for update to authenticated
  using (app_private.has_permission('payment_correction') or app_private.is_owner())
  with check (app_private.has_permission('payment_correction') or app_private.is_owner());

-- ----------------------------------------------------------------------------
-- Layaway terms (approved decision §5).
-- ----------------------------------------------------------------------------
alter table public.layaway_arrangements
  -- Minimum 1, maximum 3 (§5).
  add column months smallint check (months is null or months between 1 and 3),

  -- Σ (grams per piece × quantity) across the order's item lines, frozen at
  -- activation. Stored so the fee is reproducible: re-deriving it later would
  -- silently recalculate the fee if an item were ever corrected (§5 forbids
  -- automatic recalculation after activation).
  add column total_grams numeric(12, 3) check (total_grams is null or total_grams > 0),

  add column layaway_fee numeric(14, 2) check (layaway_fee is null or layaway_fee >= 0),
  add column started_at timestamptz,
  add column final_due_date date,
  add column completed_at timestamptz;

comment on column public.layaway_arrangements.total_grams is
  'Total layaway grams frozen at activation (approved decision §5). Stored, not re-derived: the fee must not silently recalculate after activation.';
comment on column public.layaway_arrangements.layaway_fee is
  'PHP 150 x total_grams x months, rounded half-up to 2dp (approved decision §5). Applied ONCE to the whole order.';

-- Completed requires a completion timestamp; forfeiture stays Owner-approved
-- (Phase 1 already enforces that half).
alter table public.layaway_arrangements
  add constraint layaway_completed_ck check (
    status <> 'completed' or completed_at is not null
  );

-- ----------------------------------------------------------------------------
-- THE MONEY MATH (approved decisions §1, §2, §5).
--
-- One implementation each. A second copy of any of these could drift, and drift
-- here decides whether a customer is told they still owe money.
-- ----------------------------------------------------------------------------

/**
 * Layaway fee = PHP 150 x total grams x months, rounded half-up to 2dp.
 *
 * Grams are NOT rounded first and nothing intermediate is rounded — only the
 * final result (§5). numeric round() is half-up, which is the approved rule.
 */
create or replace function app_private.layaway_fee(p_total_grams numeric, p_months integer)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(150::numeric * p_total_grams * p_months, 2);
$$;

comment on function app_private.layaway_fee(numeric, integer) is
  'Approved decision §5: PHP 150 x grams x months, half-up to 2dp, applied once per Layaway Official Order. Grams are never pre-rounded.';

/** Sum of approved charges minus approved discounts/credits. */
create or replace function app_private.approved_charge_total(
  p_order_id uuid,
  p_layaway_only boolean default false
)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(
    case when c.kind = 'charge' then c.amount else -c.amount end
  ), 0)::numeric
  from public.official_order_charges c
  where c.official_order_id = p_order_id
    and c.approved_at is not null
    and (not p_layaway_only or c.include_in_layaway_balance);
$$;

/** The order's item total, from the committed claims. */
create or replace function app_private.order_item_total(p_order_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(i.total_price_per_piece * c.quantity), 0)::numeric
  from public.official_order_claims ooc
  join public.claims c on c.id = ooc.claim_id
  join public.inventory_items i on i.id = c.inventory_item_id
  where ooc.official_order_id = p_order_id;
$$;

/**
 * Total Amount Payable (approved decision §1)
 *   = item total + approved layaway fee + approved charges - approved discounts.
 */
create or replace function app_private.total_amount_payable(p_order_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select round(
    app_private.order_item_total(p_order_id)
    + coalesce((
        select l.layaway_fee from public.layaway_arrangements l
        where l.official_order_id = p_order_id
      ), 0)
    + app_private.approved_charge_total(p_order_id, false)
  , 2);
$$;

comment on function app_private.total_amount_payable(uuid) is
  'Approved decision §1: item total + approved layaway fee + approved charges - approved discounts/credits.';

/**
 * Layaway Amount Payable (approved decision §2)
 *   = item total + approved layaway fee - approved discounts/credits.
 *
 * Shipping and COD are EXCLUDED unless explicitly flagged into the layaway
 * balance — that is the whole point of the flag.
 */
create or replace function app_private.layaway_amount_payable(p_order_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select round(
    app_private.order_item_total(p_order_id)
    + coalesce((
        select l.layaway_fee from public.layaway_arrangements l
        where l.official_order_id = p_order_id
      ), 0)
    + app_private.approved_charge_total(p_order_id, true)
  , 2);
$$;

/**
 * Total Verified Net Payments (approved decision §1).
 *
 * ONLY verified payments count. Submitted-but-unverified, rejected, voided,
 * reversed, and correction-pending payments contribute NOTHING. The amount used
 * is the VERIFIED amount when the verifier recorded one — what a payer claimed
 * to send is not evidence of what arrived.
 */
create or replace function app_private.verified_net_payments(p_order_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(coalesce(v.verified_amount, p.amount)), 0)::numeric
  from public.payments p
  join public.payment_verifications v on v.payment_id = p.id
  where p.official_order_id = p_order_id
    and p.status = 'verified'
    and v.outcome = 'verified'
    and p.voided_at is null
    and p.reversed_at is null
    and p.correction_pending = false;
$$;

comment on function app_private.verified_net_payments(uuid) is
  'Approved decision §1: only Verified payments count. Submitted/unverified, rejected, voided, reversed, and correction-pending payments never do.';

/**
 * Outstanding Balance (approved decision §2)
 *   = max(payable - verified net, 0). NEVER negative.
 */
create or replace function app_private.outstanding_balance(p_order_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select greatest(
    app_private.total_amount_payable(p_order_id) - app_private.verified_net_payments(p_order_id),
    0
  )::numeric;
$$;

/** Overpayment Credit (approved decision §2): the verified excess, else 0. */
create or replace function app_private.overpayment_credit(p_order_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select greatest(
    app_private.verified_net_payments(p_order_id) - app_private.total_amount_payable(p_order_id),
    0
  )::numeric;
$$;

/** Required Down Payment (approved decision §6): 20% of Layaway Amount Payable, fee included. */
create or replace function app_private.required_down_payment(p_order_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select round(app_private.layaway_amount_payable(p_order_id) * 0.20, 2);
$$;

/**
 * Paid in Full (approved decision §1).
 *
 * Verified net >= payable. Required Payment Verified is NOT automatically Paid
 * in Full — this is the only thing entitled to say "paid in full", and it says
 * it only when the arithmetic does.
 */
create or replace function app_private.is_paid_in_full(p_order_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app_private.verified_net_payments(p_order_id)
       >= app_private.total_amount_payable(p_order_id);
$$;

-- Read-only wrappers for the UI. app_private is not exposed through PostgREST,
-- and the screens must never re-implement the arithmetic.
create or replace function public.order_balance(p_order_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'total_amount_payable', app_private.total_amount_payable(p_order_id),
    'verified_net_payments', app_private.verified_net_payments(p_order_id),
    'outstanding_balance', app_private.outstanding_balance(p_order_id),
    'overpayment_credit', app_private.overpayment_credit(p_order_id),
    'paid_in_full', app_private.is_paid_in_full(p_order_id),
    'layaway_amount_payable', app_private.layaway_amount_payable(p_order_id),
    'required_down_payment', app_private.required_down_payment(p_order_id)
  );
$$;

revoke all on function public.order_balance(uuid) from anon;
grant execute on function public.order_balance(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Verification never releases, forfeits, cancels, or deducts inventory
-- (roadmap Phase 6 invariant).
--
-- Verifying a payment is a statement about MONEY. It must not be able to move
-- stock. Enforced here so no later code path can quietly wire the two together.
-- ----------------------------------------------------------------------------
create or replace function app_private.enforce_verification_is_money_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order_id uuid;
begin
  select p.official_order_id into v_order_id
  from public.payments p
  where p.id = new.payment_id;

  if v_order_id is null then
    raise exception 'That payment does not exist' using errcode = 'foreign_key_violation';
  end if;

  -- A payment may only be verified against a live order. Verifying against a
  -- cancelled order would move money onto a record nobody is fulfilling.
  if exists (
    select 1 from public.official_orders o
    where o.id = v_order_id and o.status = 'cancelled'
  ) then
    raise exception
      'That Official Order is cancelled. A payment cannot be verified against it.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function app_private.enforce_verification_is_money_only() is
  'Phase 6 invariant: verification never auto-releases, forfeits, cancels, or deducts inventory. It is a statement about money only.';

create trigger payment_verifications_money_only
  before insert on public.payment_verifications
  for each row execute function app_private.enforce_verification_is_money_only();

-- ----------------------------------------------------------------------------
-- Correcting a VERIFIED payment requires Owner approval (approved decision §4).
--
-- An unverified payment may be corrected by an authorized staff member; once
-- verified, the money has been attested to and only the Owner may change it.
-- Financial history is never silently overwritten.
-- ----------------------------------------------------------------------------
create or replace function app_private.enforce_verified_payment_correction()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Only guard MATERIAL financial fields. Flags and notes are not the money.
  if old.status = 'verified' and (
       new.amount is distinct from old.amount
    or new.official_order_id is distinct from old.official_order_id
    or new.payment_method is distinct from old.payment_method
    or new.reference_number is distinct from old.reference_number
  ) then
    if new.reassignment_approval_request_id is null then
      raise exception
        'Correcting a VERIFIED payment requires Owner approval (approved decision §4). Record an Owner Approval Request first. No record was changed.'
        using errcode = 'insufficient_privilege';
    end if;

    if new.reassignment_reason is null or length(trim(new.reassignment_reason)) = 0 then
      raise exception 'Correcting a verified payment requires a reason.'
        using errcode = 'check_violation';
    end if;
  end if;

  -- A verified payment may never silently move to another order (§4).
  if old.official_order_id is distinct from new.official_order_id
     and new.reassigned_from_order_id is null then
    raise exception
      'A payment cannot be silently reassigned to another order. Record the reassignment explicitly (Bible §16.12).'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function app_private.enforce_verified_payment_correction() is
  'Approved decision §4: an unverified payment may be corrected by authorized staff; a VERIFIED payment correction requires Owner approval. No silent reassignment.';

create trigger payments_verified_correction_guard
  before update on public.payments
  for each row execute function app_private.enforce_verified_payment_correction();

-- ----------------------------------------------------------------------------
-- Layaway completion requires a genuinely zero balance (approved decision §1).
--
-- Not "looks paid" — zero Outstanding Balance, no unresolved correction, and no
-- unresolved overpayment, all computed from VERIFIED payments only.
-- ----------------------------------------------------------------------------
create or replace function app_private.enforce_layaway_completion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_outstanding numeric;
  v_overpaid numeric;
  v_pending integer;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    v_outstanding := app_private.outstanding_balance(new.official_order_id);

    if v_outstanding <> 0 then
      raise exception
        'A Layaway cannot be completed with an Outstanding Balance of %. Completion requires zero, from VERIFIED payments only (approved decision §1).',
        v_outstanding
        using errcode = 'check_violation';
    end if;

    select count(*)::int into v_pending
    from public.payments p
    where p.official_order_id = new.official_order_id
      and p.correction_pending;

    if v_pending > 0 then
      raise exception
        'A Layaway cannot be completed while % payment correction(s) remain unresolved (approved decision §1).',
        v_pending
        using errcode = 'check_violation';
    end if;

    v_overpaid := app_private.overpayment_credit(new.official_order_id);

    if v_overpaid > 0 then
      raise exception
        'A Layaway cannot be completed with an unresolved overpayment credit of % (approved decision §1). Resolve it through the correction workflow first.',
        v_overpaid
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function app_private.enforce_layaway_completion() is
  'Approved decision §1: Completed requires zero Outstanding Balance, no unresolved correction, no unresolved overpayment, all from VERIFIED payments.';

create trigger layaway_completion_guard
  before update on public.layaway_arrangements
  for each row execute function app_private.enforce_layaway_completion();

-- ----------------------------------------------------------------------------
-- Grace period (approved decision §6): 10 calendar days after the FINAL due
-- date. Grace adds no month and no fee.
-- ----------------------------------------------------------------------------
create or replace function app_private.layaway_grace_ends(p_layaway_id uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select l.final_due_date + l.grace_period_days
  from public.layaway_arrangements l
  where l.id = p_layaway_id;
$$;

comment on function app_private.layaway_grace_ends(uuid) is
  'Approved decision §6: final due date + up to 10 calendar days. Grace never adds a month or a fee.';

-- ----------------------------------------------------------------------------
-- Duplicate reference detection (approved decision §3).
--
-- FLAGS, never rejects: a unique index would refuse the second payment and hide
-- the collision. A human must look at it.
-- ----------------------------------------------------------------------------
create or replace function public.duplicate_payment_references()
returns table (reference_number text, payment_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.reference_number, count(*) as payment_count
  from public.payments p
  where p.reference_number is not null
    and p.voided_at is null
  group by p.reference_number
  having count(*) > 1;
$$;

comment on function public.duplicate_payment_references() is
  'Approved decision §3: duplicate transaction/reference numbers are FLAGGED for review, never silently accepted or auto-rejected.';

revoke all on function public.duplicate_payment_references() from anon;
grant execute on function public.duplicate_payment_references() to authenticated;

-- ----------------------------------------------------------------------------
-- Provisional / deferred records.
-- ----------------------------------------------------------------------------
insert into app_private.provisional_fields (table_name, column_name, bible_reference, note) values
  ('payments', 'payment_method', '§16.23',
   'RESOLVED by the Owner 2026-07-15 (see docs/PHASE-6-APPROVED-DECISIONS.md §3). Refund/reversal behaviour remains DEFERRED post-V1.'),
  ('layaway_arrangements', 'layaway_fee', '§17.28',
   'RESOLVED by the Owner 2026-07-15 (§5): PHP 150 x grams x months, half-up to 2dp, once per order.');
