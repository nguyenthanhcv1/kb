-- Group administration functions (super admin only) and approving an account into groups.
begin;

select plan(34);

insert into public.access_allowlist (kind, value) values ('domain', 'corp.example');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000501', 'admin@corp.example'),
  ('00000000-0000-0000-0000-000000000502', 'an@corp.example'),
  ('00000000-0000-0000-0000-000000000503', 'binh@corp.example'),
  ('00000000-0000-0000-0000-000000000504', 'guest@outside.example'),
  ('00000000-0000-0000-0000-000000000505', 'new1@corp.example'),
  ('00000000-0000-0000-0000-000000000506', 'new2@outside.example'),
  ('00000000-0000-0000-0000-000000000507', 'cuong@corp.example');

select set_config('request.jwt.claim.role', 'service_role', true);
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-000000000501';
update public.profiles set full_name = 'Nguyễn An' where id = '00000000-0000-0000-0000-000000000502';
update public.profiles set full_name = 'Trần Bình' where id = '00000000-0000-0000-0000-000000000503';
update public.profiles set status = 'pending' where id in ('00000000-0000-0000-0000-000000000505', '00000000-0000-0000-0000-000000000506');
select set_config('request.jwt.claim.role', '', true);

set local role authenticated;

-- Only super admins ----------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000502', true);
select throws_ok($$ select * from public.admin_list_groups() $$, '42501', 'FORBIDDEN', 'internal user cannot list groups through the admin function');
select throws_ok($$ select public.admin_create_group('Nope') $$, '42501', 'FORBIDDEN', 'internal user cannot create a group');

-- Create / update ------------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000501', true);

select lives_ok(
  $$ select set_config('t.kas', public.admin_create_group('  KAS ', 'Key accounts')::text, true) $$,
  'super admin creates a group (the name is trimmed)'
);
select lives_ok(
  $$ select set_config('t.ops', public.admin_create_group('Ops')::text, true) $$,
  'a second group'
);
select throws_ok($$ select public.admin_create_group('kas') $$, '23505', 'GROUP_NAME_TAKEN', 'duplicate names are refused, ignoring case');
select throws_ok($$ select public.admin_create_group('   ') $$, '22023', 'VALIDATION_FAILED', 'a blank name is refused');
select throws_ok($$ select public.admin_create_group('Long', repeat('x', 501)) $$, '22023', 'VALIDATION_FAILED', 'a description over 500 characters is refused');
select results_eq(
  $$ select name, description, member_count from public.admin_list_groups() $$,
  $$ values ('KAS', 'Key accounts', 0), ('Ops', null::text, 0) $$,
  'groups are listed by name with their member count'
);

select lives_ok(
  $$ select public.admin_update_group(current_setting('t.ops')::uuid, 'Operations', 'Day to day') $$,
  'super admin edits a group'
);
select throws_ok(
  $$ select public.admin_update_group(current_setting('t.ops')::uuid, 'KAS') $$,
  '23505', 'GROUP_NAME_TAKEN', 'renaming onto an existing name is refused'
);
select throws_ok(
  $$ select public.admin_update_group('70000000-0000-0000-0000-0000000000ff', 'X') $$,
  'P0002', 'GROUP_NOT_FOUND', 'unknown group'
);

-- Members ---------------------------------------------------------------------------------------

select is(
  (select public.admin_add_group_members(current_setting('t.kas')::uuid,
     array['00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-000000000502']::uuid[])),
  2,
  'adds the people (duplicates in the request count once)'
);
select is(
  (select public.admin_add_group_members(current_setting('t.kas')::uuid, array['00000000-0000-0000-0000-000000000502']::uuid[])),
  0,
  'people already in the group are skipped'
);
select throws_ok(
  $$ select public.admin_add_group_members(current_setting('t.kas')::uuid, array['00000000-0000-0000-0000-000000000504']::uuid[]) $$,
  '23514', 'GROUP_MEMBER_NOT_INTERNAL', 'a guest cannot be added'
);
select throws_ok(
  $$ select public.admin_add_group_members(current_setting('t.kas')::uuid, array['00000000-0000-0000-0000-0000000005ff']::uuid[]) $$,
  'P0002', 'USER_NOT_FOUND', 'an unknown user is refused'
);
select throws_ok(
  $$ select public.admin_add_group_members(current_setting('t.kas')::uuid, '{}'::uuid[]) $$,
  '22023', 'VALIDATION_FAILED', 'an empty list is refused'
);
select results_eq(
  $$ select email, full_name from public.admin_list_group_members(current_setting('t.kas')::uuid) $$,
  $$ values ('an@corp.example', 'Nguyễn An'), ('binh@corp.example', 'Trần Bình') $$,
  'members are listed with their profile, by name'
);
select results_eq(
  $$ select name, member_count from public.admin_list_groups() order by name $$,
  $$ values ('KAS', 2), ('Operations', 0) $$,
  'member counts follow'
);

select results_eq(
  $$ select email from public.admin_search_group_candidates(current_setting('t.ops')::uuid, 'nguyen') $$,
  $$ values ('an@corp.example') $$,
  'candidate search ignores accents and finds internal people'
);
select results_eq(
  $$ select email from public.admin_search_group_candidates(current_setting('t.kas')::uuid, 'corp') order by email $$,
  $$ values ('admin@corp.example'), ('cuong@corp.example') $$,
  'candidates exclude current members, guests and accounts that are not active'
);
select is_empty(
  $$ select * from public.admin_search_group_candidates(current_setting('t.kas')::uuid, '  ') $$,
  'a blank query finds nobody'
);

select lives_ok(
  $$ select public.admin_remove_group_member(current_setting('t.kas')::uuid, '00000000-0000-0000-0000-000000000503') $$,
  'removes a member'
);
select lives_ok(
  $$ select public.admin_remove_group_member(current_setting('t.kas')::uuid, '00000000-0000-0000-0000-000000000503') $$,
  'removing someone who is not a member is harmless'
);

-- Approving into groups -------------------------------------------------------------------------

select throws_ok(
  $$ select public.admin_approve_account('00000000-0000-0000-0000-000000000506', true, array[current_setting('t.kas')::uuid]) $$,
  '23514', 'GROUP_MEMBER_NOT_INTERNAL', 'a guest cannot be approved into a group'
);
select throws_ok(
  $$ select public.admin_approve_account('00000000-0000-0000-0000-000000000505', false, array['70000000-0000-0000-0000-0000000000ff']::uuid[]) $$,
  'P0002', 'GROUP_NOT_FOUND', 'an unknown group fails the approval'
);
reset role;
select is(
  (select count(*)::int from public.profiles where status = 'pending' and id in ('00000000-0000-0000-0000-000000000505', '00000000-0000-0000-0000-000000000506')),
  2,
  'failed approvals leave the accounts pending'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000501', true);

select lives_ok(
  $$ select public.admin_approve_account('00000000-0000-0000-0000-000000000505', false,
       array[current_setting('t.kas')::uuid, current_setting('t.ops')::uuid]) $$,
  'an internal user is approved straight into groups'
);
select results_eq(
  $$ select name from public.groups g join public.group_members m on m.group_id = g.id
     where m.user_id = '00000000-0000-0000-0000-000000000505' order by name $$,
  $$ values ('KAS'), ('Operations') $$,
  'they are members of both'
);
select lives_ok(
  $$ select public.admin_approve_account('00000000-0000-0000-0000-000000000506', true) $$,
  'approving without groups still works (two arguments)'
);

-- Delete ----------------------------------------------------------------------------------------

select is(
  (select public.admin_delete_group(current_setting('t.kas')::uuid)),
  2,
  'deleting returns how many members the group had'
);
select results_eq(
  $$ select name from public.admin_list_groups() $$,
  $$ values ('Operations') $$,
  'the group is gone'
);
select throws_ok(
  $$ select public.admin_delete_group(current_setting('t.kas')::uuid) $$,
  'P0002', 'GROUP_NOT_FOUND', 'deleting twice reports the group as unknown'
);

reset role;

-- Audit: the calling admin is the actor -------------------------------------------------------

select is(
  (select count(*)::int from public.audit_logs
    where action in ('group.create', 'group.update', 'group.delete', 'group.member_add', 'group.member_remove')
      and actor_id = '00000000-0000-0000-0000-000000000501'),
  (select count(*)::int from public.audit_logs
    where action in ('group.create', 'group.update', 'group.delete', 'group.member_add', 'group.member_remove')),
  'every group change is attributed to the admin who made it'
);
select is(
  (select count(*)::int from public.audit_logs where action = 'group.member_add'
     and metadata ->> 'email' = 'new1@corp.example'),
  2,
  'approving into groups audits each membership'
);

select * from finish();
rollback;
