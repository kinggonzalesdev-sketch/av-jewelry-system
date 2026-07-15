-- ============================================================================
-- Phase 3 — Live Selling & Claim Intake (Bible §12 live workflow, §13 capture)
-- ----------------------------------------------------------------------------
-- Phase 1 already owns the claim spine. Phase 3 adds only what intake needs:
--
--   * SOURCE MARKERS   — how a claim entered the system (§13.2)
--   * EVIDENCE         — the screenshot / iOS-Share payload, stored, NEVER read
--   * ATTRIBUTION      — which Live Batch item was current AT CAPTURE TIME
--   * IDEMPOTENCY      — a retried submit must not create a second Pending Claim
--
-- THE PHASE 3 INVARIANT (§12.3, §13.2):
--   Capture creates a PENDING CLAIM ONLY. It never reserves, confirms, prints,
--   invoices, creates an order, or auto-matches a buyer. Reservation is Phase 4
--   (Confirm Claim & Print Label) and is deliberately absent here.
--
-- NO OCR / NO AUTO-READ (§13.2): evidence is stored as an opaque attachment.
-- Nothing in this migration parses, extracts, or interprets it. A human reads
-- the screenshot and types the values.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Source markers + capture-time attribution on claims.
-- ----------------------------------------------------------------------------
alter table public.claims
  -- HOW the claim was captured. `intake_kind` (Phase 1) says WHERE it came from
  -- (live / post-live / migrated); this says by WHICH METHOD, which is what
  -- §13.2 calls the source marker.
  --
  -- NULLABLE, and deliberately without a default. Phase 1 already defaults
  -- `intake_kind` to 'live_capture', so defaulting this to 'manual_live' would
  -- retroactively declare every pre-existing claim a live capture and force it
  -- to carry a Live Batch. A null marker means "not captured through the Phase 3
  -- intake path" — the rules below apply only once a marker is present.
  add column capture_method text
    check (capture_method is null or capture_method in (
      'manual_live',       -- typed by staff during the Live
      'screenshot_upload', -- a screenshot was attached; a HUMAN read it
      'ios_share',         -- arrived through the iOS share sheet
      'post_live_manual',  -- Manual Post-Live Entry, from Orders
      'migrated'           -- historical import; stays separate from capture
    )),

  -- The Live Batch item this claim was captured against, captured AT THE TIME.
  -- Storing the row (not re-deriving "current flex") is what makes switching the
  -- Current Flex Item affect FUTURE capture only (§12): an existing claim keeps
  -- pointing at whatever was current when it was taken.
  add column live_batch_item_id uuid references public.live_batch_items (id) on delete restrict,

  -- True when this claim was taken against the Current Flex Item. A historical
  -- fact, frozen at capture — never recomputed.
  add column captured_against_flex_item boolean not null default false,

  -- Duplicate-submit protection (§34 stage 8). One key = at most one claim.
  add column idempotency_key text
    check (idempotency_key is null or length(trim(idempotency_key)) between 8 and 200);

comment on column public.claims.capture_method is
  'Source marker (Bible §13.2). How the claim was captured. Evidence is never auto-read: no OCR.';
comment on column public.claims.live_batch_item_id is
  'The Live Batch item this claim was captured against, frozen at capture time. Switching the Current Flex Item affects future capture only (Bible §12).';
comment on column public.claims.captured_against_flex_item is
  'Whether the Current Flex Item was the target at capture. Historical fact; never recomputed.';
comment on column public.claims.idempotency_key is
  'Duplicate-submit guard. A retried capture reuses the key and yields the SAME claim, never a second one.';

-- THE duplicate-submit guarantee. Enforced by the database, not the app: a
-- concurrent double-submit loses at the unique index, not at a race in Node.
create unique index claims_idempotency_key_uq
  on public.claims (idempotency_key)
  where idempotency_key is not null;

create index claims_capture_method_idx on public.claims (capture_method, created_at desc);

-- The source marker must agree with the intake kind. These cannot drift apart.
-- Only applies once a marker exists: a null marker is not a claim about intake.
alter table public.claims
  add constraint claims_capture_method_matches_intake_ck check (
    capture_method is null
    or (intake_kind = 'live_capture'
      and capture_method in ('manual_live', 'screenshot_upload', 'ios_share'))
    or (intake_kind = 'post_live_manual' and capture_method = 'post_live_manual')
    or (intake_kind = 'migrated' and capture_method = 'migrated')
  );

-- A live capture belongs to a Live Batch. Post-live entry deliberately does not
-- require one — that is the whole point of Manual Post-Live Entry (§12).
--
-- Keyed on the MARKER, not on intake_kind: Phase 1 defaults intake_kind to
-- 'live_capture', so keying on it would demand a Live Batch from every claim
-- ever inserted without one, including Phase 1's own records.
alter table public.claims
  add constraint claims_live_capture_requires_batch_ck check (
    capture_method is null
    or capture_method not in ('manual_live', 'screenshot_upload', 'ios_share')
    or live_batch_id is not null
  );

-- Migration stays separate from capture (§12.3). A migrated record is not a
-- live capture wearing a different label.
alter table public.claims
  add constraint claims_migrated_marker_ck check (
    capture_method is null
    or ((source_kind = 'migrated') = (capture_method = 'migrated'))
  );

-- ----------------------------------------------------------------------------
-- Item name (Post-Live Item Entry, §12).
--
-- Phase 1 gave inventory_items an item_code but no human-readable name. The
-- Owner-approved New Entry screen shows "Item Name" as a required main field
-- and "Item Code" as optional detail, so intake needs somewhere to put it.
-- Nullable: Phase 1 rows predate this column and are not retro-filled.
-- PROVISIONAL (§12.74) — part of the unconfirmed manual-entry field set.
-- ----------------------------------------------------------------------------
alter table public.inventory_items
  add column item_name text
    check (item_name is null or length(trim(item_name)) between 1 and 160);

comment on column public.inventory_items.item_name is
  'Human-readable item name (Bible §12). Provisional field set (§12.74). Nullable: pre-Phase-3 rows are not back-filled.';

-- ----------------------------------------------------------------------------
-- Capture creates a Pending Claim ONLY (Bible §12.3, §13.2).
--
-- The single most important rule in this phase. A claim may only be BORN
-- pending. Confirmation is a later, separate, permissioned transition (Phase 4)
-- — it can never be smuggled in at INSERT time to skip the reservation logic.
-- Migration is exempt: a historical record enters at its actual status (§12.3).
-- ----------------------------------------------------------------------------
create or replace function app_private.enforce_capture_creates_pending_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.source_kind <> 'migrated' and new.status <> 'pending_claim' then
    raise exception
      'Capture creates a Pending Claim only: a claim cannot be inserted with status %. Confirmation is a separate, permissioned action.',
      new.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function app_private.enforce_capture_creates_pending_only() is
  'Bible §12.3/§13.2: capture creates a Pending Claim only — never a confirmed claim, reservation, print, invoice, or order.';

create trigger claims_capture_creates_pending_only
  before insert on public.claims
  for each row execute function app_private.enforce_capture_creates_pending_only();

-- ----------------------------------------------------------------------------
-- Claim evidence — the screenshot / iOS-Share payload.
--
-- Stored, never interpreted. Distinct from item photos (§12.42) and from
-- PAYMENT evidence (§22.11) — three different things that must never merge.
-- Only METADATA lives here; the object sits in a private bucket (ADR §13).
-- ----------------------------------------------------------------------------
create table public.claim_evidence (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id) on delete restrict,

  evidence_kind text not null check (evidence_kind in (
    'screenshot',   -- an uploaded image
    'ios_share',    -- payload handed over by the iOS share sheet
    'manual_note'   -- what the capturing staff member typed
  )),

  -- Path inside a PRIVATE bucket. Never a public URL (ADR §13).
  storage_path text check (storage_path is null or length(trim(storage_path)) between 1 and 400),
  content_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),

  -- The iOS share sheet can hand over text. It is stored VERBATIM and never
  -- parsed — no auto-read, no auto-match to a customer (§13.2).
  shared_text text check (shared_text is null or length(shared_text) <= 4000),

  captured_at timestamptz not null default now(),
  uploaded_by uuid references public.staff_profiles (id) on delete restrict,
  created_at timestamptz not null default now(),

  constraint claim_evidence_unique_path unique (storage_path),

  -- An attachment must actually carry something.
  constraint claim_evidence_payload_ck check (
    (evidence_kind = 'screenshot' and storage_path is not null)
    or (evidence_kind = 'ios_share' and (storage_path is not null or shared_text is not null))
    or (evidence_kind = 'manual_note' and shared_text is not null)
  )
);

comment on table public.claim_evidence is
  'Capture evidence for a claim (Bible §13.2). Stored, never auto-read: no OCR. Distinct from item photos (§12.42) and from payment evidence (§22.11).';

create index claim_evidence_claim_idx on public.claim_evidence (claim_id, captured_at desc);

alter table public.claim_evidence enable row level security;
alter table public.claim_evidence force row level security;
revoke all on public.claim_evidence from anon, authenticated;

-- Evidence is readable by any active staff member, but attaching it needs the
-- same authority as capturing the claim it belongs to.
create policy claim_evidence_read on public.claim_evidence
  for select to authenticated using (app_private.is_active_staff());

create policy claim_evidence_insert on public.claim_evidence
  for insert to authenticated
  with check (
    app_private.has_permission('claim_capture')
    or app_private.has_permission('existing_record_entry')
  );

-- Correcting attached evidence is a review action, not a capture action.
create policy claim_evidence_update on public.claim_evidence
  for update to authenticated
  using (app_private.has_permission('claim_review'))
  with check (app_private.has_permission('claim_review'));

-- ----------------------------------------------------------------------------
-- Provisional field set (roadmap Phase 3 open item, Bible §12.74).
--
-- The exact Live-Batch / source-marker / manual-entry fields are NOT finally
-- confirmed by the client. The roadmap explicitly permits starting from a
-- proposed set. This table records which columns are provisional so the open
-- item stays visible in the schema instead of living only in a document.
-- ----------------------------------------------------------------------------
create table app_private.provisional_fields (
  table_name text not null,
  column_name text not null,
  bible_reference text not null,
  note text not null,
  primary key (table_name, column_name)
);

comment on table app_private.provisional_fields is
  'Bible §12.74 open item: field sets awaiting final client confirmation before pilot. Recorded here so "provisional" is a fact in the schema, not a comment in a doc.';

insert into app_private.provisional_fields (table_name, column_name, bible_reference, note) values
  ('claims', 'capture_method', '§12.74',
   'Proposed source-marker vocabulary. Awaiting client confirmation of the exact marker set.'),
  ('claims', 'captured_against_flex_item', '§12.74',
   'Proposed Current-Flex attribution flag. Awaiting confirmation that this is the required attribution.'),
  ('claim_evidence', 'evidence_kind', '§12.74',
   'Proposed evidence vocabulary (screenshot / ios_share / manual_note). Awaiting client confirmation.'),
  ('live_batches', 'title', '§12.74',
   'Proposed minimal Live Batch field. The exact Live-Batch field set is not final.'),
  ('inventory_items', 'item_name', '§12.74',
   'Added for Post-Live Item Entry to back the approved New Entry "Item Name" field. Awaiting client confirmation of the manual-entry field set.');
