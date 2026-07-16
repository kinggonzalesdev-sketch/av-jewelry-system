-- ============================================================================
-- Attachments & Storage — real photo/file attachments for business records
-- ----------------------------------------------------------------------------
-- Until now the schema recorded a `storage_path` on domain evidence tables
-- (e.g. claim_evidence, and payment evidence taken as a REFERENCE) but NOTHING
-- actually uploaded a file: there was no bucket and no upload path (documented,
-- not forgotten — see SESSION-HANDOFF §4). This migration adds the missing
-- Storage plumbing so a camera capture or file upload becomes a real stored
-- object with a real, scoped metadata row.
--
-- DESIGN (honest, minimal, RLS-first):
--   * ONE private bucket `attachments`. Private by default (ADR §13): objects
--     are reached only through a short-lived signed URL minted server-side for a
--     caller RLS already permits. No public URL is ever stored or exposed.
--   * ONE metadata table `public.attachments`, polymorphic by
--     (related_entity_type, related_entity_id) + `purpose`. This shares the
--     upload plumbing across surfaces WITHOUT merging the meanings — a payment
--     proof and a claim screenshot stay distinguishable by purpose/type, honouring
--     the Bible's "these are different things" rule (§13.2, §22.11, §12.42) while
--     avoiding six near-identical tables.
--   * NO base64 in a database row. The row holds ONLY a path + metadata; the
--     bytes live in Storage. (Part B requirement; ADR §13.)
--   * AUDIT METADATA travels with every row: uploaded_by, uploaded_at, file_name,
--     content_type, byte_size, width/height, and `source` (camera | file_upload).
--
-- GRANTS: named-table only. The Phase 11 S3 finding proved a blanket
-- `grant ... on all tables` silently re-widens earlier revokes. We grant exactly
-- what this table needs, to the named table, and never UPDATE/DELETE (an
-- attachment is immutable once recorded; correcting one means adding another).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The private bucket.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,                                   -- PRIVATE. Never public (ADR §13).
  10 * 1024 * 1024,                        -- 10 MiB hard ceiling per object.
  array['image/jpeg', 'image/png', 'image/webp']  -- images only, at the edge.
)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- Attachment metadata.
-- ----------------------------------------------------------------------------
create table public.attachments (
  id uuid primary key default gen_random_uuid(),

  -- WHERE the object lives. Path inside the private `attachments` bucket, never
  -- a public URL. Convention: {entity_type}/{entity_id}/{uuid}.{ext}
  storage_bucket text not null default 'attachments'
    check (storage_bucket = 'attachments'),
  storage_path text not null
    check (length(trim(storage_path)) between 1 and 400),

  -- WHAT business record this belongs to. Polymorphic but constrained: a typo
  -- cannot invent a new attachable surface, and the pair preserves the record
  -- relationship (Part B #10).
  related_entity_type text not null check (related_entity_type in (
    'order',           -- official_orders
    'payment',         -- payment evidence / proof of transaction
    'layaway',         -- layaway arrangement
    'inventory_item',  -- item / stock photo
    'customer',        -- customer reference photo
    'fulfillment',     -- packed parcel / proof of dispatch
    'claim',           -- live-selling / claim evidence
    'live_batch'       -- live-selling session evidence
  )),
  related_entity_id uuid not null,

  -- WHY it was attached — keeps a payment proof distinct from a stock photo even
  -- though both live here.
  purpose text not null check (purpose in (
    'photo',            -- a general reference/stock photo
    'payment_proof',    -- proof of a transaction (screenshot/receipt)
    'evidence',         -- claim / live-selling evidence
    'fulfillment_proof' -- proof of packing / dispatch
  )),

  -- Descriptive metadata (audit trail, Part B). Never the bytes themselves.
  file_name text check (file_name is null or length(trim(file_name)) between 1 and 260),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint not null check (byte_size >= 0 and byte_size <= 10 * 1024 * 1024),
  image_width integer check (image_width is null or image_width > 0),
  image_height integer check (image_height is null or image_height > 0),

  -- Provenance: was this taken with the camera, or picked from the file system?
  -- The desktop fallback is a first-class, honestly-labelled path (Part B).
  source text not null check (source in ('camera', 'file_upload')),

  -- Attribution — captured from the VERIFIED session by the RLS with-check below,
  -- never from client input (mirrors the audit module's rule).
  uploaded_by uuid not null references public.staff_profiles (id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  -- One metadata row per stored object.
  constraint attachments_unique_path unique (storage_bucket, storage_path)
);

comment on table public.attachments is
  'Camera/file attachments for business records. Holds a Storage PATH + metadata only — never base64 bytes (ADR §13). Polymorphic by (related_entity_type, related_entity_id) + purpose; the meanings stay distinct even though the plumbing is shared.';
comment on column public.attachments.storage_path is
  'Path inside the PRIVATE attachments bucket. Reached only via a short-lived signed URL minted server-side. Never a public URL.';
comment on column public.attachments.source is
  'Provenance: camera capture vs file_upload (desktop fallback). Both are first-class.';
comment on column public.attachments.uploaded_by is
  'Uploading staff profile. Set from the verified session by RLS with-check (uploaded_by = current_staff_id()); never trusted from client input.';

create index attachments_entity_idx
  on public.attachments (related_entity_type, related_entity_id, uploaded_at desc);
create index attachments_uploaded_by_idx
  on public.attachments (uploaded_by, uploaded_at desc);

-- ----------------------------------------------------------------------------
-- RLS on the metadata table (mirrors claim_evidence: force + revoke + policies).
-- ----------------------------------------------------------------------------
alter table public.attachments enable row level security;
alter table public.attachments force row level security;
revoke all on public.attachments from anon, authenticated;

-- Read: any active staff member may see attachment metadata (consistent with
-- claim_evidence_read). RLS on the OBJECT still governs the bytes, and a signed
-- URL is minted only for a permitted caller.
create policy attachments_read on public.attachments
  for select to authenticated
  using (app_private.is_active_staff());

-- Insert: an active staff member, and the row must be attributed to THEMSELVES.
-- The self-attribution with-check is the integrity control — a caller cannot
-- record an upload under someone else's name. The per-surface business
-- permission (e.g. recording a payment) is enforced by the server action and by
-- that domain's own guards; attaching a photo is itself an operational act any
-- active staff member may perform.
create policy attachments_insert on public.attachments
  for insert to authenticated
  with check (
    app_private.is_active_staff()
    and uploaded_by = app_private.current_staff_id()
  );

-- No UPDATE/DELETE policy: attachments are immutable once recorded. There is
-- deliberately no client path to rewrite or erase one.

-- Named-table grants ONLY (the S3 lesson). No update, no delete.
grant select, insert on public.attachments to authenticated;

-- ----------------------------------------------------------------------------
-- Storage object policies for the `attachments` bucket.
--
-- storage.objects has RLS enabled by Supabase; without policies, the
-- user-scoped client can neither read nor write. These scope both to active
-- staff and to THIS bucket. Reads are active-staff-wide (staff review each
-- other's evidence, as with claim_evidence); the bytes are still only reachable
-- through a signed URL the server mints for a permitted caller.
-- ----------------------------------------------------------------------------
create policy attachments_objects_read on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and app_private.is_active_staff());

create policy attachments_objects_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and app_private.is_active_staff());

-- No update/delete policy on objects in this bucket: uploads are immutable, and
-- removal (retention) is a later, controlled, server-side concern — not a
-- client capability.

-- ----------------------------------------------------------------------------
-- Provisional register (Bible §12.74): the exact per-surface required-photo
-- matrix and retention/signed-URL duration are not finally confirmed.
-- ----------------------------------------------------------------------------
insert into app_private.provisional_fields (table_name, column_name, bible_reference, note) values
  ('attachments', 'purpose', '§12.74',
   'Proposed attachment purpose vocabulary (photo/payment_proof/evidence/fulfillment_proof). Awaiting client confirmation of the exact required-photo matrix per surface.'),
  ('attachments', 'related_entity_type', '§12.74',
   'Proposed attachable-surface set. Awaiting confirmation of which surfaces REQUIRE a photo vs allow one.')
on conflict (table_name, column_name) do nothing;
