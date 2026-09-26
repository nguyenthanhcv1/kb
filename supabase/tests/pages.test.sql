begin;

select plan(51);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'super@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'admin@example.com'),
  ('00000000-0000-0000-0000-000000000003', 'editor@example.com'),
  ('00000000-0000-0000-0000-000000000004', 'viewer@example.com'),
  ('00000000-0000-0000-0000-000000000005', 'internal@example.com'),
  ('00000000-0000-0000-0000-000000000006', 'guest@example.net'),
  ('00000000-0000-0000-0000-000000000007', 'guest-outside@example.net');

select set_config('request.jwt.claim.role', 'service_role', true);
update public.profiles as p set is_guest = v.is_guest, is_super_admin = v.is_super_admin
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid, false, true),
  ('00000000-0000-0000-0000-000000000002'::uuid, false, false),
  ('00000000-0000-0000-0000-000000000003'::uuid, false, false),
  ('00000000-0000-0000-0000-000000000004'::uuid, false, false),
  ('00000000-0000-0000-0000-000000000005'::uuid, false, false),
  ('00000000-0000-0000-0000-000000000006'::uuid, true, false),
  ('00000000-0000-0000-0000-000000000007'::uuid, true, false)
) as v(id, is_guest, is_super_admin)
where p.id = v.id;
select set_config('request.jwt.claim.role', '', true);

-- Space A (restricted): admin 2, editor 3, viewer 4, guest viewer 6. Space B (internal): admin 2.
-- Space C (restricted): only editor 3 is a member besides admin 2.
insert into public.spaces (id, slug, name, visibility, created_by) values
  ('10000000-0000-0000-0000-00000000000a', 'space-a', 'A', 'restricted', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000b', 'space-b', 'B', 'internal', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000c', 'space-c', 'C', 'restricted', '00000000-0000-0000-0000-000000000002');

insert into public.space_members (space_id, user_id, role, added_by) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000003', 'editor', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', 'viewer', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000006', 'viewer', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000003', 'editor', '00000000-0000-0000-0000-000000000002');

set local role authenticated;

-- ---------------------------------------------------------------- create
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

select lives_ok(
  $$ insert into public.pages (id, space_id, position, title) values
       ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'a0', 'Hướng dẫn Đăng nhập!') $$,
  'editor creates a root page (created_by defaults to the caller)'
);

select results_eq(
  $$ select slug, created_by, owner_id, last_edited_by from public.pages where id = '20000000-0000-0000-0000-000000000001' $$,
  $$ values ('huong-dan-dang-nhap'::text, '00000000-0000-0000-0000-000000000003'::uuid,
             '00000000-0000-0000-0000-000000000003'::uuid, '00000000-0000-0000-0000-000000000003'::uuid) $$,
  'slug drops Vietnamese diacritics; creator becomes owner and last editor'
);

select matches(
  (select short_id from public.pages where id = '20000000-0000-0000-0000-000000000001'),
  '^[0-9A-Za-z]{8}$',
  'short_id is 8 base62 characters'
);

select is(
  (select count(*)::int from public.page_documents where page_id = '20000000-0000-0000-0000-000000000001'),
  1,
  'creating a page creates its empty document'
);

select results_eq(
  $$ select schema_version, content_json, content_text, word_count from public.page_documents
     where page_id = '20000000-0000-0000-0000-000000000001' $$,
  $$ values (1, '{"type": "doc", "content": []}'::jsonb, ''::text, 0) $$,
  'the empty document has derived fields readable by the editor'
);

select throws_ok(
  $$ select ydoc from public.page_documents $$,
  '42501', null,
  'authenticated cannot select page_documents.ydoc'
);

select throws_ok(
  $$ update public.page_documents set content_text = 'x' $$,
  '42501', null,
  'authenticated cannot write page_documents'
);

select throws_ok(
  $$ insert into public.pages (space_id, position, title, created_by) values
       ('10000000-0000-0000-0000-00000000000a', 'a1', 'Spoof', '00000000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'created_by must be the caller'
);

insert into public.pages (id, space_id, parent_id, position, title) values
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 'a0', 'Child'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000002', 'a0', 'Grandchild'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-00000000000a', null, 'a1', 'Second root');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select throws_ok(
  $$ insert into public.pages (space_id, position, title) values ('10000000-0000-0000-0000-00000000000a', 'a2', 'No') $$,
  '42501', null,
  'viewer cannot create a page'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select throws_ok(
  $$ insert into public.pages (space_id, position, title) values ('10000000-0000-0000-0000-00000000000b', 'a0', 'No') $$,
  '42501', null,
  'implicit viewer of an internal space cannot create a page'
);

-- ---------------------------------------------------------------- read matrix
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is((select count(*)::int from public.pages), 4, 'viewer sees every live page of the space');
select is((select count(*)::int from public.page_documents), 4, 'viewer reads documents of visible pages');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is((select count(*)::int from public.pages), 4, 'guest member sees pages of their space');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select is((select count(*)::int from public.pages), 0, 'guest non-member sees no page');
select is((select count(*)::int from public.page_documents), 0, 'guest non-member reads no document');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select is((select count(*)::int from public.pages), 0, 'internal non-member cannot see pages of a restricted space');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is((select count(*)::int from public.pages), 4, 'super admin sees every page');

-- ---------------------------------------------------------------- update / move
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
update public.pages set title = 'Hacked' where id = '20000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is(
  (select title from public.pages where id = '20000000-0000-0000-0000-000000000001'),
  'Hướng dẫn Đăng nhập!',
  'viewer cannot rename a page'
);

update public.pages set title = 'Quy trình' where id = '20000000-0000-0000-0000-000000000004';
select is(
  (select slug from public.pages where id = '20000000-0000-0000-0000-000000000004'),
  'quy-trinh',
  'renaming regenerates the slug'
);

select throws_ok(
  $$ update public.pages set short_id = 'AAAAAAAA' where id = '20000000-0000-0000-0000-000000000004' $$,
  '42501', null,
  'short_id cannot be changed by clients'
);

select throws_ok(
  $$ update public.pages set parent_id = '20000000-0000-0000-0000-000000000003' where id = '20000000-0000-0000-0000-000000000001' $$,
  '23514', 'PAGE_MOVE_CYCLE',
  'a page cannot move under its own descendant'
);

select throws_ok(
  $$ update public.pages set parent_id = id where id = '20000000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'a page cannot be its own parent'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
insert into public.pages (id, space_id, position, title) values
  ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'a0', 'In B');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

select throws_ok(
  $$ insert into public.pages (space_id, parent_id, position, title) values
       ('10000000-0000-0000-0000-00000000000c', '20000000-0000-0000-0000-000000000001', 'a0', 'Wrong space') $$,
  '23514', 'PAGE_PARENT_SPACE_MISMATCH',
  'a new page cannot have a parent in another space'
);

update public.pages set parent_id = '20000000-0000-0000-0000-000000000001', position = 'a1'
where id = '20000000-0000-0000-0000-000000000004';
select is(
  (select parent_id from public.pages where id = '20000000-0000-0000-0000-000000000004'),
  '20000000-0000-0000-0000-000000000001'::uuid,
  'editor moves a page under another page'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is(
  (select metadata from public.audit_logs where action = 'page.move'
     and entity_id = '20000000-0000-0000-0000-000000000004'),
  jsonb_build_object('title', 'Quy trình', 'from_parent', null, 'to_parent', '20000000-0000-0000-0000-000000000001',
                     'from_space', '10000000-0000-0000-0000-00000000000a', 'to_space', '10000000-0000-0000-0000-00000000000a'),
  'page.move records from/to parent'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

-- Move the branch 1 → 2 → 3 (+ 4 under 1) to Space C, where the editor also edits.
update public.pages set space_id = '10000000-0000-0000-0000-00000000000c'
where id = '20000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.pages where space_id = '10000000-0000-0000-0000-00000000000c'),
  4,
  'moving a page to another space moves its whole subtree'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is(
  (select count(*)::int from public.audit_logs where action = 'page.move'
     and entity_id in ('20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003')),
  0,
  'descendants moved by the cascade are not audited separately'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

select throws_ok(
  $$ update public.pages set space_id = '10000000-0000-0000-0000-00000000000a'
     where id = '20000000-0000-0000-0000-000000000002' $$,
  '23514', 'PAGE_PARENT_SPACE_MISMATCH',
  'a child cannot leave its parent''s space'
);

-- Editor is not an editor of Space B: WITH CHECK fails for the target space.
select throws_ok(
  $$ update public.pages set space_id = '10000000-0000-0000-0000-00000000000b', parent_id = null
     where id = '20000000-0000-0000-0000-000000000004' $$,
  '42501', null,
  'moving to a space needs edit rights in the target space'
);

-- Back to Space A for the rest of the test.
update public.pages set space_id = '10000000-0000-0000-0000-00000000000a'
where id = '20000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------- trash / restore
update public.pages set deleted_at = now() where id = '20000000-0000-0000-0000-000000000002';

select results_eq(
  $$ select id, deleted_by from public.pages where deleted_at is not null order by id $$,
  $$ values ('20000000-0000-0000-0000-000000000002'::uuid, '00000000-0000-0000-0000-000000000003'::uuid),
            ('20000000-0000-0000-0000-000000000003'::uuid, '00000000-0000-0000-0000-000000000003'::uuid) $$,
  'trashing a page trashes its subtree and records who deleted it'
);
select is(
  (select count(distinct deleted_at)::int from public.pages where deleted_at is not null),
  1,
  'the whole branch shares one deleted_at'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is(
  (select array_agg(action order by id) from public.audit_logs where action = 'page.delete'),
  array['page.delete'],
  'only the page the user trashed is audited'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

select throws_ok(
  $$ insert into public.pages (space_id, parent_id, position, title) values
       ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000002', 'b0', 'Under trash') $$,
  '23514', 'PAGE_PARENT_DELETED',
  'a live page cannot be created under a trashed page'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is((select count(*)::int from public.pages where deleted_at is not null), 0, 'viewer does not see the trash');
select is(
  (select count(*)::int from public.page_documents where page_id = '20000000-0000-0000-0000-000000000002'),
  0,
  'viewer cannot read documents of trashed pages'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is((select count(*)::int from public.pages where deleted_at is not null), 2, 'editor sees the trash');

select throws_ok(
  $$ update public.pages set deleted_at = null where id = '20000000-0000-0000-0000-000000000003' $$,
  '23514', 'PAGE_PARENT_DELETED',
  'a page cannot be restored under a trashed parent'
);

update public.pages set deleted_at = null where id = '20000000-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from public.pages where deleted_at is not null or deleted_by is not null),
  0,
  'restoring a page restores the branch trashed with it'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is(
  (select count(*)::int from public.audit_logs where action = 'page.restore_from_trash'),
  1,
  'restore is audited once'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

-- ---------------------------------------------------------------- purge
delete from public.pages where id = '20000000-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from public.pages where id = '20000000-0000-0000-0000-000000000002'),
  1,
  'editor cannot purge a page'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$ delete from public.pages where id = '20000000-0000-0000-0000-000000000002' $$,
  '23514', 'PAGE_NOT_IN_TRASH',
  'a live page cannot be purged'
);

update public.pages set deleted_at = now() where id = '20000000-0000-0000-0000-000000000002';
delete from public.pages where id = '20000000-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from public.pages where id in ('20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003')),
  0,
  'admin purges a trashed page with its subtree'
);
select is(
  (select count(*)::int from public.page_documents where page_id in ('20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003')),
  0,
  'purging removes the documents'
);
select is(
  (select count(*)::int from public.audit_logs where action = 'page.purge'),
  1,
  'purge is audited once for the page the admin removed'
);

-- ---------------------------------------------------------------- audit
select results_eq(
  $$ select action, actor_id from public.audit_logs
     where entity_id = '20000000-0000-0000-0000-000000000001' and action = 'page.create' $$,
  $$ values ('page.create'::text, '00000000-0000-0000-0000-000000000003'::uuid) $$,
  'page.create records the creator'
);
select is(
  (select metadata from public.audit_logs where action = 'page.update_title'),
  '{"from": "Second root", "to": "Quy trình"}'::jsonb,
  'page.update_title records from/to'
);

-- ---------------------------------------------------------------- helpers
select is(app.page_role('20000000-0000-0000-0000-000000000001'), 'admin'::public.space_role, 'page_role returns the space role');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select lives_ok(
  $$ insert into public.pages (id, space_id, position, title) values
       ('20000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-00000000000a', 'z', 'Returning')
     returning id, short_id $$,
  'INSERT … RETURNING passes the SELECT policy (PostgREST insert().select())'
);

reset role;

select is(
  app.authorize_document('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004'),
  'viewer'::public.space_role,
  'authorize_document returns the role of the given user'
);
select is(
  app.authorize_document('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000007'),
  null::public.space_role,
  'authorize_document rejects a non-member'
);
update public.pages set deleted_at = now() where id = '20000000-0000-0000-0000-000000000004';
select is(
  app.authorize_document('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003'),
  null::public.space_role,
  'authorize_document rejects a trashed page even for an editor'
);

select * from finish();
rollback;
