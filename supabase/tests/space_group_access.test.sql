-- Space access through groups: the effective role is the highest of direct membership, group
-- grants and viewer on an internal Space; only active internal users get group access; Space admins
-- manage grants; everything is audited.
begin;

select plan(51);

insert into public.access_allowlist (kind, value) values ('domain', 'corp.example');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000701', 'super@corp.example'),
  ('00000000-0000-0000-0000-000000000702', 'spaceadmin@corp.example'),
  ('00000000-0000-0000-0000-000000000703', 'directviewer@corp.example'),
  ('00000000-0000-0000-0000-000000000704', 'kas@corp.example'),
  ('00000000-0000-0000-0000-000000000705', 'ops@corp.example'),
  ('00000000-0000-0000-0000-000000000706', 'both@corp.example'),
  ('00000000-0000-0000-0000-000000000707', 'outsider@corp.example'),
  ('00000000-0000-0000-0000-000000000708', 'flipped@corp.example'),
  ('00000000-0000-0000-0000-000000000709', 'pending@corp.example'),
  ('00000000-0000-0000-0000-000000000710', 'locked@corp.example'),
  ('00000000-0000-0000-0000-000000000711', 'mixed@corp.example'),
  ('00000000-0000-0000-0000-000000000712', 'ext@outside.example');

select set_config('request.jwt.claim.role', 'service_role', true);
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-000000000701';
update public.profiles set is_guest = false where id = '00000000-0000-0000-0000-000000000712';

insert into public.spaces (id, slug, name, visibility, created_by) values
  ('80000000-0000-0000-0000-000000000001', 'sg-restricted', 'Restricted', 'restricted', '00000000-0000-0000-0000-000000000702'),
  ('80000000-0000-0000-0000-000000000002', 'sg-internal', 'Internal', 'internal', '00000000-0000-0000-0000-000000000702'),
  ('80000000-0000-0000-0000-000000000003', 'sg-other', 'Other', 'restricted', '00000000-0000-0000-0000-000000000702');
-- 702 is admin of all three (creator). 703 and 711 are direct viewers of the restricted Space.
insert into public.space_members (space_id, user_id, role) values
  ('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000703', 'viewer'),
  ('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000711', 'viewer');

insert into public.groups (id, name) values
  ('90000000-0000-0000-0000-000000000001', 'KAS'),
  ('90000000-0000-0000-0000-000000000002', 'OPS');

-- KAS: editor on the restricted and the internal Space. OPS: viewer on the restricted and other.
insert into public.space_groups (space_id, group_id, role) values
  ('80000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'editor'),
  ('80000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', 'editor'),
  ('80000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 'viewer'),
  ('80000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000002', 'viewer');

insert into public.group_members (group_id, user_id) values
  ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000704'),
  ('90000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000705'),
  ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000706'),
  ('90000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000706'),
  ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000711'),
  ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000708'),
  ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000709'),
  ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000710');
-- They joined as active internal users; now they are a guest, pending and locked.
update public.profiles set is_guest = true where id = '00000000-0000-0000-0000-000000000708';
update public.profiles set status = 'pending' where id = '00000000-0000-0000-0000-000000000709';
update public.profiles set deactivated_at = now() where id = '00000000-0000-0000-0000-000000000710';
select set_config('request.jwt.claim.role', '', true);

-- Effective roles -------------------------------------------------------------------------------

select is(app.user_space_role('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000704'), 'editor'::public.space_role, 'a KAS member is an editor of the Space KAS is granted');
select is(app.user_space_role('80000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000704'), null, 'and has nothing in a Space KAS is not granted');
select is(app.user_space_role('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000704'), 'editor'::public.space_role, 'a group role beats viewer on an internal Space');
select is(app.user_space_role('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000705'), 'viewer'::public.space_role, 'an OPS member is a viewer');
select is(app.user_space_role('80000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000705'), 'viewer'::public.space_role, 'OPS reaches the other Space too');
select is(app.user_space_role('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000706'), 'editor'::public.space_role, 'in two groups, the highest role wins (editor over viewer)');
select is(app.user_space_role('80000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000706'), 'viewer'::public.space_role, 'in two groups, each Space follows its own grants');
select is(app.user_space_role('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000711'), 'editor'::public.space_role, 'a direct viewer who is also in an editor group is an editor');
select is(app.user_space_role('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000703'), 'viewer'::public.space_role, 'a direct member outside any group keeps their direct role');
select is(app.user_space_role('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000702'), 'admin'::public.space_role, 'a direct admin stays admin');
select is(app.user_space_role('80000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000701'), 'admin'::public.space_role, 'a super admin is admin everywhere');
select is(app.user_space_role('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000707'), null, 'an internal user with no membership and no group has no access to a restricted Space');
select is(app.user_space_role('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000707'), 'viewer'::public.space_role, 'but still reads an internal Space');
select is(app.user_space_role('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000708'), null, 'a group member who became a guest gets nothing through the group');
select is(app.user_space_role('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000709'), null, 'a pending account gets nothing through the group');
select is(app.user_space_role('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000710'), null, 'a locked account gets nothing through the group');

-- Through RLS, as the person ----------------------------------------------------------------------

set local role authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000704', true);
select is((select count(*)::int from public.spaces), 2, 'a KAS member sees the Spaces KAS reaches (restricted + internal), not the other');
select is(app.can_edit_space('80000000-0000-0000-0000-000000000001'), true, 'and can edit the restricted one');
select is(app.is_space_admin('80000000-0000-0000-0000-000000000001'), false, 'but is not an admin through a group');
select throws_ok(
  $$ insert into public.space_groups (space_id, group_id, role) values ('80000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000001', 'viewer') $$,
  '42501', null, 'a group editor cannot grant access'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000705', true);
select is((select count(*)::int from public.spaces), 3, 'an OPS member sees restricted, internal (read) and other');
select is(app.can_edit_space('80000000-0000-0000-0000-000000000001'), false, 'viewer through the group cannot edit');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000707', true);
select is((select count(*)::int from public.spaces), 1, 'an outsider only sees the internal Space');
select is_empty($$ select * from public.space_groups where space_id = '80000000-0000-0000-0000-000000000001' $$, 'and none of the grants of a Space they cannot view');
select throws_ok($$ select * from public.list_space_groups('80000000-0000-0000-0000-000000000001') $$, '42501', 'FORBIDDEN', 'nor the list of groups of that Space');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000708', true);
select is((select count(*)::int from public.spaces), 0, 'a former internal user who is now a guest sees nothing through the group');

-- Grants: only Space admins write, viewers read ------------------------------------------------------

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000703', true);
select is((select count(*)::int from public.space_groups where space_id = '80000000-0000-0000-0000-000000000001'), 2, 'a direct viewer reads the grants of their Space');
select results_eq(
  $$ select name, role::text, member_count from public.list_space_groups('80000000-0000-0000-0000-000000000001') $$,
  $$ values ('KAS', 'editor', 6), ('OPS', 'viewer', 2) $$,
  'the list shows each group with its role and member count'
);
select throws_ok(
  $$ insert into public.space_groups (space_id, group_id, role) values ('80000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'viewer') on conflict do nothing $$,
  '42501', null, 'a viewer cannot grant access'
);
select throws_ok($$ select * from public.search_grantable_groups('80000000-0000-0000-0000-000000000001', 'k') $$, '42501', 'FORBIDDEN', 'a viewer cannot search groups to grant');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000702', true);
select results_eq(
  $$ select name from public.search_grantable_groups('80000000-0000-0000-0000-000000000003', 'ka') $$,
  $$ values ('KAS') $$,
  'a Space admin finds the groups not granted yet'
);
select is_empty(
  $$ select name from public.search_grantable_groups('80000000-0000-0000-0000-000000000001', 'ka') $$,
  'groups already granted are not offered again'
);
select lives_ok(
  $$ insert into public.space_groups (space_id, group_id, role) values ('80000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000001', 'viewer') $$,
  'a Space admin grants a group'
);
select throws_ok(
  $$ insert into public.space_groups (space_id, group_id, role) values ('80000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000002', 'admin') $$,
  '23514', null, 'a group can never be a Space admin'
);
select lives_ok(
  $$ update public.space_groups set role = 'editor' where space_id = '80000000-0000-0000-0000-000000000003' and group_id = '90000000-0000-0000-0000-000000000001' $$,
  'a Space admin changes a group role'
);
select throws_ok(
  $$ update public.space_groups set group_id = '90000000-0000-0000-0000-000000000002' where space_id = '80000000-0000-0000-0000-000000000003' $$,
  '42501', null, 'only the role can be changed'
);
select lives_ok(
  $$ delete from public.space_groups where space_id = '80000000-0000-0000-0000-000000000003' and group_id = '90000000-0000-0000-0000-000000000001' $$,
  'a Space admin revokes a grant'
);

-- Membership changes move access at once ------------------------------------------------------

reset role;
delete from public.group_members where group_id = '90000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-000000000704';
select is(app.user_space_role('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000704'), null, 'leaving the group removes the access');
insert into public.group_members (group_id, user_id) values ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000704');
select is(app.user_space_role('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000704'), 'editor'::public.space_role, 'joining it again gives it back');

-- Session: a person who only reaches Spaces through a group keeps their session ---------------------

insert into public.group_members (group_id, user_id) values ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000712');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000712', true);
select is(app.has_active_access(), true, 'group membership keeps the session of someone off the allowlist');
reset role;
delete from public.group_members where user_id = '00000000-0000-0000-0000-000000000712';
set local role authenticated;
select is(app.has_active_access(), false, 'and losing it ends the session');
reset role;

-- Admin screens --------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000701', true);
select results_eq(
  $$ select name, space_count from public.admin_list_groups() $$,
  $$ values ('KAS', 2), ('OPS', 2) $$,
  'the group list counts the Spaces each group reaches'
);
select results_eq(
  $$ select slug, role::text from public.admin_list_group_spaces('90000000-0000-0000-0000-000000000002') $$,
  $$ values ('sg-other', 'viewer'), ('sg-restricted', 'viewer') $$,
  'the Spaces of a group are listed with their role'
);

-- Deleting a group removes its grants, audited once -------------------------------------------------

select lives_ok(
  $$ select public.admin_delete_group('90000000-0000-0000-0000-000000000001') $$,
  'deleting a group'
);
reset role;
select is(app.user_space_role('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000711'), 'viewer'::public.space_role, 'its members fall back to their other sources (direct viewer)');
select is(app.user_space_role('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000704'), 'viewer'::public.space_role, 'or to viewer on an internal Space');

-- Audit -------------------------------------------------------------------------------------------

select is(
  (select count(*)::int from public.audit_logs where action = 'member.group_add' and space_id = '80000000-0000-0000-0000-000000000003' and metadata ->> 'name' = 'KAS' and metadata ->> 'role' = 'viewer'),
  1,
  'granting a group is audited in the Space scope'
);
select is(
  (select metadata ->> 'to_role' from public.audit_logs where action = 'member.group_role_change' and space_id = '80000000-0000-0000-0000-000000000003'),
  'editor',
  'a role change is audited with its new role'
);
select is(
  (select count(*)::int from public.audit_logs where action = 'member.group_remove' and space_id = '80000000-0000-0000-0000-000000000003'),
  1,
  'revoking is audited'
);
select is(
  (select (metadata ->> 'space_count')::int from public.audit_logs where action = 'group.delete' and entity_id = '90000000-0000-0000-0000-000000000001'),
  2,
  'deleting a group records how many Spaces it reached'
);
select is(
  (select count(*)::int from public.audit_logs where action = 'member.group_remove' and metadata ->> 'name' = 'KAS' and space_id in ('80000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002')),
  0,
  'the cascade adds no per-Space revoke entries'
);

select * from finish();
rollback;
