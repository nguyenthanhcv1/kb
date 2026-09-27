begin;

select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000002', 'admin@example.com'),
  ('00000000-0000-0000-0000-000000000003', 'editor@example.com'),
  ('00000000-0000-0000-0000-000000000004', 'viewer@example.com'),
  ('00000000-0000-0000-0000-000000000005', 'outsider@example.com'),
  ('00000000-0000-0000-0000-000000000006', 'guest@partner.test');

-- Internal users except the guest, who is a viewer of space A.
select set_config('request.jwt.claim.role', 'service_role', true);
update public.profiles set is_guest = (id = '00000000-0000-0000-0000-000000000006');
select set_config('request.jwt.claim.role', '', true);

insert into public.spaces (id, slug, name, visibility, created_by) values
  ('10000000-0000-0000-0000-00000000000a', 'space-a', 'A', 'restricted', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000b', 'space-b', 'B', 'restricted', '00000000-0000-0000-0000-000000000002');
insert into public.space_members (space_id, user_id, role, added_by) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000003', 'editor', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', 'viewer', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000006', 'viewer', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000005', 'viewer', '00000000-0000-0000-0000-000000000002');
insert into public.pages (id, space_id, position, title, created_by) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'V', 'Page A', '00000000-0000-0000-0000-000000000003'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000b', 'V', 'Page B', '00000000-0000-0000-0000-000000000002');

select is(
  (select row(public, file_size_limit)::text from storage.buckets where id = 'attachments'),
  '(f,26214400)',
  'bucket attachments is private with a 25 MB limit'
);
select ok(
  (select not ('image/svg+xml' = any (allowed_mime_types)) from storage.buckets where id = 'attachments'),
  'SVG is not an allowed MIME type'
);

-- ---------------------------------------------------------------- editor
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

select lives_ok($$
  insert into public.attachments (id, page_id, storage_path, file_name, mime_type, size_bytes, width, height)
  values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
          '10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001-anh.png',
          'ảnh.png', 'image/png', 1024, 640, 480)
$$, 'editor declares an attachment on a page of their Space');
select is(
  (select row(space_id, uploaded_by)::text from public.attachments where id = '30000000-0000-0000-0000-000000000001'),
  '(10000000-0000-0000-0000-00000000000a,00000000-0000-0000-0000-000000000003)',
  'space_id and uploaded_by are filled in'
);
select throws_ok($$
  insert into public.attachments (page_id, storage_path, file_name, mime_type, size_bytes)
  values ('20000000-0000-0000-0000-000000000001',
          '10000000-0000-0000-0000-00000000000b/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000002-x.png',
          'x.png', 'image/png', 1)
$$, '23514', 'ATTACHMENT_PATH_INVALID', 'object key must start with the page''s Space and page');
select throws_ok($$
  insert into public.attachments (page_id, storage_path, file_name, mime_type, size_bytes)
  values ('20000000-0000-0000-0000-000000000001',
          '10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000003-big.zip',
          'big.zip', 'application/zip', 26214401)
$$, '23514', null, 'files over 25 MB are rejected');
select throws_ok($$
  insert into public.attachments (page_id, storage_path, file_name, mime_type, size_bytes)
  values ('20000000-0000-0000-0000-000000000002',
          '10000000-0000-0000-0000-00000000000b/20000000-0000-0000-0000-000000000002/40000000-0000-0000-0000-000000000004-x.png',
          'x.png', 'image/png', 1)
$$, '42501', null, 'editor cannot attach to a page of another Space');
select throws_ok($$
  insert into public.attachments (page_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values ('20000000-0000-0000-0000-000000000001',
          '10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000005-x.png',
          'x.png', 'image/png', 1, '00000000-0000-0000-0000-000000000002')
$$, '42501', null, 'uploaded_by must be the caller');

-- Upload of the declared object (what the Storage API inserts on the user's behalf).
select lives_ok($$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('attachments',
          '10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001-anh.png',
          '00000000-0000-0000-0000-000000000003')
$$, 'editor uploads the object they declared');
select throws_ok($$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('attachments',
          '10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-00000000000f-undeclared.png',
          '00000000-0000-0000-0000-000000000003')
$$, '42501', null, 'undeclared objects cannot be uploaded');
select throws_ok($$ update public.attachments set file_name = 'x' $$, '42501', null,
  'attachment metadata cannot be changed');

-- ---------------------------------------------------------------- viewer / guest
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is((select count(*)::int from public.attachments), 1, 'viewer sees the attachments of their Space');
select is((select count(*)::int from storage.objects where bucket_id = 'attachments'), 1,
  'viewer can read the object');
select throws_ok($$
  insert into public.attachments (page_id, storage_path, file_name, mime_type, size_bytes)
  values ('20000000-0000-0000-0000-000000000001',
          '10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000006-x.png',
          'x.png', 'image/png', 1)
$$, '42501', null, 'viewer cannot declare attachments');
select is_empty($$ update public.attachments set deleted_at = now() returning id $$,
  'viewer cannot delete attachments');
-- Storage forbids direct DELETE on its tables; check the delete policy's helper instead.
select is(
  app.attachment_object_role('10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001-anh.png'),
  'viewer'::public.space_role,
  'viewer is not allowed by the object delete policy (editors and admins only)'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is((select count(*)::int from storage.objects where bucket_id = 'attachments'), 1,
  'guest viewer of the Space can read the object');

-- ---------------------------------------------------------------- outsider (viewer of another Space)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select is_empty($$ select 1 from public.attachments $$, 'viewer of another Space sees no attachment rows');
select is_empty($$ select 1 from storage.objects where bucket_id = 'attachments' $$,
  'viewer of another Space cannot read the object');

-- ---------------------------------------------------------------- moves and soft delete
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
update public.pages set space_id = '10000000-0000-0000-0000-00000000000b'
where id = '20000000-0000-0000-0000-000000000001';
select is(
  (select space_id from public.attachments where id = '30000000-0000-0000-0000-000000000001'),
  '10000000-0000-0000-0000-00000000000b'::uuid,
  'attachments follow their page to another Space'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select is((select count(*)::int from storage.objects where bucket_id = 'attachments'), 1,
  'members of the new Space can read the moved page''s files');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is_empty($$ select 1 from storage.objects where bucket_id = 'attachments' $$,
  'members of the old Space lose access after the move');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
update public.attachments set deleted_at = now() where id = '30000000-0000-0000-0000-000000000001';
select is_empty($$ select 1 from storage.objects where bucket_id = 'attachments' $$,
  'a deleted attachment grants no access to its object');
reset role;

set local role anon;
select throws_ok($$ select * from public.attachments $$, '42501', null, 'anon cannot read attachments');
reset role;

select * from finish();

rollback;
