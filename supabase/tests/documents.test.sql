begin;

select plan(18);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000002', 'admin@example.com'),
  ('00000000-0000-0000-0000-000000000003', 'editor@example.com'),
  ('00000000-0000-0000-0000-000000000004', 'viewer@example.com');

-- New users outside the (empty) allowlist are guests; these fixtures are internal users.
select set_config('request.jwt.claim.role', 'service_role', true);
update public.profiles set is_guest = false;
select set_config('request.jwt.claim.role', '', true);

insert into public.spaces (id, slug, name, visibility, created_by) values
  ('10000000-0000-0000-0000-00000000000a', 'space-a', 'A', 'restricted', '00000000-0000-0000-0000-000000000002');
insert into public.space_members (space_id, user_id, role, added_by) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000003', 'editor', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', 'viewer', '00000000-0000-0000-0000-000000000002');
insert into public.pages (id, space_id, position, title, created_by) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'V', 'Page', '00000000-0000-0000-0000-000000000003');

select has_role('kb_collab', 'kb_collab role exists');
select is(
  (select row(rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin)::text from pg_roles where rolname = 'kb_collab'),
  '(f,f,f,f,t)',
  'kb_collab can log in but has no superuser, bypassrls or create privileges'
);

-- ---------------------------------------------------------------- authenticated
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

select throws_ok($$ select ydoc from public.page_documents $$, '42501', null,
  'authenticated cannot read ydoc');
select lives_ok($$ select content_json, content_text from public.page_documents $$,
  'authenticated reads derived content');
select throws_ok($$ update public.page_documents set content_text = 'x' $$, '42501', null,
  'authenticated cannot write documents');
select throws_ok($$ select app.record_content_edit('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003') $$,
  '42501', null, 'authenticated cannot write content audit rows');

reset role;

-- ---------------------------------------------------------------- kb_collab
-- pgTAP lives in `extensions`; visible to kb_collab only inside this rolled-back test.
grant usage on schema extensions to kb_collab;
set local role kb_collab;
set local search_path = public, extensions;

select throws_ok($$ select * from public.profiles $$, '42501', null, 'kb_collab cannot read profiles');
select throws_ok($$ select * from public.spaces $$, '42501', null, 'kb_collab cannot read spaces');
select throws_ok($$ select * from public.space_members $$, '42501', null, 'kb_collab cannot read memberships');
select throws_ok($$ select * from public.audit_logs $$, '42501', null, 'kb_collab cannot read the audit log');
select throws_ok($$ update public.pages set title = 'x' $$, '42501', null, 'kb_collab cannot rename pages');

select is(
  (select ydoc from public.page_documents where page_id = '20000000-0000-0000-0000-000000000001' for update),
  '\x0000'::bytea,
  'kb_collab reads and locks ydoc'
);

update public.page_documents
set ydoc = '\x010203', schema_version = 1, content_json = '{"type": "doc", "content": [{"type": "paragraph"}]}',
    content_text = 'Xin chào', headings_text = '', table_text = '', word_count = 2
where page_id = '20000000-0000-0000-0000-000000000001';

select set_config('app.actor_id', '00000000-0000-0000-0000-000000000003', true);
update public.pages set last_edited_at = now(), last_edited_by = '00000000-0000-0000-0000-000000000003'
where id = '20000000-0000-0000-0000-000000000001';

select is(
  app.authorize_document('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004'),
  'viewer'::public.space_role,
  'kb_collab calls authorize_document'
);

select ok(app.record_content_edit('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003'),
  'first content edit is audited');
select ok(not app.record_content_edit('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003'),
  'a second edit by the same user within 10 minutes is coalesced');

reset role;

select results_eq(
  $$ select content_text, word_count, ydoc from public.page_documents where page_id = '20000000-0000-0000-0000-000000000001' $$,
  $$ values ('Xin chào'::text, 2, '\x010203'::bytea) $$,
  'kb_collab stored the document'
);
select is(
  (select last_edited_by from public.pages where id = '20000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-000000000003'::uuid,
  'kb_collab bumped last_edited_by'
);
select is(
  (select count(*)::int from public.audit_logs where action = 'page.update_content'
     and actor_id = '00000000-0000-0000-0000-000000000003'),
  1,
  'exactly one page.update_content row, with the editor as actor'
);

select * from finish();
rollback;
