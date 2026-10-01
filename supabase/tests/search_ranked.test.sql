begin;

select plan(5);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000002', 'admin@example.com'),
  ('00000000-0000-0000-0000-000000000004', 'viewer@example.com'),
  ('00000000-0000-0000-0000-000000000005', 'outsider@example.com');

select set_config('request.jwt.claim.role', 'service_role', true);
update public.profiles set is_guest = false;
select set_config('request.jwt.claim.role', '', true);

insert into public.spaces (id, slug, name, visibility, created_by) values
  ('10000000-0000-0000-0000-00000000000a', 'space-a', 'A', 'restricted', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000b', 'space-b', 'B', 'restricted', '00000000-0000-0000-0000-000000000002');
insert into public.space_members (space_id, user_id, role, added_by) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', 'viewer', '00000000-0000-0000-0000-000000000002');
insert into public.pages (id, space_id, position, title, created_by) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'V', 'Quy trình nghỉ phép', '00000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000b', 'V', 'Nghỉ phép bí mật', '00000000-0000-0000-0000-000000000002');

set local role authenticated;

-- app.search_ranked is SECURITY DEFINER (it must use the indexes): it enforces Space visibility itself.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select results_eq(
  $$ select page_id from app.search_ranked(
       websearch_to_tsquery('public.vi_unaccent'::regconfig, 'nghi phep'), null, null, 'nghi phep', true, null, 10, 0) $$,
  $$ values ('20000000-0000-0000-0000-000000000001'::uuid) $$,
  'viewer: only the page of the Space they can view'
);

select is(
  (select count(*)::integer from app.search_ranked(
     websearch_to_tsquery('public.vi_unaccent'::regconfig, 'nghi phep'), null, null, 'nghi phep', true,
     array['10000000-0000-0000-0000-00000000000b']::uuid[], 10, 0)),
  0,
  'viewer: passing a Space they cannot view in space_ids does not widen access'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select is(
  (select count(*)::integer from app.search_ranked(
     websearch_to_tsquery('public.vi_unaccent'::regconfig, 'nghi phep'), null, null, 'nghi phep', true,
     array['10000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000b']::uuid[], 10, 0)),
  0,
  'outsider: nothing, even when listing every Space'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select throws_ok(
  $$ select * from app.search_ranked(null, null, null, 'x', true, null, 10, 0) $$,
  '42501',
  null,
  'anon cannot execute app.search_ranked'
);

reset role;
update public.pages set deleted_at = now() where id = '20000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is(
  (select count(*)::integer from app.search_ranked(
     websearch_to_tsquery('public.vi_unaccent'::regconfig, 'nghi phep'), null, null, 'nghi phep', true, null, 10, 0)),
  0,
  'trashed pages are not returned'
);

select * from finish();
rollback;
