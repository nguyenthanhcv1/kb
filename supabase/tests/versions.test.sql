begin;

select plan(36);

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
insert into public.spaces (id, slug, name, visibility, created_by) values
  ('10000000-0000-0000-0000-00000000000a', 'space-a', 'A', 'restricted', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000b', 'space-b', 'B', 'internal', '00000000-0000-0000-0000-000000000002');
insert into public.space_members (space_id, user_id, role, added_by) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000003', 'editor', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', 'viewer', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000006', 'viewer', '00000000-0000-0000-0000-000000000002');
insert into public.pages (id, space_id, position, title, created_by) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'V', 'Trang A', '00000000-0000-0000-0000-000000000003'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000b', 'V', 'Trang B', '00000000-0000-0000-0000-000000000002');

select has_table('public', 'page_versions', 'page_versions exists');
select enum_has_labels('public', 'version_reason', array['auto', 'manual', 'pre_restore', 'restore'],
  'version_reason has the four snapshot reasons');

-- ---------------------------------------------------------------- kb_collab writes
-- pgTAP lives in `extensions`; visible to kb_collab only inside this rolled-back test.
grant usage on schema extensions to kb_collab;
set local role kb_collab;
set local search_path = public, extensions;
select set_config('app.actor_id', '00000000-0000-0000-0000-000000000003', true);

select lives_ok(
  $$ insert into public.page_versions (id, page_id, ydoc_update, content_json, content_text, schema_version, reason)
     values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '\x0102',
             '{"type": "doc", "content": []}', 'một', 1, 'auto') $$,
  'kb_collab inserts an auto version'
);
select results_eq(
  $$ select version_no, title, created_by from public.page_versions where id = '30000000-0000-0000-0000-000000000001' $$,
  $$ values (1, 'Trang A'::text, '00000000-0000-0000-0000-000000000003'::uuid) $$,
  'first version is numbered 1, takes the page title and the actor as author'
);

insert into public.page_versions (id, page_id, ydoc_update, content_json, schema_version, reason, label)
values ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '\x0103',
        '{"type": "doc", "content": []}', 1, 'manual', 'Bản duyệt');
select is(
  (select version_no from public.page_versions where id = '30000000-0000-0000-0000-000000000002'),
  2, 'next version of the same page is numbered 2'
);

insert into public.page_versions (id, page_id, ydoc_update, content_json, schema_version, reason)
values ('30000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000002', '\x01',
        '{"type": "doc", "content": []}', 1, 'auto');
select is(
  (select version_no from public.page_versions where id = '30000000-0000-0000-0000-000000000009'),
  1, 'numbering is per page'
);

select throws_ok(
  $$ insert into public.page_versions (page_id, ydoc_update, content_json, schema_version, reason, label)
     values ('20000000-0000-0000-0000-000000000001', '\x01', '{}', 1, 'auto', 'x') $$,
  '23514', null, 'only manual versions carry a label'
);
select throws_ok(
  $$ insert into public.page_versions (page_id, ydoc_update, content_json, schema_version, reason, restored_from_version_id)
     values ('20000000-0000-0000-0000-000000000001', '\x01', '{}', 1, 'auto', '30000000-0000-0000-0000-000000000001') $$,
  '23514', null, 'only restore versions point to a source version'
);
select throws_ok(
  $$ insert into public.page_versions (page_id, ydoc_update, content_json, schema_version, reason, restored_from_version_id)
     values ('20000000-0000-0000-0000-000000000001', '\x01', '{}', 1, 'restore', '30000000-0000-0000-0000-000000000009') $$,
  'P0002', 'VERSION_NOT_FOUND', 'a restore cannot point to a version of another page'
);
select throws_ok(
  $$ insert into public.page_versions (page_id, ydoc_update, content_json, schema_version, reason)
     values ('20000000-0000-0000-0000-0000000000ff', '\x01', '{}', 1, 'auto') $$,
  'P0002', 'PAGE_NOT_FOUND', 'versions need an existing page'
);

insert into public.page_versions (id, page_id, ydoc_update, content_json, schema_version, reason)
values ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '\x0104',
        '{"type": "doc", "content": []}', 1, 'pre_restore');
insert into public.page_versions (id, page_id, ydoc_update, content_json, schema_version, reason, restored_from_version_id)
values ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', '\x0102',
        '{"type": "doc", "content": []}', 1, 'restore', '30000000-0000-0000-0000-000000000001');

select throws_ok($$ update public.page_versions set label = 'x' $$, '42501', null,
  'kb_collab cannot rewrite versions');
select throws_ok($$ delete from public.page_versions $$, '42501', null,
  'kb_collab cannot delete versions');
select lives_ok($$ select app.prune_page_versions() $$, 'kb_collab runs the retention job');

reset role;
set local search_path = public, extensions;

select results_eq(
  $$ select action, entity_type, entity_id, space_id, actor_id,
            metadata ->> 'page_id', (metadata ->> 'version_no')::int, (metadata ->> 'restored_from_version_no')::int
     from public.audit_logs where action like 'version.%' $$,
  $$ values ('version.restore'::text, 'version'::text, '30000000-0000-0000-0000-000000000004'::uuid,
             '10000000-0000-0000-0000-00000000000a'::uuid, '00000000-0000-0000-0000-000000000003'::uuid,
             '20000000-0000-0000-0000-000000000001'::text, 4, 1) $$,
  'only the restore version is audited, as version.restore in the page''s Space'
);

-- ---------------------------------------------------------------- authenticated reads
set local role authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is((select count(*)::int from public.page_versions), 5, 'viewer sees versions of pages in their Space (+ internal Space)');
select throws_ok($$ select ydoc_update from public.page_versions $$, '42501', null,
  'authenticated cannot read ydoc_update');
select lives_ok($$ select content_json, content_text, label, reason from public.page_versions $$,
  'authenticated reads derived content and metadata');
select throws_ok(
  $$ insert into public.page_versions (page_id, ydoc_update, content_json, schema_version, reason)
     values ('20000000-0000-0000-0000-000000000001', '\x01', '{}', 1, 'manual') $$,
  '42501', null, 'viewer cannot create versions'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is((select count(*)::int from public.page_versions where page_id = '20000000-0000-0000-0000-000000000001'), 4,
  'editor sees every version of the page');
select throws_ok(
  $$ insert into public.page_versions (page_id, ydoc_update, content_json, schema_version, reason)
     values ('20000000-0000-0000-0000-000000000001', '\x01', '{}', 1, 'manual') $$,
  '42501', null, 'editor cannot create versions directly (only through kb-collab)'
);
select throws_ok($$ update public.page_versions set label = 'x' $$, '42501', null, 'editor cannot rewrite versions');
select throws_ok($$ delete from public.page_versions $$, '42501', null, 'editor cannot delete versions');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select throws_ok($$ delete from public.page_versions $$, '42501', null, 'Space admin cannot delete versions');
select throws_ok($$ select app.prune_page_versions() $$, '42501', null, 'authenticated cannot run the retention job');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is((select count(*)::int from public.page_versions), 5, 'super admin sees every version');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select results_eq($$ select page_id from public.page_versions $$,
  $$ values ('20000000-0000-0000-0000-000000000002'::uuid) $$,
  'internal non-member sees only versions of the internal Space');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is((select count(*)::int from public.page_versions), 4, 'guest member sees versions of their Space only');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select is((select count(*)::int from public.page_versions), 0, 'guest non-member sees no version');

reset role;
set local role anon;
select throws_ok($$ select id from public.page_versions $$, '42501', null, 'anon cannot read versions');
reset role;

-- Trashed page: history follows page access (editors and admins only).
update public.pages set deleted_at = now() where id = '20000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is((select count(*)::int from public.page_versions where page_id = '20000000-0000-0000-0000-000000000001'), 0,
  'viewer loses the history of a trashed page');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is((select count(*)::int from public.page_versions where page_id = '20000000-0000-0000-0000-000000000001'), 4,
  'editor keeps the history of a trashed page');
reset role;
set local search_path = public, extensions;

-- ---------------------------------------------------------------- retention
-- Page B, "now" = 2026-03-01. Local day D = 2026-01-10 (Asia/Ho_Chi_Minh, UTC+7).
delete from public.page_versions where page_id = '20000000-0000-0000-0000-000000000002';
insert into public.page_versions (id, page_id, ydoc_update, content_json, schema_version, reason, created_at) values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '\x01', '{}', 1, 'auto',   '2026-01-10 01:00+07'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '\x01', '{}', 1, 'auto',   '2026-01-10 09:00+07'),
  ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', '\x01', '{}', 1, 'auto',   '2026-01-10 23:30+07'),
  ('40000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', '\x01', '{}', 1, 'auto',   '2026-01-11 00:30+07'),
  ('40000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000002', '\x01', '{}', 1, 'manual', '2026-01-10 00:10+07'),
  ('40000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000002', '\x01', '{}', 1, 'pre_restore', '2026-01-10 00:20+07'),
  ('40000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000002', '\x01', '{}', 1, 'auto',   '2026-01-12 08:00+07'),
  ('40000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000002', '\x01', '{}', 1, 'auto',   '2026-01-12 09:00+07'),
  ('40000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000002', '\x01', '{}', 1, 'auto',   '2026-02-25 10:00+07'),
  ('40000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000002', '\x01', '{}', 1, 'auto',   '2026-02-25 11:00+07');
-- A restore points back to the 01:00 auto version of day D.
insert into public.page_versions (id, page_id, ydoc_update, content_json, schema_version, reason, restored_from_version_id, created_at)
values ('40000000-0000-0000-0000-000000000013', '20000000-0000-0000-0000-000000000002', '\x01', '{}', 1, 'restore',
        '40000000-0000-0000-0000-000000000001', '2026-02-26 10:00+07');

set local role service_role;
select is(app.prune_page_versions('2026-03-01 00:00+07'), 2, 'retention deletes the thinned-out auto versions');
reset role;
set local search_path = public, extensions;

select set_eq(
  $$ select id from public.page_versions where page_id = '20000000-0000-0000-0000-000000000002' $$,
  $$ values ('40000000-0000-0000-0000-000000000001'::uuid), ('40000000-0000-0000-0000-000000000003'),
            ('40000000-0000-0000-0000-000000000004'), ('40000000-0000-0000-0000-000000000005'),
            ('40000000-0000-0000-0000-000000000006'), ('40000000-0000-0000-0000-000000000008'),
            ('40000000-0000-0000-0000-000000000011'), ('40000000-0000-0000-0000-000000000012'),
            ('40000000-0000-0000-0000-000000000013') $$,
  'keeps manual/pre_restore/restore, the last auto per local day, restore sources and the last 30 days'
);
select is(app.prune_page_versions('2026-03-01 00:00+07'), 0, 'retention is idempotent');
select is(app.prune_page_versions('2026-03-30 00:00+07'), 1, 'recent auto versions thin out once older than 30 days');

-- Purging a page removes its history.
update public.pages set deleted_at = now() where id = '20000000-0000-0000-0000-000000000002';
delete from public.pages where id = '20000000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.page_versions where page_id = '20000000-0000-0000-0000-000000000002'), 0,
  'purging a page deletes its versions');

select * from finish();
rollback;
