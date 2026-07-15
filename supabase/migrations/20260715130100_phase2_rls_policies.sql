-- ============================================================================
-- Phase 2 — Permission-aware RLS policies
-- ----------------------------------------------------------------------------
-- Replaces the Phase 1 deny-by-default posture with MINIMAL, permission-aware
-- policies. RLS stays ENABLED and FORCED on every table.
--
-- Rules honoured throughout (Bible §5, §11, §30.3 r2):
--   * anon receives NOTHING — no policy references anon, and privileges stay revoked
--   * every policy requires an ACTIVE staff account (deactivated = no future access)
--   * writes require an EXPLICIT granted permission — never a role title
--   * Owner-only actions are gated by is_owner(), not by "admin means everything"
--   * scope narrows access where a record carries one
--
-- Explicitly NOT created (these were named as prohibited):
--   * "authenticated can read all" / "authenticated can write all"
--   * "role = admin therefore all permissions"
--   * "assigned user automatically has permission"
--
-- RLS is the LAST line of defence, not the only one: sensitive writes are also
-- re-checked server-side at execution time (Bible §29.3).
-- ============================================================================

-- Grant table privileges to `authenticated`. This is a PREREQUISITE for RLS to
-- be consulted at all — without it Postgres refuses at the privilege layer and
-- RLS never runs. Rows remain governed entirely by the policies below.
-- anon is deliberately NOT granted anything.
grant select, insert, update on all tables in schema public to authenticated;
revoke delete on all tables in schema public from authenticated;

-- Sequences are needed for reference-number defaults.
grant usage, select on all sequences in schema app_private to authenticated;

-- ----------------------------------------------------------------------------
-- Reference catalogs — readable by any ACTIVE staff member; never writable.
-- The catalogs are approved data (Bible §5.13); the application must not mutate
-- them at runtime, so no insert/update policy exists.
-- ----------------------------------------------------------------------------
create policy roles_read_active_staff on public.roles
  for select to authenticated using (app_private.is_active_staff());

create policy permissions_read_active_staff on public.permissions
  for select to authenticated using (app_private.is_active_staff());

create policy role_device_limits_read_active_staff on public.role_device_limits
  for select to authenticated using (app_private.is_active_staff());

create policy scopes_read_active_staff on public.scopes
  for select to authenticated using (app_private.is_active_staff());

-- Scope catalog management is Owner-only.
create policy scopes_write_owner on public.scopes
  for insert to authenticated with check (app_private.is_owner());
create policy scopes_update_owner on public.scopes
  for update to authenticated using (app_private.is_owner()) with check (app_private.is_owner());

-- ----------------------------------------------------------------------------
-- staff_profiles — identity.
-- A staff member may read their OWN profile. Reading OTHERS requires Owner.
-- This prevents an ordinary account from enumerating the staff roster.
-- ----------------------------------------------------------------------------
create policy staff_profiles_read_self on public.staff_profiles
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

create policy staff_profiles_read_owner on public.staff_profiles
  for select to authenticated
  using (app_private.is_owner());

-- ONLY the Owner may create or modify staff accounts (Bible §5.3, §5.4).
-- No self-service: a staff member cannot promote themselves, change their role,
-- or reactivate their own disabled account.
create policy staff_profiles_insert_owner on public.staff_profiles
  for insert to authenticated with check (app_private.is_owner());

create policy staff_profiles_update_owner on public.staff_profiles
  for update to authenticated
  using (app_private.is_owner())
  with check (app_private.is_owner());

-- ----------------------------------------------------------------------------
-- staff_permission_grants — Owner-only. Granting is an Owner act.
-- ----------------------------------------------------------------------------
create policy grants_read_self on public.staff_permission_grants
  for select to authenticated
  using (staff_profile_id = app_private.current_staff_id());

create policy grants_read_owner on public.staff_permission_grants
  for select to authenticated using (app_private.is_owner());

create policy grants_insert_owner on public.staff_permission_grants
  for insert to authenticated with check (app_private.is_owner());

create policy grants_update_owner on public.staff_permission_grants
  for update to authenticated
  using (app_private.is_owner()) with check (app_private.is_owner());

-- ----------------------------------------------------------------------------
-- staff_scope_assignments — Owner-only.
-- ----------------------------------------------------------------------------
create policy scope_assign_read_self on public.staff_scope_assignments
  for select to authenticated
  using (staff_profile_id = app_private.current_staff_id());

create policy scope_assign_read_owner on public.staff_scope_assignments
  for select to authenticated using (app_private.is_owner());

create policy scope_assign_insert_owner on public.staff_scope_assignments
  for insert to authenticated with check (app_private.is_owner());

create policy scope_assign_update_owner on public.staff_scope_assignments
  for update to authenticated
  using (app_private.is_owner()) with check (app_private.is_owner());

-- ----------------------------------------------------------------------------
-- trusted_devices — a staff member manages only their OWN devices.
-- ----------------------------------------------------------------------------
create policy devices_read_self on public.trusted_devices
  for select to authenticated
  using (staff_profile_id = app_private.current_staff_id());

create policy devices_read_owner on public.trusted_devices
  for select to authenticated using (app_private.is_owner());

create policy devices_insert_self on public.trusted_devices
  for insert to authenticated
  with check (
    staff_profile_id = app_private.current_staff_id()
    and app_private.is_active_staff()
  );

-- Revocation: own device, or Owner revoking any (lost/stolen device response).
create policy devices_update_self_or_owner on public.trusted_devices
  for update to authenticated
  using (staff_profile_id = app_private.current_staff_id() or app_private.is_owner())
  with check (staff_profile_id = app_private.current_staff_id() or app_private.is_owner());

-- ----------------------------------------------------------------------------
-- Customers (Bible §14). Read for any active staff; writes need a permission.
-- ----------------------------------------------------------------------------
create policy customers_read on public.customers
  for select to authenticated using (app_private.is_active_staff());

create policy customers_insert on public.customers
  for insert to authenticated
  with check (
    app_private.has_permission('claim_capture')
    or app_private.has_permission('existing_record_entry')
  );

create policy customers_update on public.customers
  for update to authenticated
  using (
    app_private.has_permission('claim_review')
    or app_private.has_permission('existing_record_entry')
  )
  with check (
    app_private.has_permission('claim_review')
    or app_private.has_permission('existing_record_entry')
  );

create policy customer_aliases_read on public.customer_aliases
  for select to authenticated using (app_private.is_active_staff());
create policy customer_aliases_insert on public.customer_aliases
  for insert to authenticated
  with check (
    app_private.has_permission('claim_capture')
    or app_private.has_permission('existing_record_entry')
  );

-- Duplicate references: recording a suspicion needs review authority. Nothing
-- here merges anything — automatic customer merge stays prohibited.
create policy customer_dupes_read on public.customer_duplicate_references
  for select to authenticated using (app_private.is_active_staff());
create policy customer_dupes_insert on public.customer_duplicate_references
  for insert to authenticated with check (app_private.has_permission('claim_review'));
create policy customer_dupes_update on public.customer_duplicate_references
  for update to authenticated
  using (app_private.has_permission('claim_review'))
  with check (app_private.has_permission('claim_review'));

-- ----------------------------------------------------------------------------
-- Live Batches (Bible §12, §22.4). Scope-aware.
-- ----------------------------------------------------------------------------
create policy live_batches_read on public.live_batches
  for select to authenticated
  using (app_private.is_active_staff() and app_private.has_scope(scope_id));

create policy live_batches_insert on public.live_batches
  for insert to authenticated
  with check (
    app_private.has_permission('live_batch_operation')
    and app_private.has_scope(scope_id)
  );

-- Closure is a distinct permission from operation; reopen additionally requires
-- an Owner approval reference, enforced by the Phase 1 constraint.
create policy live_batches_update on public.live_batches
  for update to authenticated
  using (
    (app_private.has_permission('live_batch_operation')
      or app_private.has_permission('live_batch_closure'))
    and app_private.has_scope(scope_id)
  )
  with check (
    (app_private.has_permission('live_batch_operation')
      or app_private.has_permission('live_batch_closure'))
    and app_private.has_scope(scope_id)
  );

create policy live_batch_items_read on public.live_batch_items
  for select to authenticated using (app_private.is_active_staff());
create policy live_batch_items_insert on public.live_batch_items
  for insert to authenticated
  with check (
    app_private.has_permission('live_batch_operation')
    or app_private.has_permission('post_live_item_entry')
  );
create policy live_batch_items_update on public.live_batch_items
  for update to authenticated
  using (
    app_private.has_permission('current_flex_item_control')
    or app_private.has_permission('item_withdrawal')
    or app_private.has_permission('live_batch_operation')
  )
  with check (
    app_private.has_permission('current_flex_item_control')
    or app_private.has_permission('item_withdrawal')
    or app_private.has_permission('live_batch_operation')
  );

-- ----------------------------------------------------------------------------
-- Inventory items & photos (Bible §19)
-- ----------------------------------------------------------------------------
create policy inventory_items_read on public.inventory_items
  for select to authenticated using (app_private.is_active_staff());

create policy inventory_items_insert on public.inventory_items
  for insert to authenticated
  with check (
    app_private.has_permission('live_batch_operation')
    or app_private.has_permission('post_live_item_entry')
    or app_private.has_permission('existing_record_entry')
  );

create policy inventory_items_update on public.inventory_items
  for update to authenticated
  using (
    app_private.has_permission('inventory_monitoring')
    or app_private.has_permission('item_withdrawal')
    or app_private.has_permission('live_batch_operation')
  )
  with check (
    app_private.has_permission('inventory_monitoring')
    or app_private.has_permission('item_withdrawal')
    or app_private.has_permission('live_batch_operation')
  );

create policy item_photos_read on public.item_photos
  for select to authenticated using (app_private.is_active_staff());
create policy item_photos_insert on public.item_photos
  for insert to authenticated
  with check (
    app_private.has_permission('live_batch_operation')
    or app_private.has_permission('post_live_item_entry')
  );

-- ----------------------------------------------------------------------------
-- Claims (Bible §22.6)
-- ----------------------------------------------------------------------------
create policy claims_read on public.claims
  for select to authenticated using (app_private.is_active_staff());

create policy claims_insert on public.claims
  for insert to authenticated
  with check (
    app_private.has_permission('claim_capture')
    or app_private.has_permission('existing_record_entry')
  );

-- Confirming is a DIFFERENT permission from reviewing: Claim Review does not
-- silently include Confirm Claim & Print Label (Bible §5.13).
create policy claims_update on public.claims
  for update to authenticated
  using (
    app_private.has_permission('claim_review')
    or app_private.has_permission('confirm_claim_print_label')
  )
  with check (
    app_private.has_permission('claim_review')
    or app_private.has_permission('confirm_claim_print_label')
  );

-- Miner allocation: its own permission. No automatic promotion exists.
create policy miner_positions_read on public.miner_positions
  for select to authenticated using (app_private.is_active_staff());
create policy miner_positions_insert on public.miner_positions
  for insert to authenticated
  with check (
    app_private.has_permission('claim_capture')
    or app_private.has_permission('miner_allocation_review')
  );
create policy miner_positions_update on public.miner_positions
  for update to authenticated
  using (app_private.has_permission('miner_allocation_review'))
  with check (app_private.has_permission('miner_allocation_review'));

-- ----------------------------------------------------------------------------
-- Inventory reservations — the exactly-once boundary.
-- ONLY Confirm Claim & Print Label may create a reservation. Committing at
-- Official Order requires Invoice Preparation. Releasing requires Inventory
-- Monitoring (the Returned-to-Stock Review authority).
-- ----------------------------------------------------------------------------
create policy reservations_read on public.inventory_reservations
  for select to authenticated using (app_private.is_active_staff());

create policy reservations_insert on public.inventory_reservations
  for insert to authenticated
  with check (app_private.has_permission('confirm_claim_print_label'));

create policy reservations_update on public.inventory_reservations
  for update to authenticated
  using (
    app_private.has_permission('invoice_preparation')
    or app_private.has_permission('inventory_monitoring')
    or app_private.has_permission('claim_review')
  )
  with check (
    app_private.has_permission('invoice_preparation')
    or app_private.has_permission('inventory_monitoring')
    or app_private.has_permission('claim_review')
  );

create policy waitlist_read on public.waitlist_entries
  for select to authenticated using (app_private.is_active_staff());
create policy waitlist_insert on public.waitlist_entries
  for insert to authenticated
  with check (
    app_private.has_permission('claim_capture')
    or app_private.has_permission('claim_review')
  );
create policy waitlist_update on public.waitlist_entries
  for update to authenticated
  using (app_private.has_permission('miner_allocation_review'))
  with check (app_private.has_permission('miner_allocation_review'));

-- ----------------------------------------------------------------------------
-- Label jobs & print attempts (Bible §22.7)
-- ----------------------------------------------------------------------------
create policy label_jobs_read on public.label_jobs
  for select to authenticated using (app_private.is_active_staff());
create policy label_jobs_insert on public.label_jobs
  for insert to authenticated
  with check (app_private.has_permission('confirm_claim_print_label'));
create policy label_jobs_update on public.label_jobs
  for update to authenticated
  using (
    app_private.has_permission('retry_reprint_label')
    or app_private.has_permission('void_cancel_label_job')
  )
  with check (
    app_private.has_permission('retry_reprint_label')
    or app_private.has_permission('void_cancel_label_job')
  );

create policy print_attempts_read on public.print_attempts
  for select to authenticated using (app_private.is_active_staff());
create policy print_attempts_insert on public.print_attempts
  for insert to authenticated
  with check (
    app_private.has_permission('confirm_claim_print_label')
    or app_private.has_permission('retry_reprint_label')
  );

-- ----------------------------------------------------------------------------
-- Invoice drafts & Official Orders (Bible §22.8, §22.9)
-- ----------------------------------------------------------------------------
create policy invoice_drafts_read on public.invoice_drafts
  for select to authenticated using (app_private.is_active_staff());
create policy invoice_drafts_insert on public.invoice_drafts
  for insert to authenticated
  with check (app_private.has_permission('invoice_preparation'));
create policy invoice_drafts_update on public.invoice_drafts
  for update to authenticated
  using (app_private.has_permission('invoice_preparation'))
  with check (app_private.has_permission('invoice_preparation'));

create policy draft_claims_read on public.invoice_draft_claims
  for select to authenticated using (app_private.is_active_staff());
create policy draft_claims_insert on public.invoice_draft_claims
  for insert to authenticated
  with check (app_private.has_permission('invoice_preparation'));
create policy draft_claims_update on public.invoice_draft_claims
  for update to authenticated
  using (app_private.has_permission('invoice_preparation'))
  with check (app_private.has_permission('invoice_preparation'));

create policy official_orders_read on public.official_orders
  for select to authenticated using (app_private.is_active_staff());

-- Order creation is Invoice Preparation (via Approve & Send Invoice).
create policy official_orders_insert on public.official_orders
  for insert to authenticated
  with check (
    app_private.has_permission('invoice_preparation')
    or app_private.has_permission('existing_record_entry')
  );

-- Order updates cover several distinct stages, each with its own permission.
-- Cancellation additionally requires an Owner approval reference — the Phase 1
-- CHECK constraint enforces that, so no permission can bypass it.
create policy official_orders_update on public.official_orders
  for update to authenticated
  using (
    app_private.has_permission('invoice_preparation')
    or app_private.has_permission('payment_verification')
    or app_private.has_permission('fulfillment_preparation')
    or app_private.has_permission('fulfillment_release')
    or app_private.is_owner()
  )
  with check (
    app_private.has_permission('invoice_preparation')
    or app_private.has_permission('payment_verification')
    or app_private.has_permission('fulfillment_preparation')
    or app_private.has_permission('fulfillment_release')
    or app_private.is_owner()
  );

create policy order_claims_read on public.official_order_claims
  for select to authenticated using (app_private.is_active_staff());
create policy order_claims_insert on public.official_order_claims
  for insert to authenticated
  with check (
    app_private.has_permission('invoice_preparation')
    or app_private.has_permission('existing_record_entry')
  );

-- ----------------------------------------------------------------------------
-- Customer messages (Bible §22.10)
-- Preparing and SENDING are separate permissions.
-- ----------------------------------------------------------------------------
create policy messages_read on public.customer_messages
  for select to authenticated using (app_private.is_active_staff());
create policy messages_insert on public.customer_messages
  for insert to authenticated
  with check (app_private.has_permission('message_preparation'));
create policy messages_update on public.customer_messages
  for update to authenticated
  using (
    app_private.has_permission('message_preparation')
    or app_private.has_permission('message_sending')
  )
  with check (
    app_private.has_permission('message_preparation')
    or app_private.has_permission('message_sending')
  );

create policy message_attempts_read on public.message_send_attempts
  for select to authenticated using (app_private.is_active_staff());
create policy message_attempts_insert on public.message_send_attempts
  for insert to authenticated
  with check (app_private.has_permission('message_sending'));

-- ----------------------------------------------------------------------------
-- Payments (Bible §22.11). Recording is NOT verifying — separate permissions.
-- ----------------------------------------------------------------------------
create policy payments_read on public.payments
  for select to authenticated using (app_private.is_active_staff());

-- Recording payment evidence does not require Payment Verification.
create policy payments_insert on public.payments
  for insert to authenticated
  with check (
    app_private.has_permission('payment_verification')
    or app_private.has_permission('invoice_preparation')
    or app_private.has_permission('existing_record_entry')
  );

create policy payments_update on public.payments
  for update to authenticated
  using (
    app_private.has_permission('payment_verification')
    or app_private.has_permission('payment_correction')
  )
  with check (
    app_private.has_permission('payment_verification')
    or app_private.has_permission('payment_correction')
  );

create policy payment_evidence_read on public.payment_evidence
  for select to authenticated using (app_private.is_active_staff());
create policy payment_evidence_insert on public.payment_evidence
  for insert to authenticated
  with check (
    app_private.has_permission('payment_verification')
    or app_private.has_permission('invoice_preparation')
  );

-- Verification is its OWN permission and its own record.
create policy payment_verifications_read on public.payment_verifications
  for select to authenticated using (app_private.is_active_staff());
create policy payment_verifications_insert on public.payment_verifications
  for insert to authenticated
  with check (app_private.has_permission('payment_verification'));

-- ----------------------------------------------------------------------------
-- Layaway (Bible §22.12)
-- ----------------------------------------------------------------------------
create policy layaway_read on public.layaway_arrangements
  for select to authenticated using (app_private.is_active_staff());
create policy layaway_insert on public.layaway_arrangements
  for insert to authenticated
  with check (
    app_private.has_permission('layaway_monitoring')
    or app_private.has_permission('payment_verification')
    or app_private.has_permission('existing_record_entry')
  );
-- Forfeiture requires an Owner approval reference (Phase 1 CHECK enforces it).
create policy layaway_update on public.layaway_arrangements
  for update to authenticated
  using (app_private.has_permission('layaway_monitoring') or app_private.is_owner())
  with check (app_private.has_permission('layaway_monitoring') or app_private.is_owner());

create policy layaway_installments_read on public.layaway_installments
  for select to authenticated using (app_private.is_active_staff());
create policy layaway_installments_insert on public.layaway_installments
  for insert to authenticated
  with check (app_private.has_permission('layaway_monitoring'));
create policy layaway_installments_update on public.layaway_installments
  for update to authenticated
  using (app_private.has_permission('layaway_monitoring'))
  with check (app_private.has_permission('layaway_monitoring'));

-- ----------------------------------------------------------------------------
-- Fulfillment (Bible §22.13). Preparation is NOT release.
-- ----------------------------------------------------------------------------
create policy fulfillment_read on public.fulfillment_records
  for select to authenticated using (app_private.is_active_staff());
create policy fulfillment_insert on public.fulfillment_records
  for insert to authenticated
  with check (
    app_private.has_permission('fulfillment_preparation')
    or app_private.has_permission('existing_record_entry')
  );
create policy fulfillment_update on public.fulfillment_records
  for update to authenticated
  using (
    app_private.has_permission('fulfillment_preparation')
    or app_private.has_permission('fulfillment_release')
    or app_private.is_owner()
  )
  with check (
    app_private.has_permission('fulfillment_preparation')
    or app_private.has_permission('fulfillment_release')
    or app_private.is_owner()
  );

-- ----------------------------------------------------------------------------
-- Owner Approval Requests (Bible §22.14) — the authority boundary.
-- ----------------------------------------------------------------------------
create policy approvals_read on public.owner_approval_requests
  for select to authenticated using (app_private.is_active_staff());

-- Creating a request needs Initiate High-Risk Action. Creating it executes
-- nothing. The Owner may also raise their own request (self-action is permitted
-- but audited).
create policy approvals_insert on public.owner_approval_requests
  for insert to authenticated
  with check (
    (app_private.has_permission('initiate_high_risk_action') or app_private.is_owner())
    and requested_by = app_private.current_staff_id()
  );

-- ONLY the Owner may decide or execute. This is the non-delegable boundary
-- (Bible §5.13). A Selected Admin or Staff member is rejected here regardless of
-- any permission they hold — there is no permission that confers Owner authority.
create policy approvals_decide_owner_only on public.owner_approval_requests
  for update to authenticated
  using (app_private.can_decide_owner_only_action())
  with check (app_private.can_decide_owner_only_action());

create policy price_overrides_read on public.price_overrides
  for select to authenticated using (app_private.is_active_staff());
create policy price_overrides_insert on public.price_overrides
  for insert to authenticated with check (app_private.is_owner());
create policy price_overrides_update on public.price_overrides
  for update to authenticated
  using (app_private.is_owner()) with check (app_private.is_owner());

-- ----------------------------------------------------------------------------
-- Returned-to-Stock Review (Bible §22.15) — the only route back to available.
-- ----------------------------------------------------------------------------
create policy rts_read on public.returned_to_stock_reviews
  for select to authenticated using (app_private.is_active_staff());
create policy rts_insert on public.returned_to_stock_reviews
  for insert to authenticated
  with check (
    app_private.has_permission('inventory_monitoring')
    or app_private.has_permission('claim_review')
    or app_private.is_owner()
  );
-- Deciding the outcome requires Inventory Monitoring specifically.
create policy rts_update on public.returned_to_stock_reviews
  for update to authenticated
  using (app_private.has_permission('inventory_monitoring'))
  with check (app_private.has_permission('inventory_monitoring'));

-- ----------------------------------------------------------------------------
-- Notifications — a staff member sees only their own.
-- ----------------------------------------------------------------------------
create policy notifications_read_self on public.notifications
  for select to authenticated
  using (
    app_private.is_active_staff()
    and (staff_profile_id = app_private.current_staff_id() or staff_profile_id is null)
  );
create policy notifications_insert on public.notifications
  for insert to authenticated with check (app_private.is_active_staff());
create policy notifications_update_self on public.notifications
  for update to authenticated
  using (staff_profile_id = app_private.current_staff_id())
  with check (staff_profile_id = app_private.current_staff_id());

-- ----------------------------------------------------------------------------
-- Migration / import (Bible §22.16)
-- ----------------------------------------------------------------------------
create policy migration_batches_read on public.migration_batches
  for select to authenticated using (app_private.is_active_staff());
create policy migration_batches_insert on public.migration_batches
  for insert to authenticated
  with check (app_private.has_permission('existing_record_entry'));
create policy migration_batches_update on public.migration_batches
  for update to authenticated
  using (app_private.has_permission('existing_record_entry'))
  with check (app_private.has_permission('existing_record_entry'));

create policy migration_source_read on public.migration_source_records
  for select to authenticated using (app_private.is_active_staff());
create policy migration_source_insert on public.migration_source_records
  for insert to authenticated
  with check (app_private.has_permission('existing_record_entry'));

-- ----------------------------------------------------------------------------
-- Idempotency ledger — any active staff may claim a key (it is a lock, not data).
-- ----------------------------------------------------------------------------
create policy idempotency_read on public.idempotency_records
  for select to authenticated using (app_private.is_active_staff());
create policy idempotency_insert on public.idempotency_records
  for insert to authenticated with check (app_private.is_active_staff());
create policy idempotency_update on public.idempotency_records
  for update to authenticated
  using (app_private.is_active_staff()) with check (app_private.is_active_staff());

-- ----------------------------------------------------------------------------
-- AUDIT EVENTS — readable by active staff; INSERT-ONLY, and only ever about
-- yourself. The Phase 1 triggers already make UPDATE/DELETE impossible; there is
-- deliberately no update/delete policy either, so attribution cannot be erased.
--
-- The `with check` binds actor_auth_uid to auth.uid(): a caller cannot forge an
-- audit entry attributed to someone else.
-- ----------------------------------------------------------------------------
create policy audit_read on public.audit_events
  for select to authenticated using (app_private.is_active_staff());

create policy audit_insert_self_attributed on public.audit_events
  for insert to authenticated
  with check (
    app_private.is_active_staff()
    and actor_auth_uid = (select auth.uid())
    and actor_kind = 'staff'
  );
