-- Live reflection (Owner request): broadcast row changes on the tables that feed
-- the Dashboard Profile, every module list, and the financial summaries. RLS still
-- governs WHICH subscriber is told about a change, so this exposes nothing new — it
-- only lets an already-authorized client know it should re-fetch the official values.
--
-- REPLICA IDENTITY FULL so UPDATE/DELETE events carry enough row data for RLS to
-- evaluate old-row visibility. Idempotent: skip a table already in the publication.
do $$
declare
  t text;
  tables text[] := array[
    'official_orders',
    'official_order_charges',
    'official_order_claims',
    'fulfillment_records',
    'payments',
    'payment_verifications',
    'inventory_items',
    'inventory_reservations',
    'layaway_ledger',
    'layaway_ledger_payments',
    'layaway_ledger_installments',
    'layaway_interest_charges',
    'layaway_code_pool',
    'scrap_sales',
    'customers',
    'attendance_records',
    'payroll_snapshots',
    'deletion_requests',
    'owner_approval_requests',
    'order_reminders',
    'financers',
    'staff_profiles',
    'pancake_integration_config'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      continue; -- table not present in this environment; skip safely
    end if;
    execute format('alter table public.%I replica identity full', t);
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
