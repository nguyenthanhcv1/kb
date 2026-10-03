-- T7.1a: role × operation RLS matrix for the content tables (pages, page_documents,
-- page_search, attachments + their storage objects, page_versions, rate_limit_hits) and the kb_collab
-- role, plus catalog-level guards (anon has nothing, every client grant has a policy).
--
-- Roles: 1 super admin, 2 Space admin (A and B), 3 editor of A, 4 viewer of A, 5 internal user who is
-- no member of A, 6 guest who is a viewer of A, 7 guest outside every Space, 8 deactivated user
-- who is still an editor of A, plus anon, service_role and kb_collab. Space A is restricted,
-- Space B internal. Pages: P1, P2 live and P3 in the trash of A; P4 live in B.
--
-- Convention: a statement the table grants refuse raises 42501 (permission denied); a statement
-- the grant allows but RLS hides touches 0 rows (UPDATE/DELETE/SELECT) or raises 42501 with
-- "violates row-level security policy" (INSERT). `rls_rows` returns the number of rows a
-- statement saw or changed, as the calling role.
begin;

select plan(171);

create function extensions.rls_rows(p_sql text) returns bigint
language plpgsql
as $$
declare
  v_rows bigint;
begin
  execute p_sql;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- Like rls_rows, but a permission error counts as "saw nothing" (Supabase grants anon table
-- privileges on storage.objects that its policies then refuse, so the error depends on the platform).
create function extensions.rls_seen(p_sql text) returns bigint
language plpgsql
as $$
begin
  return extensions.rls_rows(p_sql);
exception when insufficient_privilege then
  return 0;
end;
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'super@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'admin@example.com'),
  ('00000000-0000-0000-0000-000000000003', 'editor@example.com'),
  ('00000000-0000-0000-0000-000000000004', 'viewer@example.com'),
  ('00000000-0000-0000-0000-000000000005', 'internal@example.com'),
  ('00000000-0000-0000-0000-000000000006', 'guest@example.net'),
  ('00000000-0000-0000-0000-000000000007', 'guest-outside@example.net'),
  ('00000000-0000-0000-0000-000000000008', 'deactivated@example.com');

select set_config('request.jwt.claim.role', 'service_role', true);
update public.profiles as p set
  is_guest = v.is_guest,
  is_super_admin = v.is_super_admin,
  deactivated_at = v.deactivated_at
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid, false, true, null::timestamptz),
  ('00000000-0000-0000-0000-000000000002'::uuid, false, false, null::timestamptz),
  ('00000000-0000-0000-0000-000000000003'::uuid, false, false, null::timestamptz),
  ('00000000-0000-0000-0000-000000000004'::uuid, false, false, null::timestamptz),
  ('00000000-0000-0000-0000-000000000005'::uuid, false, false, null::timestamptz),
  ('00000000-0000-0000-0000-000000000006'::uuid, true, false, null::timestamptz),
  ('00000000-0000-0000-0000-000000000007'::uuid, true, false, null::timestamptz),
  ('00000000-0000-0000-0000-000000000008'::uuid, false, false, now())
) as v(id, is_guest, is_super_admin, deactivated_at)
where p.id = v.id;
select set_config('request.jwt.claim.role', '', true);

insert into public.spaces (id, slug, name, visibility, created_by) values
  ('10000000-0000-0000-0000-00000000000a', 'space-a', 'A', 'restricted', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000b', 'space-b', 'B', 'internal', '00000000-0000-0000-0000-000000000002');
insert into public.space_members (space_id, user_id, role, added_by) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000003', 'editor', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', 'viewer', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000006', 'viewer', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000008', 'editor', '00000000-0000-0000-0000-000000000002');

insert into public.pages (id, space_id, position, title, created_by) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'a0', 'P1', '00000000-0000-0000-0000-000000000003'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a', 'a1', 'P2', '00000000-0000-0000-0000-000000000003'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-00000000000a', 'a2', 'P3', '00000000-0000-0000-0000-000000000003'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-00000000000b', 'a0', 'P4', '00000000-0000-0000-0000-000000000002');
update public.pages set deleted_at = now() where id = '20000000-0000-0000-0000-000000000003';

insert into public.attachments (id, page_id, storage_path, file_name, mime_type, size_bytes, uploaded_by) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001-a.png',
   'a.png', 'image/png', 10, '00000000-0000-0000-0000-000000000003'),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004',
   '10000000-0000-0000-0000-00000000000b/20000000-0000-0000-0000-000000000004/40000000-0000-0000-0000-000000000004-b.png',
   'b.png', 'image/png', 10, '00000000-0000-0000-0000-000000000002');
insert into storage.objects (bucket_id, name, owner_id) values
  ('attachments', '10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001-a.png', '00000000-0000-0000-0000-000000000003'),
  ('attachments', '10000000-0000-0000-0000-00000000000b/20000000-0000-0000-0000-000000000004/40000000-0000-0000-0000-000000000004-b.png', '00000000-0000-0000-0000-000000000002');

insert into public.page_versions (page_id, ydoc_update, content_json, schema_version, reason) values
  ('20000000-0000-0000-0000-000000000001', '\x0000', '{"type": "doc", "content": []}', 1, 'auto'),
  ('20000000-0000-0000-0000-000000000004', '\x0000', '{"type": "doc", "content": []}', 1, 'auto');

grant usage on schema extensions to kb_collab;

-- ================================================================ anon
-- Nothing of the content is reachable without signing in.
set local role anon;
select throws_ok($$ select 1 from public.pages $$, '42501', null, 'anon cannot select pages');
select throws_ok($$ select 1 from public.page_documents $$, '42501', null, 'anon cannot select page_documents');
select throws_ok($$ select 1 from public.page_search $$, '42501', null, 'anon cannot select page_search');
select throws_ok($$ select 1 from public.attachments $$, '42501', null, 'anon cannot select attachments');
select throws_ok($$ select 1 from public.page_versions $$, '42501', null, 'anon cannot select page_versions');
select throws_ok($$ insert into public.pages (space_id, position, title) values ('10000000-0000-0000-0000-00000000000a', 'z', 'x') $$, '42501', null, 'anon cannot insert pages');
select throws_ok($$ update public.pages set title = 'x' $$, '42501', null, 'anon cannot update pages');
select throws_ok($$ delete from public.pages $$, '42501', null, 'anon cannot delete pages');
select throws_ok($$ select 1 from app.rate_limit_hits $$, '42501', null, 'anon cannot read the rate limit counters');
select is(
  extensions.rls_seen($$ select 1 from storage.objects where bucket_id = 'attachments' $$), 0::bigint,
  'anon reads no attachment object'
);

-- ================================================================ pages: SELECT
-- Live pages follow the Space role; a trashed page is only visible to editors and admins.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is(extensions.rls_rows($$ select 1 from public.pages $$), 4::bigint, 'super admin sees every page, trash included');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select is(extensions.rls_rows($$ select 1 from public.pages $$), 4::bigint, 'Space admin sees every page, trash included');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is(extensions.rls_rows($$ select 1 from public.pages $$), 4::bigint, 'editor sees the trash of their Space and the internal Space');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select results_eq(
  $$ select title from public.pages order by title $$,
  array['P1', 'P2', 'P4'],
  'viewer sees live pages only (no trash)'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select results_eq($$ select title from public.pages $$, array['P4'], 'internal non-member sees only the internal Space');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select results_eq(
  $$ select title from public.pages order by title $$,
  array['P1', 'P2'],
  'guest sees the live pages of their Space, not the internal Space'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select is(extensions.rls_rows($$ select 1 from public.pages $$), 0::bigint, 'guest outside every Space sees no page');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select is(extensions.rls_rows($$ select 1 from public.pages $$), 0::bigint, 'deactivated editor sees no page');

-- ================================================================ page_documents: SELECT
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is(extensions.rls_rows($$ select page_id, content_json, content_text from public.page_documents $$), 4::bigint, 'super admin reads every document');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is(extensions.rls_rows($$ select page_id, content_json, content_text from public.page_documents $$), 4::bigint, 'editor reads the documents of live and trashed pages');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is(extensions.rls_rows($$ select page_id, content_json, content_text from public.page_documents $$), 3::bigint, 'viewer reads no trashed document');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select is(extensions.rls_rows($$ select page_id, content_json, content_text from public.page_documents $$), 1::bigint, 'internal non-member reads the internal Space document only');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is(extensions.rls_rows($$ select page_id, content_json, content_text from public.page_documents $$), 2::bigint, 'guest reads the live documents of their Space');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select is(extensions.rls_rows($$ select page_id, content_json, content_text from public.page_documents $$), 0::bigint, 'guest outside every Space reads no document');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select is(extensions.rls_rows($$ select page_id, content_json, content_text from public.page_documents $$), 0::bigint, 'deactivated editor reads no document');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select throws_ok($$ select ydoc from public.page_documents $$, '42501', null, 'not even a super admin reads the Yjs state');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select throws_ok($$ select ydoc from public.page_documents $$, '42501', null, 'editor cannot read the Yjs state');

-- ================================================================ page_documents: writes (kb-collab only)
select throws_ok($$ update public.page_documents set content_text = 'x' $$, '42501', null, 'editor cannot write document content');
select throws_ok($$ insert into public.page_documents (page_id) values ('20000000-0000-0000-0000-000000000001') $$, '42501', null, 'editor cannot insert a document');
select throws_ok($$ delete from public.page_documents $$, '42501', null, 'editor cannot delete a document');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select throws_ok($$ update public.page_documents set content_text = 'x' $$, '42501', null, 'Space admin cannot write document content');
select throws_ok($$ delete from public.page_documents $$, '42501', null, 'Space admin cannot delete a document');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select throws_ok($$ update public.page_documents set ydoc = '\x0001' $$, '42501', null, 'super admin cannot write the Yjs state');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select throws_ok($$ update public.page_documents set content_text = 'x' $$, '42501', null, 'guest cannot write document content');

-- ================================================================ page_search
-- A search row is visible when its page is live and in a viewable Space.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is(extensions.rls_rows($$ select 1 from public.page_search $$), 3::bigint, 'super admin finds the live pages');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is(extensions.rls_rows($$ select 1 from public.page_search $$), 3::bigint, 'editor does not find trashed pages');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is(extensions.rls_rows($$ select 1 from public.page_search $$), 3::bigint, 'viewer finds the live pages');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select is(extensions.rls_rows($$ select 1 from public.page_search $$), 1::bigint, 'internal non-member finds the internal Space page only');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is(extensions.rls_rows($$ select 1 from public.page_search $$), 2::bigint, 'guest finds the pages of their Space only');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select is(extensions.rls_rows($$ select 1 from public.page_search $$), 0::bigint, 'guest outside every Space finds nothing');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select is(extensions.rls_rows($$ select 1 from public.page_search $$), 0::bigint, 'deactivated editor finds nothing');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select throws_ok($$ insert into public.page_search (page_id, space_id) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a') $$, '42501', null, 'Space admin cannot insert into the search index');
select throws_ok($$ update public.page_search set title = 'x' $$, '42501', null, 'Space admin cannot update the search index');
select throws_ok($$ delete from public.page_search $$, '42501', null, 'Space admin cannot delete from the search index');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select throws_ok($$ delete from public.page_search $$, '42501', null, 'super admin cannot delete from the search index');

-- ================================================================ attachments: SELECT
select is(extensions.rls_rows($$ select 1 from public.attachments $$), 2::bigint, 'super admin sees every attachment');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is(extensions.rls_rows($$ select 1 from public.attachments $$), 2::bigint, 'editor sees the attachments of their Space and the internal one');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is(extensions.rls_rows($$ select 1 from public.attachments $$), 2::bigint, 'viewer sees the attachments of their Space and the internal one');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select is(extensions.rls_rows($$ select 1 from public.attachments $$), 1::bigint, 'internal non-member sees only the internal Space attachment');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is(extensions.rls_rows($$ select 1 from public.attachments $$), 1::bigint, 'guest sees the attachments of their Space only');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select is(extensions.rls_rows($$ select 1 from public.attachments $$), 0::bigint, 'guest outside every Space sees no attachment');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select is(extensions.rls_rows($$ select 1 from public.attachments $$), 0::bigint, 'deactivated editor sees no attachment');

-- ================================================================ storage.objects (bucket attachments)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select results_eq(
  $$ select name from storage.objects where bucket_id = 'attachments' $$,
  array['10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001-a.png'],
  'guest reads the objects of their Space only'
);
select is(extensions.rls_rows($$ select 1 from storage.objects where bucket_id = 'attachments' $$), 1::bigint, 'guest sees one object');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select is(extensions.rls_rows($$ select 1 from storage.objects where bucket_id = 'attachments' $$), 0::bigint, 'guest outside every Space reads no object');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select is(extensions.rls_rows($$ select 1 from storage.objects where bucket_id = 'attachments' $$), 0::bigint, 'deactivated editor reads no object');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select is(extensions.rls_rows($$ select 1 from storage.objects where bucket_id = 'attachments' $$), 1::bigint, 'internal non-member reads the object of the internal Space only');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is(extensions.rls_rows($$ select 1 from storage.objects where bucket_id = 'attachments' $$), 2::bigint, 'editor reads the objects of both Spaces');
select is(
  extensions.rls_rows($$ update storage.objects set name = name || 'x' where bucket_id = 'attachments' $$), 0::bigint,
  'objects cannot be overwritten or renamed (no UPDATE policy), even by an editor'
);
select is(extensions.rls_seen($$ select 1 from storage.objects where bucket_id = 'attachments' $$), 2::bigint, 'the editor''s objects were untouched');

-- Upload: only the declared path, only by the editor who declared it.
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('attachments',
     '10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-0000000000ff-undeclared.png',
     '00000000-0000-0000-0000-000000000003') $$,
  '42501', null, 'editor cannot upload an undeclared path'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('attachments',
     '10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001-a.png',
     '00000000-0000-0000-0000-000000000004') $$,
  '42501', null, 'viewer cannot upload to the declared path of an editor'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('attachments',
     '10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001-a.png',
     '00000000-0000-0000-0000-000000000006') $$,
  '42501', null, 'guest cannot upload to a declared path'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('attachments',
     '10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001-a.png',
     '00000000-0000-0000-0000-000000000008') $$,
  '42501', null, 'deactivated editor cannot upload'
);

-- Delete policy (storage forbids direct DELETE): its helper must give editors and admins only.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is(app.attachment_object_role('10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001-a.png'), 'editor'::public.space_role, 'editor may delete objects of their Space');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is(app.attachment_object_role('10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001-a.png'), 'viewer'::public.space_role, 'guest viewer may not delete objects (viewer role)');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select is(app.attachment_object_role('10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001-a.png'), null::public.space_role, 'outsider guest has no role on the object');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select is(app.attachment_object_role('10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001-a.png'), null::public.space_role, 'deactivated editor has no role on the object');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is(app.attachment_object_role('10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001-a.png'), 'admin'::public.space_role, 'super admin may delete any object');

-- ================================================================ page_versions: SELECT
select is(extensions.rls_rows($$ select id, page_id, content_json from public.page_versions $$), 2::bigint, 'super admin reads every version');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is(extensions.rls_rows($$ select id, page_id, content_json from public.page_versions $$), 2::bigint, 'editor reads the history of both Spaces');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is(extensions.rls_rows($$ select id, page_id, content_json from public.page_versions $$), 2::bigint, 'viewer reads the history of live pages');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select is(extensions.rls_rows($$ select id, page_id, content_json from public.page_versions $$), 1::bigint, 'internal non-member reads the internal Space history only');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is(extensions.rls_rows($$ select id, page_id, content_json from public.page_versions $$), 1::bigint, 'guest reads the history of their Space only');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select is(extensions.rls_rows($$ select id, page_id, content_json from public.page_versions $$), 0::bigint, 'guest outside every Space reads no history');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select is(extensions.rls_rows($$ select id, page_id, content_json from public.page_versions $$), 0::bigint, 'deactivated editor reads no history');

-- ================================================================ page_versions: writes (kb-collab only)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select throws_ok($$ select ydoc_update from public.page_versions $$, '42501', null, 'editor cannot read the Yjs state of a version');
select throws_ok($$ insert into public.page_versions (page_id, ydoc_update, content_json, schema_version, reason) values ('20000000-0000-0000-0000-000000000001', '\x0000', '{}', 1, 'manual') $$, '42501', null, 'editor cannot insert a version');
select throws_ok($$ update public.page_versions set label = 'x' $$, '42501', null, 'editor cannot update a version');
select throws_ok($$ delete from public.page_versions $$, '42501', null, 'editor cannot delete a version');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select throws_ok($$ insert into public.page_versions (page_id, ydoc_update, content_json, schema_version, reason) values ('20000000-0000-0000-0000-000000000001', '\x0000', '{}', 1, 'manual') $$, '42501', null, 'Space admin cannot insert a version');
select throws_ok($$ delete from public.page_versions $$, '42501', null, 'Space admin cannot delete a version');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select throws_ok($$ update public.page_versions set label = 'x' $$, '42501', null, 'super admin cannot update a version');
select throws_ok($$ delete from public.page_versions $$, '42501', null, 'super admin cannot delete a version');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select throws_ok($$ insert into public.page_versions (page_id, ydoc_update, content_json, schema_version, reason) values ('20000000-0000-0000-0000-000000000001', '\x0000', '{}', 1, 'manual') $$, '42501', null, 'guest cannot insert a version');
set local role service_role;
select throws_ok($$ select 1 from public.page_versions $$, '42501', null, 'service_role has no grant on page_versions');
select throws_ok($$ delete from public.page_versions $$, '42501', null, 'service_role cannot delete versions');

-- ================================================================ rate_limit_hits
-- No client role touches the counters: only SECURITY DEFINER functions do.
select throws_ok($$ select 1 from app.rate_limit_hits $$, '42501', null, 'service_role cannot read the rate limit counters');
select throws_ok($$ delete from app.rate_limit_hits $$, '42501', null, 'service_role cannot reset the rate limit counters');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select throws_ok($$ select 1 from app.rate_limit_hits $$, '42501', null, 'super admin cannot read the rate limit counters');
select throws_ok($$ insert into app.rate_limit_hits (bucket, subject, window_start, hits) values ('x', gen_random_uuid(), now(), 0) $$, '42501', null, 'super admin cannot write the rate limit counters');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select throws_ok($$ update app.rate_limit_hits set hits = 0 $$, '42501', null, 'editor cannot reset the rate limit counters');
set local role kb_collab;
select throws_ok($$ select 1 from app.rate_limit_hits $$, '42501', null, 'kb_collab cannot read the rate limit counters');

-- ================================================================ kb_collab
-- Reads every page row and writes document content, nothing else.
set local search_path = public, extensions;
select is(extensions.rls_rows($$ select id, space_id, title, deleted_at from public.pages $$), 4::bigint, 'kb_collab reads every page, trash included');
select is(extensions.rls_rows($$ select page_id, ydoc, content_json from public.page_documents $$), 4::bigint, 'kb_collab reads every document, Yjs state included');
select is(
  extensions.rls_rows($$ update public.page_documents set content_text = 'collab', word_count = 1 where page_id = '20000000-0000-0000-0000-000000000001' $$),
  1::bigint, 'kb_collab writes document content'
);
select is(
  extensions.rls_rows($$ update public.pages set last_edited_at = now() where id = '20000000-0000-0000-0000-000000000001' $$),
  1::bigint, 'kb_collab bumps last_edited_at'
);
select throws_ok($$ select slug from public.pages $$, '42501', null, 'kb_collab cannot read page columns it was not granted');
select throws_ok($$ update public.pages set title = 'x' $$, '42501', null, 'kb_collab cannot rename pages');
select throws_ok($$ update public.pages set deleted_at = null $$, '42501', null, 'kb_collab cannot restore pages from the trash');
select throws_ok($$ insert into public.pages (space_id, position, title) values ('10000000-0000-0000-0000-00000000000a', 'z', 'x') $$, '42501', null, 'kb_collab cannot create pages');
select throws_ok($$ delete from public.pages $$, '42501', null, 'kb_collab cannot delete pages');
select throws_ok($$ update public.page_documents set page_id = gen_random_uuid() $$, '42501', null, 'kb_collab cannot re-point a document');
select throws_ok($$ insert into public.page_documents (page_id) values (gen_random_uuid()) $$, '42501', null, 'kb_collab cannot insert documents');
select throws_ok($$ delete from public.page_documents $$, '42501', null, 'kb_collab cannot delete documents');
select throws_ok($$ select 1 from public.attachments $$, '42501', null, 'kb_collab cannot read attachments');
select throws_ok($$ select 1 from public.page_search $$, '42501', null, 'kb_collab cannot read the search index');
select set_config('app.actor_id', '00000000-0000-0000-0000-000000000003', true);
select lives_ok(
  $$ insert into public.page_versions (page_id, ydoc_update, content_json, schema_version, reason)
     values ('20000000-0000-0000-0000-000000000001', '\x0000', '{"type": "doc", "content": []}', 1, 'manual') $$,
  'kb_collab writes a version snapshot'
);
select is(extensions.rls_rows($$ select ydoc_update from public.page_versions $$), 3::bigint, 'kb_collab reads every version, Yjs state included');
select throws_ok($$ update public.page_versions set label = 'x' $$, '42501', null, 'kb_collab cannot update a version');
select throws_ok($$ delete from public.page_versions $$, '42501', null, 'kb_collab cannot delete a version');

-- ================================================================ pages: INSERT / UPDATE / DELETE
reset role;
set local role authenticated;

-- INSERT
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select lives_ok($$ insert into public.pages (space_id, position, title) values ('10000000-0000-0000-0000-00000000000a', 'b0', 'by editor') $$, 'editor creates a page in their Space');
select throws_ok($$ insert into public.pages (space_id, position, title) values ('10000000-0000-0000-0000-00000000000b', 'b0', 'x') $$, '42501', null, 'editor of A (viewer of B) cannot create a page in the internal Space B');
select throws_ok($$ insert into public.pages (space_id, position, title, created_by) values ('10000000-0000-0000-0000-00000000000a', 'b1', 'x', '00000000-0000-0000-0000-000000000002') $$, '42501', null, 'a page cannot be created in somebody else''s name');
select throws_ok($$ insert into public.pages (space_id, position, title, slug) values ('10000000-0000-0000-0000-00000000000a', 'b2', 'x', 'forced') $$, '42501', null, 'slug is not client-writable');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select throws_ok($$ insert into public.pages (space_id, position, title) values ('10000000-0000-0000-0000-00000000000a', 'b3', 'x') $$, '42501', null, 'viewer cannot create a page');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select throws_ok($$ insert into public.pages (space_id, position, title) values ('10000000-0000-0000-0000-00000000000a', 'b4', 'x') $$, '42501', null, 'internal non-member cannot create a page in a restricted Space');
select throws_ok($$ insert into public.pages (space_id, position, title) values ('10000000-0000-0000-0000-00000000000b', 'b5', 'x') $$, '42501', null, 'implicit viewer of an internal Space cannot create a page');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select throws_ok($$ insert into public.pages (space_id, position, title) values ('10000000-0000-0000-0000-00000000000a', 'b6', 'x') $$, '42501', null, 'guest viewer cannot create a page');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select throws_ok($$ insert into public.pages (space_id, position, title) values ('10000000-0000-0000-0000-00000000000a', 'b7', 'x') $$, '42501', null, 'guest outside every Space cannot create a page');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select throws_ok($$ insert into public.pages (space_id, position, title) values ('10000000-0000-0000-0000-00000000000a', 'b8', 'x') $$, '42501', null, 'deactivated editor cannot create a page');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select lives_ok($$ insert into public.pages (space_id, position, title) values ('10000000-0000-0000-0000-00000000000a', 'b9', 'by admin') $$, 'Space admin creates a page');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select lives_ok($$ insert into public.pages (space_id, position, title) values ('10000000-0000-0000-0000-00000000000b', 'c0', 'by super') $$, 'super admin creates a page in any Space');

-- UPDATE
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is(extensions.rls_rows($$ update public.pages set title = 'P1 edited' where id = '20000000-0000-0000-0000-000000000001' $$), 1::bigint, 'editor renames a page');
select is(extensions.rls_rows($$ update public.pages set title = 'P4 edited' where id = '20000000-0000-0000-0000-000000000004' $$), 0::bigint, 'editor of A cannot rename a page of the internal Space B');
select throws_ok($$ update public.pages set slug = 'forced' where id = '20000000-0000-0000-0000-000000000001' $$, '42501', null, 'slug is not client-writable');
select throws_ok($$ update public.pages set created_by = '00000000-0000-0000-0000-000000000002' where id = '20000000-0000-0000-0000-000000000001' $$, '42501', null, 'created_by is not client-writable');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is(extensions.rls_rows($$ update public.pages set title = 'Hacked' where id = '20000000-0000-0000-0000-000000000001' $$), 0::bigint, 'viewer cannot rename a page');
select is(extensions.rls_rows($$ update public.pages set deleted_at = now() where id = '20000000-0000-0000-0000-000000000002' $$), 0::bigint, 'viewer cannot trash a page');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select is(extensions.rls_rows($$ update public.pages set title = 'Hacked' where id = '20000000-0000-0000-0000-000000000001' $$), 0::bigint, 'internal non-member cannot rename a page of a restricted Space');
select is(extensions.rls_rows($$ update public.pages set title = 'Hacked' where id = '20000000-0000-0000-0000-000000000004' $$), 0::bigint, 'implicit viewer cannot rename a page of an internal Space');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is(extensions.rls_rows($$ update public.pages set title = 'Hacked' where id = '20000000-0000-0000-0000-000000000001' $$), 0::bigint, 'guest viewer cannot rename a page');
select is(extensions.rls_rows($$ update public.pages set deleted_at = now() where id = '20000000-0000-0000-0000-000000000002' $$), 0::bigint, 'guest viewer cannot trash a page');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select is(extensions.rls_rows($$ update public.pages set title = 'Hacked' $$), 0::bigint, 'guest outside every Space cannot rename any page');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select is(extensions.rls_rows($$ update public.pages set title = 'Hacked' where id = '20000000-0000-0000-0000-000000000001' $$), 0::bigint, 'deactivated editor cannot rename a page');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select is(extensions.rls_rows($$ update public.pages set title = 'P1 by admin' where id = '20000000-0000-0000-0000-000000000001' $$), 1::bigint, 'Space admin renames a page');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is(extensions.rls_rows($$ update public.pages set title = 'P4 by super' where id = '20000000-0000-0000-0000-000000000004' $$), 1::bigint, 'super admin renames a page in any Space');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is(extensions.rls_rows($$ update public.pages set deleted_at = now() where id = '20000000-0000-0000-0000-000000000002' $$), 1::bigint, 'editor moves a page to the trash');
select is(extensions.rls_rows($$ update public.pages set deleted_at = null where id = '20000000-0000-0000-0000-000000000003' $$), 1::bigint, 'editor restores a page from the trash');

-- DELETE (purge): Space admins, trashed pages only.
select is(extensions.rls_rows($$ delete from public.pages where id = '20000000-0000-0000-0000-000000000002' $$), 0::bigint, 'editor cannot purge a trashed page');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is(extensions.rls_rows($$ delete from public.pages where id = '20000000-0000-0000-0000-000000000001' $$), 0::bigint, 'viewer cannot delete a page');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is(extensions.rls_rows($$ delete from public.pages where id = '20000000-0000-0000-0000-000000000001' $$), 0::bigint, 'guest viewer cannot delete a page');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select is(extensions.rls_rows($$ delete from public.pages where id = '20000000-0000-0000-0000-000000000004' $$), 0::bigint, 'internal non-member cannot delete a page');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select is(extensions.rls_rows($$ delete from public.pages where id = '20000000-0000-0000-0000-000000000002' $$), 0::bigint, 'deactivated editor cannot purge a trashed page');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select throws_ok($$ delete from public.pages where id = '20000000-0000-0000-0000-000000000001' $$, '23514', 'PAGE_NOT_IN_TRASH', 'Space admin cannot purge a live page');
select is(extensions.rls_rows($$ delete from public.pages where id = '20000000-0000-0000-0000-000000000002' $$), 1::bigint, 'Space admin purges a trashed page');

-- ================================================================ attachments: INSERT / UPDATE / DELETE
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select lives_ok(
  $$ insert into public.attachments (page_id, storage_path, file_name, mime_type, size_bytes)
     values ('20000000-0000-0000-0000-000000000001',
             '10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000011-e.png',
             'e.png', 'image/png', 5) $$,
  'editor declares an attachment'
);
select throws_ok(
  $$ insert into public.attachments (page_id, storage_path, file_name, mime_type, size_bytes)
     values ('20000000-0000-0000-0000-000000000004',
             '10000000-0000-0000-0000-00000000000b/20000000-0000-0000-0000-000000000004/40000000-0000-0000-0000-000000000012-e.png',
             'e.png', 'image/png', 5) $$,
  '42501', null, 'editor of A cannot attach a file to a page of the internal Space B'
);
select throws_ok(
  $$ insert into public.attachments (page_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
     values ('20000000-0000-0000-0000-000000000001',
             '10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000013-e.png',
             'e.png', 'image/png', 5, '00000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'uploaded_by must be the caller'
);
select is(extensions.rls_rows($$ update public.attachments set deleted_at = now() where id = '30000000-0000-0000-0000-000000000001' $$), 1::bigint, 'editor soft-deletes an attachment');
select throws_ok($$ update public.attachments set file_name = 'x' $$, '42501', null, 'editor cannot edit attachment metadata');
select throws_ok($$ delete from public.attachments $$, '42501', null, 'editor cannot hard-delete attachments');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select throws_ok(
  $$ insert into public.attachments (page_id, storage_path, file_name, mime_type, size_bytes)
     values ('20000000-0000-0000-0000-000000000001',
             '10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000014-v.png',
             'v.png', 'image/png', 5) $$,
  '42501', null, 'viewer cannot declare an attachment'
);
select is(extensions.rls_rows($$ update public.attachments set deleted_at = now() $$), 0::bigint, 'viewer cannot delete attachments');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select throws_ok(
  $$ insert into public.attachments (page_id, storage_path, file_name, mime_type, size_bytes)
     values ('20000000-0000-0000-0000-000000000001',
             '10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000015-o.png',
             'o.png', 'image/png', 5) $$,
  '42501', null, 'internal non-member cannot declare an attachment in a restricted Space'
);
select is(extensions.rls_rows($$ update public.attachments set deleted_at = now() $$), 0::bigint, 'implicit viewer cannot delete the attachment of an internal Space');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select throws_ok(
  $$ insert into public.attachments (page_id, storage_path, file_name, mime_type, size_bytes)
     values ('20000000-0000-0000-0000-000000000001',
             '10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000016-g.png',
             'g.png', 'image/png', 5) $$,
  '42501', null, 'guest viewer cannot declare an attachment'
);
select is(extensions.rls_rows($$ update public.attachments set deleted_at = now() $$), 0::bigint, 'guest viewer cannot delete attachments');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select throws_ok(
  $$ insert into public.attachments (page_id, storage_path, file_name, mime_type, size_bytes)
     values ('20000000-0000-0000-0000-000000000001',
             '10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000017-g.png',
             'g.png', 'image/png', 5) $$,
  '42501', null, 'guest outside every Space cannot declare an attachment'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select throws_ok(
  $$ insert into public.attachments (page_id, storage_path, file_name, mime_type, size_bytes)
     values ('20000000-0000-0000-0000-000000000001',
             '10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000018-d.png',
             'd.png', 'image/png', 5) $$,
  '42501', null, 'deactivated editor cannot declare an attachment'
);
select is(extensions.rls_rows($$ update public.attachments set deleted_at = null $$), 0::bigint, 'deactivated editor cannot restore attachments');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$ insert into public.attachments (page_id, storage_path, file_name, mime_type, size_bytes)
     values ('20000000-0000-0000-0000-000000000001',
             '10000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000019-a.png',
             'a2.png', 'image/png', 5) $$,
  'Space admin declares an attachment'
);
select is(extensions.rls_rows($$ update public.attachments set deleted_at = null where id = '30000000-0000-0000-0000-000000000001' $$), 1::bigint, 'Space admin restores an attachment');
select throws_ok($$ delete from public.attachments $$, '42501', null, 'Space admin cannot hard-delete attachments');

-- ================================================================ catalog guards
reset role;

-- A table reachable by anon is a leak, whatever the policies say.
select is_empty(
  $$ select c.oid::regclass::text
     from pg_catalog.pg_class as c
     join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
     where n.nspname in ('public', 'app') and c.relkind in ('r', 'p', 'v', 'm')
       and (has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger')
            or has_any_column_privilege('anon', c.oid, 'select, insert, update, references'))
     order by 1 $$,
  'anon holds no privilege on any table of public or app'
);

-- Clients never get TRUNCATE / REFERENCES / TRIGGER (TRUNCATE ignores RLS).
select is_empty(
  $$ select c.oid::regclass::text || ' ' || r.rolname
     from pg_catalog.pg_class as c
     join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
     cross join (select rolname from pg_catalog.pg_roles where rolname in ('authenticated', 'kb_collab')) as r
     where n.nspname in ('public', 'app') and c.relkind in ('r', 'p')
       and has_table_privilege(r.rolname, c.oid, 'truncate, references, trigger')
     order by 1 $$,
  'authenticated and kb_collab hold no TRUNCATE, REFERENCES or TRIGGER privilege'
);

-- No policy applies to everyone (PUBLIC) or to anon.
select is_empty(
  $$ select schemaname || '.' || tablename || ' ' || policyname
     from pg_catalog.pg_policies
     where schemaname in ('public', 'app') and (roles && array['public', 'anon']::name[])
     order by 1 $$,
  'no policy of public or app applies to PUBLIC or anon'
);

-- A write grant without a matching policy is a silent dead end (every row refused); flag it so a
-- later migration cannot grant INSERT/UPDATE/DELETE and forget the policy.
select is_empty(
  $$ select c.oid::regclass::text || ' ' || cmd.cmd
     from pg_catalog.pg_class as c
     join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
     cross join (values ('insert'), ('update'), ('delete')) as cmd (cmd)
     where n.nspname = 'public' and c.relkind = 'r'
       and (case cmd.cmd
              when 'delete' then has_table_privilege('authenticated', c.oid, 'delete')
              else has_any_column_privilege('authenticated', c.oid, cmd.cmd)
            end)
       and not exists (
         select 1 from pg_catalog.pg_policies as p
         where p.schemaname = 'public' and p.tablename = c.relname
           and p.cmd in (upper(cmd.cmd), 'ALL') and p.roles @> array['authenticated']::name[]
       )
     order by 1 $$,
  'every INSERT/UPDATE/DELETE grant of authenticated has a policy for that command'
);

-- Every table that an authenticated user can read has a SELECT policy (RLS on + no policy = invisible).
select is_empty(
  $$ select c.oid::regclass::text
     from pg_catalog.pg_class as c
     join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and has_any_column_privilege('authenticated', c.oid, 'select')
       and not exists (
         select 1 from pg_catalog.pg_policies as p
         where p.schemaname = 'public' and p.tablename = c.relname
           and p.cmd in ('SELECT', 'ALL') and p.roles @> array['authenticated']::name[]
       )
     order by 1 $$,
  'every table readable by authenticated has a SELECT policy'
);

-- RPCs of the public schema are not callable anonymously.
select is_empty(
  $$ select p.oid::regprocedure::text
     from pg_catalog.pg_proc as p
     join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and has_function_privilege('anon', p.oid, 'execute')
       and not exists (select 1 from pg_catalog.pg_depend as d where d.objid = p.oid and d.deptype = 'e')
     order by 1 $$,
  'anon cannot execute any function of the public schema'
);

-- SECURITY DEFINER helpers of schema app are not callable by anon either. Trigger functions are
-- left out: they keep the default PUBLIC EXECUTE but PostgreSQL refuses to call them directly.
select is_empty(
  $$ select p.oid::regprocedure::text
     from pg_catalog.pg_proc as p
     join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.prosecdef and p.prorettype <> 'pg_catalog.trigger'::regtype
       and has_function_privilege('anon', p.oid, 'execute')
     order by 1 $$,
  'anon cannot execute any SECURITY DEFINER function of the app schema'
);

select * from finish();

rollback;
