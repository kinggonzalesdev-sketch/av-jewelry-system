-- ============================================================================
-- Item custody & location — where an item physically is, who holds it, and
-- whether it is with A.V. Jewelry or the financer (business requirement F).
-- ----------------------------------------------------------------------------
-- The team currently cannot tell if a (layaway) item is on-hand or with the
-- financer, and loses time hunting for misplaced items. These columns make
-- custody an explicit, updatable fact on the item.
--
-- NO new table: custody is a property of the item, one row per item. Updates are
-- already governed by the existing `inventory_items_update` policy
-- (inventory_monitoring / item_withdrawal / live_batch_operation) and the
-- table's UPDATE grant — so no new grant or policy is needed, and none is added.
-- ============================================================================

alter table public.inventory_items
  -- Who physically holds the item. Defaults to A.V. Jewelry (the safe default:
  -- a not-yet-set item is assumed on-hand, not with the financer).
  add column custody_holder text not null default 'av_jewelry'
    check (custody_holder in ('av_jewelry', 'financer')),

  -- Free-text physical location (shelf / drawer / vault / financer reference).
  add column storage_location text
    check (storage_location is null or length(trim(storage_location)) between 1 and 120),

  -- The staff member currently responsible for the item, if handed to a person.
  add column custody_handler_id uuid references public.staff_profiles (id) on delete restrict,

  -- Audit of the last custody change (who/when). The append-only audit_events
  -- trail still records every change; these are a convenience snapshot on the row.
  add column custody_updated_at timestamptz,
  add column custody_updated_by uuid references public.staff_profiles (id) on delete restrict;

comment on column public.inventory_items.custody_holder is
  'Who holds the item: av_jewelry (on-hand) or financer. Default av_jewelry — a not-yet-set item is assumed on-hand.';
comment on column public.inventory_items.storage_location is
  'Physical location of the item (shelf/drawer/vault/financer reference). Free text.';
comment on column public.inventory_items.custody_handler_id is
  'Staff member currently responsible for the item, if handed to a person.';

create index inventory_items_custody_idx
  on public.inventory_items (custody_holder, storage_location);

-- ----------------------------------------------------------------------------
-- Provisional register (Bible §12.74): the exact custody vocabulary and whether
-- location should be coded (vs free text) are not finally confirmed.
-- ----------------------------------------------------------------------------
insert into app_private.provisional_fields (table_name, column_name, bible_reference, note) values
  ('inventory_items', 'custody_holder', '§12.74',
   'Proposed custody vocabulary (av_jewelry / financer). Awaiting confirmation of any further holders.'),
  ('inventory_items', 'storage_location', '§12.74',
   'Free-text location for now; a coded location scheme may be confirmed later.')
on conflict (table_name, column_name) do nothing;
