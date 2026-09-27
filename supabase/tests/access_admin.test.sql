-- Access administration (T1.7a): allowlist ⇄ sign-in hook ⇄ is_guest sync, admin functions
-- (super admin only), removal impact, self-protection and last-super-admin rules, profile audit.
begin;

select plan(64);

-- Allowlist before the users exist, so app.handle_new_user derives is_guest from it.
insert into public.access_allowlist (id, kind, value) values
  ('40000000-0000-0000-0000-000000000001', 'domain', 'corp.example'),
  ('40000000-0000-0000-0000-000000000002', 'email', 'solo@partner.example');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000201', 'super@corp.example'),
  ('00000000-0000-0000-0000-000000000202', 'super2@corp.example'),
  ('00000000-0000-0000-0000-000000000203', 'internal@corp.example'),
  ('00000000-0000-0000-0000-000000000204', 'member@corp.example'),
  ('00000000-0000-0000-0000-000000000205', 'solo@partner.example'),
  ('00000000-0000-0000-0000-000000000206', 'guest@partner.example'),
  ('00000000-0000-0000-0000-000000000207', 'stranger@partner.example'),
  ('00000000-0000-0000-0000-000000000208', 'deactivated@corp.example');

select set_config('request.jwt.claim.role', 'service_role', true);
update public.profiles set is_super_admin = true
where id in ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000202');
update public.profiles set deactivated_at = now()
where id = '00000000-0000-0000-0000-000000000208';
select set_config('request.jwt.claim.role', '', true);

insert into public.spaces (id, slug, name, visibility, created_by) values
  ('50000000-0000-0000-0000-000000000001', 'access-test', 'Access test', 'restricted', '00000000-0000-0000-0000-000000000201');
insert into public.space_members (space_id, user_id, role, added_by) values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000204', 'editor', '00000000-0000-0000-0000-000000000201'),
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000206', 'viewer', '00000000-0000-0000-0000-000000000201');

select results_eq(
  $$ select email::text, is_guest from public.profiles where id::text like '00000000-0000-0000-0000-0000000002%' order by email $$,
  $$ values ('deactivated@corp.example', false), ('guest@partner.example', true),
            ('internal@corp.example', false), ('member@corp.example', false),
            ('solo@partner.example', false), ('stranger@partner.example', true),
            ('super2@corp.example', false), ('super@corp.example', false) $$,
  'fixture: allowlisted users are internal, the others guests'
);

-- ------------------------------------------------------------ only super admins
set local role authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000203', true);
select throws_ok($$ select * from public.admin_list_access_entries() $$, '42501', 'FORBIDDEN', 'internal user cannot list allowlist entries');
select throws_ok($$ select * from public.admin_list_users() $$, '42501', 'FORBIDDEN', 'internal user cannot list users');
select throws_ok($$ select * from public.admin_access_impact(array['40000000-0000-0000-0000-000000000001'::uuid]) $$, '42501', 'FORBIDDEN', 'internal user cannot preview removal impact');
select throws_ok($$ select public.admin_set_user_deactivated('00000000-0000-0000-0000-000000000204', true) $$, '42501', 'FORBIDDEN', 'internal user cannot deactivate users');
select throws_ok($$ select public.admin_set_super_admin('00000000-0000-0000-0000-000000000203', true) $$, '42501', 'FORBIDDEN', 'internal user cannot grant super admin (not even to self)');
select is_empty($$ select id from public.access_allowlist $$, 'internal user sees no allowlist rows');
select throws_ok(
  $$ insert into public.access_allowlist (kind, value) values ('domain', 'evil.example') $$,
  '42501', null, 'internal user cannot add allowlist entries'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000206', true);
select throws_ok($$ select * from public.admin_list_users() $$, '42501', 'FORBIDDEN', 'guest member cannot list users');
select throws_ok($$ select * from public.admin_list_access_entries() $$, '42501', 'FORBIDDEN', 'guest member cannot list allowlist entries');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000207', true);
select throws_ok($$ select * from public.admin_list_users() $$, '42501', 'FORBIDDEN', 'guest non-member cannot list users');

-- A deactivated super admin is not a super admin.
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-000000000208';
select set_config('request.jwt.claim.role', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000208', true);
select throws_ok($$ select * from public.admin_list_users() $$, '42501', 'FORBIDDEN', 'deactivated super admin cannot list users');
select throws_ok($$ select public.admin_set_user_deactivated('00000000-0000-0000-0000-000000000208', false) $$, '42501', 'FORBIDDEN', 'deactivated super admin cannot reactivate themselves');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
update public.profiles set is_super_admin = false where id = '00000000-0000-0000-0000-000000000208';
select set_config('request.jwt.claim.role', '', true);

set local role anon;
select throws_ok($$ select * from public.admin_list_users() $$, '42501', null, 'anon cannot execute admin functions');
reset role;

-- ------------------------------------------------------------ super admin reads
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000201', true);

select results_eq(
  $$ select kind, value, user_count from public.admin_list_access_entries() $$,
  $$ values ('domain'::text, 'corp.example'::text, 4), ('email', 'solo@partner.example', 1) $$,
  'entries list active users per entry (deactivated users not counted)'
);
select results_eq(
  $$ select kind, value from public.admin_list_access_entries(array['40000000-0000-0000-0000-000000000002'::uuid]) $$,
  $$ values ('email'::text, 'solo@partner.example'::text) $$,
  'entries can be filtered by id'
);

select results_eq(
  $$ select email, access, is_guest, space_count from public.admin_list_users(p_query => '.example')
     where email like '%corp.example' or email like '%partner.example' $$,
  $$ values ('deactivated@corp.example'::text, 'deactivated'::text, false, 0),
            ('guest@partner.example', 'membership', true, 1),
            ('internal@corp.example', 'allowlist', false, 0),
            ('member@corp.example', 'allowlist', false, 1),
            ('solo@partner.example', 'allowlist', false, 0),
            ('stranger@partner.example', 'none', true, 0),
            ('super2@corp.example', 'super_admin', false, 0),
            ('super@corp.example', 'super_admin', false, 1) $$,
  'super admin lists every user, guests included, with why they can sign in'
);
select results_eq(
  $$ select email, total_count from public.admin_list_users(p_query => '@PARTNER.example', p_limit => 2) $$,
  $$ values ('guest@partner.example'::text, 3), ('solo@partner.example', 3) $$,
  'search is case-insensitive; total_count ignores the limit'
);
select results_eq(
  $$ select email from public.admin_list_users(p_query => '@partner.example', p_limit => 2, p_offset => 2) $$,
  $$ values ('stranger@partner.example'::text) $$,
  'offset pages through the results'
);
select results_eq(
  $$ select email from public.admin_list_users(p_query => '@corp.example', p_status => 'deactivated') $$,
  $$ values ('deactivated@corp.example'::text) $$,
  'status filter: deactivated'
);
select is(
  (select count(*)::int from public.admin_list_users(p_query => '.example', p_status => 'active')
   where email like '%@corp.example' or email like '%@partner.example'),
  7,
  'status filter: active'
);
select results_eq(
  $$ select email from public.admin_list_users(p_user_id => '00000000-0000-0000-0000-000000000205') $$,
  $$ values ('solo@partner.example'::text) $$,
  'a single user can be fetched by id'
);
select throws_ok($$ select * from public.admin_list_users(p_status => 'weird') $$, '22023', 'VALIDATION_FAILED', 'unknown status is rejected');

-- ------------------------------------------------------------ removal impact
select results_eq(
  $$ select matched_users, losing_access, becoming_guest from public.admin_access_impact(array['40000000-0000-0000-0000-000000000001'::uuid]) $$,
  $$ values (4, 1, 1) $$,
  'removing the domain: 4 active users matched, 1 signed out, 1 kept as a guest member, super admins unaffected'
);
select results_eq(
  $$ select matched_users, losing_access, becoming_guest from public.admin_access_impact(
       array['40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002']::uuid[]) $$,
  $$ values (5, 2, 1) $$,
  'impact of removing several entries at once'
);
select results_eq(
  $$ select matched_users, losing_access, becoming_guest from public.admin_access_impact('{}') $$,
  $$ values (0, 0, 0) $$,
  'no entries, no impact'
);

-- ------------------------------------------------------------ allowlist ⇄ sign-in hook
reset role;
select is(
  app.before_user_created_hook('{"user": {"email": "new-solo@partner.example"}}'::jsonb) -> 'error' ->> 'message',
  'AUTH_NOT_ALLOWED',
  'an email outside the allowlist cannot sign up'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000201', true);
insert into public.access_allowlist (kind, value, created_by)
values ('email', 'new-solo@partner.example', '00000000-0000-0000-0000-000000000201');
reset role;
select is(
  app.before_user_created_hook('{"user": {"email": "new-solo@partner.example"}}'::jsonb),
  '{}'::jsonb,
  'adding one email lets that person sign up immediately'
);
select is(
  app.before_user_created_hook('{"user": {"email": "colleague@partner.example"}}'::jsonb) -> 'error' ->> 'message',
  'AUTH_NOT_ALLOWED',
  'others in the same domain are still blocked'
);
select is(
  (select is_guest from public.profiles where id = '00000000-0000-0000-0000-000000000206'),
  true,
  'an email entry does not change other users of the domain'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000201', true);
insert into public.access_allowlist (id, kind, value, created_by)
values ('40000000-0000-0000-0000-000000000003', 'domain', 'partner.example', '00000000-0000-0000-0000-000000000201');
reset role;
select is(
  app.before_user_created_hook('{"user": {"email": "colleague@partner.example"}}'::jsonb),
  '{}'::jsonb,
  'adding the domain lets the whole domain sign up'
);
select results_eq(
  $$ select is_guest from public.profiles where id in ('00000000-0000-0000-0000-000000000206', '00000000-0000-0000-0000-000000000207') order by id $$,
  array[false, false],
  'existing guests of an added domain become internal users'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000201', true);
delete from public.access_allowlist where id = '40000000-0000-0000-0000-000000000003';
reset role;
select results_eq(
  $$ select email::text, is_guest from public.profiles where email::text like '%@partner.example' order by email $$,
  $$ values ('guest@partner.example'::text, true), ('solo@partner.example', false), ('stranger@partner.example', true) $$,
  'removing the domain turns its users back into guests, except those with their own email entry'
);

-- Remove corp.example: internal@ loses access, member@ keeps its Space as a guest, super admins stay.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000201', true);
delete from public.access_allowlist where id = '40000000-0000-0000-0000-000000000001';
select results_eq(
  $$ select email, access, is_guest from public.admin_list_users(p_query => '@corp.example') $$,
  $$ values ('deactivated@corp.example'::text, 'deactivated'::text, true),
            ('internal@corp.example', 'none', true),
            ('member@corp.example', 'membership', true),
            ('super2@corp.example', 'super_admin', false),
            ('super@corp.example', 'super_admin', false) $$,
  'after removing the domain: access follows has_active_access semantics'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000203', true);
select is(public.has_active_access(), false, 'a removed user with no membership fails the per-request access check');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000204', true);
select is(public.has_active_access(), true, 'a removed user with a Space membership keeps access');
select is(app.space_role('50000000-0000-0000-0000-000000000001'), 'editor'::public.space_role, '…to their own Spaces');

-- Put the domain back for the rest of the tests.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000201', true);
insert into public.access_allowlist (id, kind, value, created_by)
values ('40000000-0000-0000-0000-000000000001', 'domain', 'corp.example', '00000000-0000-0000-0000-000000000201');
select is(
  (select count(*)::int from public.admin_list_users(p_query => '@corp.example') where is_guest),
  0,
  're-adding the domain makes its users internal again'
);

-- ------------------------------------------------------------ cannot remove yourself
insert into public.access_allowlist (id, kind, value, created_by)
values ('40000000-0000-0000-0000-000000000004', 'email', 'super@corp.example', '00000000-0000-0000-0000-000000000201');
select results_eq(
  $$ with d as (delete from public.access_allowlist where id = '40000000-0000-0000-0000-000000000004' returning 1)
     select count(*)::int from d $$,
  array[0],
  'a super admin cannot remove the entry of their own email'
);
select throws_ok($$ select public.admin_set_user_deactivated('00000000-0000-0000-0000-000000000201', true) $$, '42501', 'USER_CANNOT_CHANGE_SELF', 'a super admin cannot deactivate themselves');
select throws_ok($$ select public.admin_set_super_admin('00000000-0000-0000-0000-000000000201', false) $$, '42501', 'USER_CANNOT_CHANGE_SELF', 'a super admin cannot revoke their own super admin');
select lives_ok($$ select public.admin_set_super_admin('00000000-0000-0000-0000-000000000201', true) $$, 'granting super admin to yourself again is a no-op');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000202', true);
select results_eq(
  $$ with d as (delete from public.access_allowlist where id = '40000000-0000-0000-0000-000000000004' returning 1)
     select count(*)::int from d $$,
  array[1],
  'another super admin can remove it'
);

-- ------------------------------------------------------------ lock / unlock, grant / revoke
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000201', true);
select lives_ok($$ select public.admin_set_user_deactivated('00000000-0000-0000-0000-000000000203', true) $$, 'super admin deactivates a user');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000203', true);
select is(public.has_active_access(), false, 'a deactivated user fails the per-request access check');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000201', true);
select lives_ok($$ select public.admin_set_user_deactivated('00000000-0000-0000-0000-000000000203', false) $$, 'super admin reactivates the user');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000203', true);
select is(public.has_active_access(), true, 'a reactivated allowlisted user has access again');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000201', true);
select throws_ok($$ select public.admin_set_user_deactivated('00000000-0000-0000-0000-0000000002ff', true) $$, 'P0002', 'USER_NOT_FOUND', 'unknown user');
select throws_ok($$ select public.admin_set_super_admin('00000000-0000-0000-0000-000000000207', true) $$, '23514', 'USER_IS_GUEST', 'a guest cannot be made super admin');
select throws_ok($$ select public.admin_set_super_admin('00000000-0000-0000-0000-000000000208', true) $$, '23514', 'USER_DEACTIVATED', 'a deactivated user cannot be made super admin');

select lives_ok($$ select public.admin_set_super_admin('00000000-0000-0000-0000-000000000203', true) $$, 'super admin grants super admin to an internal user');
select lives_ok($$ select public.admin_set_super_admin('00000000-0000-0000-0000-000000000202', false) $$, 'super admin revokes another super admin');
select lives_ok($$ select public.admin_set_user_deactivated('00000000-0000-0000-0000-000000000203', true) $$, 'a super admin can deactivate another super admin while one stays active');

reset role;
select results_eq(
  $$ select action, actor_id, entity_type, metadata ->> 'email' from public.audit_logs
     where entity_type = 'user' and actor_id = '00000000-0000-0000-0000-000000000201' order by id $$,
  $$ values ('user.deactivate'::text, '00000000-0000-0000-0000-000000000201'::uuid, 'user'::text, 'internal@corp.example'::text),
            ('user.reactivate', '00000000-0000-0000-0000-000000000201'::uuid, 'user', 'internal@corp.example'),
            ('user.super_admin_grant', '00000000-0000-0000-0000-000000000201'::uuid, 'user', 'internal@corp.example'),
            ('user.super_admin_revoke', '00000000-0000-0000-0000-000000000201'::uuid, 'user', 'super2@corp.example'),
            ('user.deactivate', '00000000-0000-0000-0000-000000000201'::uuid, 'user', 'internal@corp.example') $$,
  'lock/unlock and super admin changes are audited with the actor'
);
select results_eq(
  $$ select action from public.audit_logs where entity_type = 'access_entry' and actor_id = '00000000-0000-0000-0000-000000000201' order by id $$,
  array['access.add', 'access.add', 'access.remove', 'access.remove', 'access.add', 'access.add'],
  'allowlist changes made through the admin screens are audited (access.add / access.remove)'
);

-- ------------------------------------------------------------ last super admin
-- 201 is now the only active super admin of the fixture (202 revoked, 203 deactivated); demote any
-- other super admin a previous run left in the local DB so 201 is the last one.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
update public.profiles set is_super_admin = false
where is_super_admin and id <> '00000000-0000-0000-0000-000000000201';
select throws_ok(
  $$ update public.profiles set is_super_admin = false where id = '00000000-0000-0000-0000-000000000201' $$,
  '23514', 'LAST_SUPER_ADMIN', 'the last active super admin cannot be demoted, even by service_role'
);
select throws_ok(
  $$ update public.profiles set deactivated_at = now() where id = '00000000-0000-0000-0000-000000000201' $$,
  '23514', 'LAST_SUPER_ADMIN', 'the last active super admin cannot be deactivated'
);
select set_config('request.jwt.claim.role', '', true);

-- ------------------------------------------------------------ clients cannot flip flags themselves
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000207', true);
select throws_ok(
  $$ update public.profiles set is_guest = false where id = '00000000-0000-0000-0000-000000000207' $$,
  '42501', null, 'a guest cannot make themselves internal'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000205', true);
select throws_ok(
  $$ update public.profiles set deactivated_at = null, is_super_admin = true where id = '00000000-0000-0000-0000-000000000205' $$,
  '42501', null, 'an internal user cannot grant themselves super admin'
);

-- ------------------------------------------------------------ case-insensitive matching (T1.2a fix)
reset role;
select set_config('request.jwt.claim.sub', '', true);
insert into public.access_allowlist (kind, value) values
  ('email', 'Mixed.Case@Other.example'),
  ('domain', 'UPPER.example');
select is(
  app.before_user_created_hook('{"user": {"email": "mixed.case@other.example"}}'::jsonb),
  '{}'::jsonb,
  'sign-up hook matches an email entry case-insensitively'
);
select is(
  app.before_user_created_hook('{"user": {"email": "Someone@upper.EXAMPLE"}}'::jsonb),
  '{}'::jsonb,
  'sign-up hook matches a domain entry case-insensitively'
);
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000209', 'mixed.case@other.example');
select is(
  (select is_guest from public.profiles where id = '00000000-0000-0000-0000-000000000209'),
  false,
  'the new profile is internal (allowlist matched case-insensitively)'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000209', true);
select is(public.has_active_access(), true, 'has_active_access matches case-insensitively');
reset role;
set local role anon;
select throws_ok($$ select public.has_active_access() $$, '42501', null, 'anon cannot call has_active_access');
reset role;

select * from finish();

rollback;
