begin;

select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'super@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'admin@example.com'),
  ('00000000-0000-0000-0000-000000000003', 'editor@example.com'),
  ('00000000-0000-0000-0000-000000000004', 'viewer@example.com'),
  ('00000000-0000-0000-0000-000000000005', 'internal@example.com'),
  ('00000000-0000-0000-0000-000000000006', 'guest@example.net'),
  ('00000000-0000-0000-0000-000000000007', 'guest-outside@example.net'),
  ('00000000-0000-0000-0000-000000000008', 'deactivated@example.com');

insert into public.profiles (id, email, is_guest, is_super_admin, deactivated_at) values
  ('00000000-0000-0000-0000-000000000001', 'super@example.com', false, true, null),
  ('00000000-0000-0000-0000-000000000002', 'admin@example.com', false, false, null),
  ('00000000-0000-0000-0000-000000000003', 'editor@example.com', false, false, null),
  ('00000000-0000-0000-0000-000000000004', 'viewer@example.com', false, false, null),
  ('00000000-0000-0000-0000-000000000005', 'internal@example.com', false, false, null),
  ('00000000-0000-0000-0000-000000000006', 'guest@example.net', true, false, null),
  ('00000000-0000-0000-0000-000000000007', 'guest-outside@example.net', true, false, null),
  ('00000000-0000-0000-0000-000000000008', 'deactivated@example.com', false, false, now());

insert into public.spaces (id, slug, name, visibility, created_by) values
  ('10000000-0000-0000-0000-000000000001', 'restricted', 'Restricted', 'restricted', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000002', 'internal', 'Internal', 'internal', '00000000-0000-0000-0000-000000000002');

insert into public.space_members (space_id, user_id, role, added_by) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'editor', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'viewer', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000006', 'viewer', '00000000-0000-0000-0000-000000000002');

set local role authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is(app.space_role('10000000-0000-0000-0000-000000000001'), 'admin'::public.space_role, 'super admin is an admin in every active space');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select is(app.space_role('10000000-0000-0000-0000-000000000001'), 'admin'::public.space_role, 'explicit admin role is returned');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is(app.space_role('10000000-0000-0000-0000-000000000001'), 'editor'::public.space_role, 'explicit editor role is returned');
select ok(app.can_edit_space('10000000-0000-0000-0000-000000000001'), 'editor can edit a restricted space');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is(app.space_role('10000000-0000-0000-0000-000000000001'), 'viewer'::public.space_role, 'explicit viewer role is returned');
select isnt(app.can_edit_space('10000000-0000-0000-0000-000000000001'), true, 'viewer cannot edit a restricted space');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select is(app.space_role('10000000-0000-0000-0000-000000000002'), 'viewer'::public.space_role, 'internal user gets implicit viewer role');
select is(app.space_role('10000000-0000-0000-0000-000000000001'), null::public.space_role, 'internal non-member cannot view restricted space');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is(app.space_role('10000000-0000-0000-0000-000000000001'), 'viewer'::public.space_role, 'guest receives explicit membership role');
select is(app.space_role('10000000-0000-0000-0000-000000000002'), null::public.space_role, 'guest has no implicit access to internal space');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select is(app.space_role('10000000-0000-0000-0000-000000000001'), null::public.space_role, 'guest non-member cannot view restricted space');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select is(app.space_role('10000000-0000-0000-0000-000000000002'), null::public.space_role, 'deactivated user has no effective role');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select results_eq(
  $$ select slug::text from public.spaces order by slug::text $$,
  array['internal', 'restricted'],
  'internal viewer selects implicit and explicit spaces through RLS'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select results_eq(
  $$ select slug::text from public.spaces order by slug::text $$,
  array['internal'],
  'internal non-member only selects internal spaces'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select results_eq(
  $$ select slug::text from public.spaces order by slug::text $$,
  array['restricted'],
  'guest only selects explicitly joined spaces'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select is_empty(
  $$ select id from public.spaces $$,
  'guest non-member selects no spaces'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$ insert into public.space_members (space_id, user_id, role, added_by)
     values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000007', 'admin', '00000000-0000-0000-0000-000000000002') $$,
  '23514',
  'GUEST_CANNOT_BE_SPACE_ADMIN',
  'guest cannot become a space admin'
);

select lives_ok(
  $$ insert into public.invitations (email, space_id, role, token_hash, invited_by)
     values ('invitee@example.net', '10000000-0000-0000-0000-000000000001', 'viewer', 'token-1', '00000000-0000-0000-0000-000000000002') $$,
  'space admin can create a non-admin invitation'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select throws_ok(
  $$ insert into public.invitations (email, space_id, role, token_hash, invited_by)
     values ('blocked@example.net', '10000000-0000-0000-0000-000000000001', 'viewer', 'token-2', '00000000-0000-0000-0000-000000000004') $$,
  '42501',
  null,
  'viewer cannot create an invitation'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$ delete from public.space_members
     where space_id = '10000000-0000-0000-0000-000000000002'
       and user_id = '00000000-0000-0000-0000-000000000002' $$,
  '23514',
  'SPACE_REQUIRES_ADMIN',
  'last space admin cannot be removed'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$ insert into public.access_allowlist (kind, value, created_by)
     values ('email', 'allowed@example.com', '00000000-0000-0000-0000-000000000001') $$,
  'super admin can add an allowlist entry'
);

set local role anon;
select throws_ok(
  $$ select id from public.spaces $$,
  '42501',
  null,
  'anonymous users have no table access'
);

select * from finish();

rollback;
