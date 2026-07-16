-- ============================================================================
-- Attachments & Storage — the bucket is private, the table is RLS-scoped, and
-- attribution cannot be forged (Part B; migration 20260716300000).
-- ----------------------------------------------------------------------------
-- The assertions that matter most here are the ABSENCES and the with-check:
--   * the bucket is PRIVATE (never a public URL);
--   * no base64 bytes live in a row (a path + metadata only);
--   * authenticated gets SELECT + INSERT only — never UPDATE/DELETE (immutable,
--     the S3 lesson: named grants, no re-widening);
--   * a caller cannot record an upload under someone else's name — the RLS
--     with-check pins uploaded_by to the verified session.
-- Every behavioural assertion runs as a real Staff JWT.
-- ============================================================================
begin;
select plan(16);

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users (id, instance_id, email, aud, role) values
  ('ad000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
   'att-staff@test.local', 'authenticated', 'authenticated'),
  ('ad000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000',
   'att-other@test.local', 'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key, is_active) values
  ('ad100000-0000-0000-0000-0000000000a1', 'ad000000-0000-0000-0000-0000000000a1',
   'Attach Staff', 'staff', true),
  ('ad100000-0000-0000-0000-0000000000a2', 'ad000000-0000-0000-0000-0000000000a2',
   'Other Staff', 'staff', true);

create or replace function pg_temp.act_as(p_uid text)
returns void language plpgsql as $$
begin
  execute format('set local role authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
end $$;

-- ============================================================================
-- 1-2. The bucket is private and bounded.
-- ============================================================================
select is(
  (select public from storage.buckets where id = 'attachments'),
  false,
  'attachments bucket is PRIVATE — objects are reached only via a signed URL, never a public URL'
);
select ok(
  (select file_size_limit is not null and array_length(allowed_mime_types, 1) >= 1
   from storage.buckets where id = 'attachments'),
  'attachments bucket bounds size and restricts mime types at the edge'
);

-- ============================================================================
-- 3. RLS is enabled AND forced on the metadata table.
-- ============================================================================
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'attachments'),
  'attachments: RLS ENABLED and FORCED'
);

-- ============================================================================
-- 4-8. Named grants only — SELECT + INSERT, never UPDATE/DELETE; anon nothing.
-- ============================================================================
select ok(
  has_table_privilege('authenticated', 'public.attachments', 'select'),
  'attachments: SELECT granted to authenticated'
);
select ok(
  has_table_privilege('authenticated', 'public.attachments', 'insert'),
  'attachments: INSERT granted to authenticated'
);
select is(
  has_table_privilege('authenticated', 'public.attachments', 'update'),
  false,
  'attachments: UPDATE stays revoked — an attachment is immutable once recorded'
);
select is(
  has_table_privilege('authenticated', 'public.attachments', 'delete'),
  false,
  'attachments: DELETE stays revoked — no client erase path'
);
select is(
  has_table_privilege('anon', 'public.attachments', 'select'),
  false,
  'attachments: anon holds nothing'
);

-- ============================================================================
-- 9. No base64 bytes in a row — the table holds a path + metadata only.
-- ============================================================================
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'attachments'
     and data_type in ('bytea')),
  0,
  'attachments: no bytea column — image bytes live in Storage, never in a DB row'
);

-- ============================================================================
-- 10-12. Storage object policies exist for this bucket; no update/delete.
-- ============================================================================
select ok(
  exists (select 1 from pg_policies
          where schemaname = 'storage' and tablename = 'objects'
            and policyname = 'attachments_objects_read' and cmd = 'SELECT'),
  'storage.objects: a SELECT policy scopes the attachments bucket to active staff'
);
select ok(
  exists (select 1 from pg_policies
          where schemaname = 'storage' and tablename = 'objects'
            and policyname = 'attachments_objects_insert' and cmd = 'INSERT'),
  'storage.objects: an INSERT policy scopes the attachments bucket to active staff'
);
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'attachments_objects_%'
     and cmd in ('UPDATE', 'DELETE')),
  0,
  'storage.objects: we add NO update/delete policy — uploads are immutable'
);

-- ============================================================================
-- 13. An active staff member can record an attachment attributed to THEMSELVES.
-- ============================================================================
select pg_temp.act_as('ad000000-0000-0000-0000-0000000000a1');

select lives_ok(
  $$insert into public.attachments
      (storage_path, related_entity_type, related_entity_id, purpose,
       content_type, byte_size, source, uploaded_by)
    values
      ('customer/ad200000-0000-0000-0000-0000000000b1/one.jpg', 'customer',
       'ad200000-0000-0000-0000-0000000000b1', 'photo', 'image/jpeg', 2048,
       'camera', 'ad100000-0000-0000-0000-0000000000a1')$$,
  'active staff records an attachment attributed to themselves (RLS with-check passes)'
);

-- ============================================================================
-- 14. The SAME caller cannot attribute an upload to someone ELSE.
-- ============================================================================
select throws_ok(
  $$insert into public.attachments
      (storage_path, related_entity_type, related_entity_id, purpose,
       content_type, byte_size, source, uploaded_by)
    values
      ('customer/ad200000-0000-0000-0000-0000000000b1/forge.jpg', 'customer',
       'ad200000-0000-0000-0000-0000000000b1', 'photo', 'image/jpeg', 2048,
       'camera', 'ad100000-0000-0000-0000-0000000000a2')$$,
  '42501',
  null,
  'a caller CANNOT record an upload under another staff member''s name — with-check pins uploaded_by to the session'
);
reset role;

-- ============================================================================
-- 15. Another active staff member can READ the recorded attachment.
-- ============================================================================
select pg_temp.act_as('ad000000-0000-0000-0000-0000000000a2');
select is(
  (select count(*)::int from public.attachments
   where related_entity_type = 'customer'
     and related_entity_id = 'ad200000-0000-0000-0000-0000000000b1'),
  1,
  'another active staff member can read the attachment metadata (evidence is shared among staff)'
);
reset role;

-- ============================================================================
-- 16. anon cannot insert at all.
-- ============================================================================
set local role anon;
select throws_ok(
  $$insert into public.attachments
      (storage_path, related_entity_type, related_entity_id, purpose,
       content_type, byte_size, source, uploaded_by)
    values
      ('customer/x/anon.jpg', 'customer', 'ad200000-0000-0000-0000-0000000000b1',
       'photo', 'image/jpeg', 10, 'file_upload', 'ad100000-0000-0000-0000-0000000000a1')$$,
  '42501',
  null,
  'anon cannot insert an attachment — no privilege, no policy'
);
reset role;

select * from finish();
rollback;
