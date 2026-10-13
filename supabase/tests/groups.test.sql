-- User groups: who may read and change groups and memberships, who can be a member, and the audit.
begin;

select plan(30);

insert into public.access_allowlist (kind, value) values ('domain', 'corp.example');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000401', 'admin@corp.example'),
  ('00000000-0000-0000-0000-000000000402', 'an@corp.example'),
  ('00000000-0000-0000-0000-000000000403', 'binh@corp.example'),
  ('00000000-0000-0000-0000-000000000404', 'guest@outside.example'),
  ('00000000-0000-0000-0000-000000000405', 'pending@corp.example'),
  ('00000000-0000-0000-0000-000000000406', 'locked@corp.example');

select set_config('request.jwt.claim.role', 'service_role', true);
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-000000000401';
update public.profiles set status = 'pending' where id = '00000000-0000-0000-0000-000000000405';
update public.profiles set deactivated_at = now() where id = '00000000-0000-0000-0000-000000000406';
select set_config('request.jwt.claim.role', '', true);

-- Super admin manages groups -------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', true);

select lives_ok(
  $$ insert into public.groups (id, name, description) values ('70000000-0000-0000-0000-000000000001', 'KAS', 'Key account sales') $$,
  'super admin creates a group'
);
select is(
  (select created_by from public.groups where id = '70000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-000000000401'::uuid,
  'the creator is recorded'
);
select throws_ok(
  $$ insert into public.groups (name) values ('kas') $$,
  '23505', null, 'group names are unique ignoring case'
);
select throws_ok(
  $$ insert into public.groups (name) values ('  Padded') $$,
  '23514', null, 'names cannot start or end with spaces'
);
select throws_ok(
  $$ insert into public.groups (name) values ('') $$,
  '23514', null, 'names cannot be empty'
);
select throws_ok(
  $$ update public.groups set created_by = null where id = '70000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'only name and description can be edited'
);

select lives_ok(
  $$ insert into public.group_members (group_id, user_id) values
       ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000402'),
       ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000403') $$,
  'super admin adds internal users'
);
select is(
  (select count(*)::int from public.group_members where added_by = '00000000-0000-0000-0000-000000000401'),
  2,
  'who added each member is recorded'
);
select throws_ok(
  $$ insert into public.group_members (group_id, user_id) values ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000404') $$,
  '23514', 'GROUP_MEMBER_NOT_INTERNAL', 'a guest cannot join a group'
);
select throws_ok(
  $$ insert into public.group_members (group_id, user_id) values ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000405') $$,
  '23514', 'GROUP_MEMBER_NOT_INTERNAL', 'a pending account cannot join a group'
);
select throws_ok(
  $$ insert into public.group_members (group_id, user_id) values ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000406') $$,
  '23514', 'GROUP_MEMBER_NOT_INTERNAL', 'a deactivated account cannot join a group'
);
select throws_ok(
  $$ insert into public.group_members (group_id, user_id) values ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000402') $$,
  '23505', null, 'a person joins a group once'
);
select is((select count(*)::int from public.group_members), 2, 'super admin sees every membership');

-- Internal users read groups, but change nothing ----------------------------------------------

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000402', true);

select is((select count(*)::int from public.groups), 1, 'an internal user sees the groups');
select is(
  (select count(*)::int from public.group_members),
  1,
  'a member only sees their own membership'
);
select throws_ok(
  $$ insert into public.groups (name) values ('Sneaky') $$,
  '42501', null, 'an internal user cannot create a group'
);
select throws_ok(
  $$ insert into public.group_members (group_id, user_id) values ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000402') $$,
  '42501', null, 'an internal user cannot add members'
);
update public.groups set name = 'Hacked' where id = '70000000-0000-0000-0000-000000000001';
delete from public.groups where id = '70000000-0000-0000-0000-000000000001';
delete from public.group_members where user_id = '00000000-0000-0000-0000-000000000403';
reset role;
select is(
  (select name || ':' || (select count(*) from public.group_members) from public.groups where id = '70000000-0000-0000-0000-000000000001'),
  'KAS:2',
  'an internal user cannot rename or delete groups, nor remove members'
);

-- Guests and outsiders see nothing -------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000404', true);
select is_empty($$ select id from public.groups $$, 'a guest sees no groups');
select is_empty($$ select user_id from public.group_members $$, 'a guest sees no memberships');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000405', true);
select is_empty($$ select id from public.groups $$, 'a pending account sees no groups');

-- Super admin edits, removes and deletes -------------------------------------------------------

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', true);

select lives_ok(
  $$ update public.groups set name = 'KAS team', description = null where id = '70000000-0000-0000-0000-000000000001' $$,
  'super admin renames a group'
);
select lives_ok(
  $$ delete from public.group_members where user_id = '00000000-0000-0000-0000-000000000403' $$,
  'super admin removes a member'
);

insert into public.groups (id, name) values ('70000000-0000-0000-0000-000000000002', 'Temp');
insert into public.group_members (group_id, user_id) values
  ('70000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000402'),
  ('70000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000403');
delete from public.groups where id = '70000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.group_members where group_id = '70000000-0000-0000-0000-000000000002'),
  0,
  'deleting a group removes its memberships'
);

reset role;

-- Audit ----------------------------------------------------------------------------------------

select is(
  (select metadata ->> 'name' from public.audit_logs where action = 'group.create' and entity_id = '70000000-0000-0000-0000-000000000001'),
  'KAS',
  'group creation is audited'
);
select is(
  (select count(*)::int from public.audit_logs where action = 'group.member_add' and entity_id = '70000000-0000-0000-0000-000000000001'),
  2,
  'each member added is audited'
);
select is(
  (select metadata ->> 'email' from public.audit_logs where action = 'group.member_remove' and entity_id = '70000000-0000-0000-0000-000000000001'),
  'binh@corp.example',
  'a removed member is audited with their email'
);
select is(
  (select metadata #>> '{name,to}' from public.audit_logs where action = 'group.update' and entity_id = '70000000-0000-0000-0000-000000000001'),
  'KAS team',
  'a rename is audited with before and after'
);
select is(
  (select (metadata ->> 'member_count')::int from public.audit_logs where action = 'group.delete' and entity_id = '70000000-0000-0000-0000-000000000002'),
  2,
  'deleting a group is audited with its member count'
);
select is(
  (select count(*)::int from public.audit_logs where action = 'group.member_remove' and entity_id = '70000000-0000-0000-0000-000000000002'),
  0,
  'the cascade adds no per-member entries'
);

select * from finish();
rollback;
