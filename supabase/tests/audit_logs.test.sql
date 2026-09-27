begin;

select plan(40);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'super@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'admin@example.com'),
  ('00000000-0000-0000-0000-000000000003', 'editor@example.com'),
  ('00000000-0000-0000-0000-000000000004', 'viewer@example.com'),
  ('00000000-0000-0000-0000-000000000005', 'internal@example.com'),
  ('00000000-0000-0000-0000-000000000006', 'guest@example.net'),
  ('00000000-0000-0000-0000-000000000007', 'guest-outside@example.net'),
  ('00000000-0000-0000-0000-000000000008', 'deactivated@example.com');

-- T1.2a creates profiles from auth.users. Override the fixture flags as service_role instead of
-- inserting duplicate primary keys.
select set_config('request.jwt.claim.role', 'service_role', true);

update public.profiles as p set
  full_name = v.full_name,
  is_guest = v.is_guest,
  is_super_admin = v.is_super_admin,
  deactivated_at = v.deactivated_at
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid, 'Super', false, true, null::timestamptz),
  ('00000000-0000-0000-0000-000000000002'::uuid, 'Admin', false, false, null::timestamptz),
  ('00000000-0000-0000-0000-000000000003'::uuid, 'Editor', false, false, null::timestamptz),
  ('00000000-0000-0000-0000-000000000004'::uuid, 'Viewer', false, false, null::timestamptz),
  ('00000000-0000-0000-0000-000000000005'::uuid, 'Internal', false, false, null::timestamptz),
  ('00000000-0000-0000-0000-000000000006'::uuid, 'Guest', true, false, null::timestamptz),
  ('00000000-0000-0000-0000-000000000007'::uuid, 'Outside', true, false, null::timestamptz),
  ('00000000-0000-0000-0000-000000000008'::uuid, 'Deactivated', false, false, now())
) as v(id, full_name, is_guest, is_super_admin, deactivated_at)
where p.id = v.id;

select set_config('request.jwt.claim.role', '', true);

-- Fixture writes happen as the migration owner: no actor.
insert into public.spaces (id, slug, name, visibility, created_by) values
  ('10000000-0000-0000-0000-000000000009', 'other', 'Other', 'internal', '00000000-0000-0000-0000-000000000005');

set local role authenticated;

-- ---------------------------------------------------------------- spaces
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select set_config('request.headers', '{"x-request-id": "req-create-space"}', true);

insert into public.spaces (id, slug, name, visibility, created_by) values
  ('10000000-0000-0000-0000-000000000001', 'restricted', 'Restricted', 'restricted', '00000000-0000-0000-0000-000000000002');

select results_eq(
  $$ select action, actor_id, entity_id, request_id from public.audit_logs
     where space_id = '10000000-0000-0000-0000-000000000001' order by id $$,
  $$ values ('space.create'::text, '00000000-0000-0000-0000-000000000002'::uuid, '10000000-0000-0000-0000-000000000001'::uuid, 'req-create-space'::text),
            ('member.add', '00000000-0000-0000-0000-000000000002'::uuid, '00000000-0000-0000-0000-000000000002'::uuid, 'req-create-space') $$,
  'creating a space logs space.create and the creator''s member.add with actor and request id'
);

select is(
  (select metadata from public.audit_logs where action = 'space.create'
     and space_id = '10000000-0000-0000-0000-000000000001'),
  '{"name": "Restricted", "slug": "restricted", "visibility": "restricted"}'::jsonb,
  'space.create stores name, slug and visibility'
);

select set_config('request.headers', '', true);

update public.spaces set name = 'Restricted 2', visibility = 'internal'
where id = '10000000-0000-0000-0000-000000000001';

select is(
  (select metadata from public.audit_logs where action = 'space.update'
     and space_id = '10000000-0000-0000-0000-000000000001'),
  '{"changes": {"name": {"from": "Restricted", "to": "Restricted 2"}, "visibility": {"from": "restricted", "to": "internal"}}}'::jsonb,
  'space.update stores from/to of changed columns only'
);

update public.spaces set name = 'Restricted 2' where id = '10000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.audit_logs where action = 'space.update'
     and space_id = '10000000-0000-0000-0000-000000000001'),
  1,
  'an update that changes nothing audited writes no row'
);

update public.spaces set visibility = 'restricted' where id = '10000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------- members
insert into public.space_members (space_id, user_id, role, added_by) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'viewer', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'viewer', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000006', 'viewer', '00000000-0000-0000-0000-000000000002');

select is(
  (select count(*)::int from public.audit_logs where action = 'member.add'
     and space_id = '10000000-0000-0000-0000-000000000001'),
  4,
  'member.add is logged for every inserted member'
);

update public.space_members set role = 'editor'
where space_id = '10000000-0000-0000-0000-000000000001'
  and user_id = '00000000-0000-0000-0000-000000000003';

select is(
  (select metadata from public.audit_logs where action = 'member.role_change'),
  '{"user_id": "00000000-0000-0000-0000-000000000003", "from_role": "viewer", "to_role": "editor"}'::jsonb,
  'changing a role logs member.role_change with from/to'
);
select is(
  (select actor_id from public.audit_logs where action = 'member.role_change'),
  '00000000-0000-0000-0000-000000000002'::uuid,
  'member.role_change records the admin as actor'
);

update public.space_members set role = 'editor'
where space_id = '10000000-0000-0000-0000-000000000001'
  and user_id = '00000000-0000-0000-0000-000000000003';
select is(
  (select count(*)::int from public.audit_logs where action = 'member.role_change'),
  1,
  'setting the same role again writes no role_change'
);

-- A viewer leaves the space by themselves.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
delete from public.space_members
where space_id = '10000000-0000-0000-0000-000000000001'
  and user_id = '00000000-0000-0000-0000-000000000004';

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select is(
  (select metadata from public.audit_logs where action = 'member.remove'),
  '{"user_id": "00000000-0000-0000-0000-000000000004", "role": "viewer", "self": true}'::jsonb,
  'leaving a space logs member.remove flagged as self'
);

-- ---------------------------------------------------------------- invitations
insert into public.invitations (id, email, space_id, role, token_hash, invited_by) values
  ('20000000-0000-0000-0000-000000000001', 'invitee@example.net', '10000000-0000-0000-0000-000000000001',
   'viewer', 'secret-token-hash', '00000000-0000-0000-0000-000000000002');

select ok(
  (select metadata ->> 'email' = 'invitee@example.net' and metadata ->> 'role' = 'viewer'
          and not metadata ? 'token_hash'
     from public.audit_logs where action = 'invitation.create'),
  'invitation.create stores email and role but never the token hash'
);

update public.invitations set revoked_at = now() where id = '20000000-0000-0000-0000-000000000001';
select is(
  (select entity_id from public.audit_logs where action = 'invitation.revoke'),
  '20000000-0000-0000-0000-000000000001'::uuid,
  'revoking an invitation logs invitation.revoke'
);

-- ---------------------------------------------------------------- archive
update public.spaces set archived_at = now() where id = '10000000-0000-0000-0000-000000000001';

-- Archived spaces are invisible to everyone (T1.1 app.space_role), so check as the super admin
-- and unarchive through a server job (service_role + app.actor_id).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is(
  (select actor_id from public.audit_logs where action = 'space.archive'
     and space_id = '10000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-000000000002'::uuid,
  'archiving a space logs space.archive'
);
select is(
  (select count(*)::int from public.audit_logs where action = 'space.update'
     and space_id = '10000000-0000-0000-0000-000000000001'),
  2,
  'archiving is not also logged as space.update'
);

set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('app.actor_id', '00000000-0000-0000-0000-000000000001', true);
update public.spaces set archived_at = null where id = '10000000-0000-0000-0000-000000000001';
select set_config('app.actor_id', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is(
  (select actor_id from public.audit_logs where action = 'space.unarchive'),
  '00000000-0000-0000-0000-000000000001'::uuid,
  'unarchiving a space logs space.unarchive'
);

-- ---------------------------------------------------------------- settings & access
update public.app_settings set ai_enabled = true where id = 1;
select is(
  (select metadata from public.audit_logs where action = 'settings.update'),
  '{"changes": {"ai_enabled": {"from": false, "to": true}}}'::jsonb,
  'changing app settings logs settings.update'
);
select is(
  (select space_id from public.audit_logs where action = 'settings.update'),
  null::uuid,
  'settings.update has no space'
);

insert into public.access_allowlist (id, kind, value, note, created_by) values
  ('30000000-0000-0000-0000-000000000001', 'domain', 'example.org', 'Ops', '00000000-0000-0000-0000-000000000001');
update public.access_allowlist set note = 'Operations' where id = '30000000-0000-0000-0000-000000000001';
delete from public.access_allowlist where id = '30000000-0000-0000-0000-000000000001';

select results_eq(
  $$ select action from public.audit_logs where entity_id = '30000000-0000-0000-0000-000000000001' order by id $$,
  array['access.add', 'access.update', 'access.remove'],
  'allowlist add/update/remove are logged'
);
select is(
  (select metadata from public.audit_logs
   where action = 'access.remove' and entity_id = '30000000-0000-0000-0000-000000000001'),
  '{"kind": "domain", "value": "example.org", "note": "Operations"}'::jsonb,
  'access.remove keeps what was removed'
);

-- ---------------------------------------------------------------- visibility (RLS)
select results_eq(
  -- 3 access.* + settings.update, plus the fixture's user.super_admin_grant and user.deactivate
  -- (profile audit, T1.7a). Only this transaction's rows (occurred_at = now()): integration tests
  -- leave immutable audit rows behind in a local DB.
  $$ select count(*)::int from public.audit_logs where space_id is null and occurred_at >= now() $$,
  array[6],
  'super admin sees system-wide entries'
);
select ok(
  (select count(*) from public.audit_logs where space_id = '10000000-0000-0000-0000-000000000009') > 0,
  'super admin sees entries of every space'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select results_eq(
  $$ select distinct space_id from public.audit_logs $$,
  array['10000000-0000-0000-0000-000000000001'::uuid],
  'space admin sees only entries of the spaces they administer'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is_empty($$ select id from public.audit_logs $$, 'editor sees no audit entries');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select is_empty(
  $$ select id from public.audit_logs where space_id = '10000000-0000-0000-0000-000000000001' $$,
  'internal non-member sees no audit entries of the space'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is_empty($$ select id from public.audit_logs $$, 'guest member sees no audit entries');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select is_empty($$ select id from public.audit_logs $$, 'guest non-member sees no audit entries');

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-000000000008';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select is_empty($$ select id from public.audit_logs $$, 'deactivated super admin sees no audit entries');

-- ---------------------------------------------------------------- immutability
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select throws_ok(
  $$ insert into public.audit_logs (action, entity_type) values ('space.create', 'space') $$,
  '42501', null, 'authenticated users cannot insert audit entries'
);
select throws_ok(
  $$ update public.audit_logs set action = 'space.update' $$,
  '42501', null, 'super admin cannot update audit entries'
);
select throws_ok(
  $$ delete from public.audit_logs $$,
  '42501', null, 'super admin cannot delete audit entries'
);

set local role service_role;
select throws_ok(
  $$ update public.audit_logs set metadata = '{}' $$,
  '42501', null, 'service_role cannot update audit entries'
);
select throws_ok(
  $$ delete from public.audit_logs $$,
  '42501', null, 'service_role cannot delete audit entries'
);
select throws_ok(
  $$ truncate public.audit_logs $$,
  '42501', null, 'service_role cannot truncate audit entries'
);

reset role;
grant update, delete on public.audit_logs to service_role;
set local role service_role;
select throws_ok(
  $$ delete from public.audit_logs $$,
  '42501', 'AUDIT_LOG_IMMUTABLE', 'the immutability trigger holds even if a write grant slips in'
);
reset role;
revoke update, delete on public.audit_logs from service_role;

-- ---------------------------------------------------------------- app.actor_id fallback
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('app.actor_id', '00000000-0000-0000-0000-000000000005', true);
select set_config('app.request_id', 'job-42', true);
update public.spaces set description = 'Set by a job' where id = '10000000-0000-0000-0000-000000000009';
select results_eq(
  $$ select actor_id, request_id from public.audit_logs
     where action = 'space.update' and space_id = '10000000-0000-0000-0000-000000000009' $$,
  $$ values ('00000000-0000-0000-0000-000000000005'::uuid, 'job-42'::text) $$,
  'without a JWT the actor and request id come from app.actor_id / app.request_id'
);
select set_config('app.actor_id', 'not-a-uuid', true);
select is(app.actor_id(), null::uuid, 'a malformed app.actor_id is ignored');
select set_config('app.actor_id', '', true);
select set_config('app.request_id', '', true);
reset role;

-- ---------------------------------------------------------------- list_audit_logs
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);

select results_eq(
  $$ select action, actor_email, actor_full_name
     from public.list_audit_logs(p_space_id => '10000000-0000-0000-0000-000000000001',
                                 p_actions => array['member.role_change', 'invitation.revoke']) $$,
  $$ values ('invitation.revoke'::text, 'admin@example.com'::text, 'Admin'::text),
            ('member.role_change', 'admin@example.com', 'Admin') $$,
  'list_audit_logs filters by action, orders newest first and joins the actor profile'
);

select is(
  (select count(*)::int from public.list_audit_logs(p_space_id => '10000000-0000-0000-0000-000000000009')),
  0,
  'list_audit_logs respects RLS for spaces the caller does not administer'
);

select is(
  (select count(*)::int from public.list_audit_logs(
     p_space_id => '10000000-0000-0000-0000-000000000001',
     p_actor_id => '00000000-0000-0000-0000-000000000001')),
  1,
  'list_audit_logs filters by actor'
);

select results_eq(
  $$ with first_page as (
       select * from public.list_audit_logs(p_space_id => '10000000-0000-0000-0000-000000000001', p_limit => 3)
     ), last_row as (
       select occurred_at, id from first_page order by occurred_at, id limit 1
     )
     select count(*)::int from public.list_audit_logs(
       p_space_id => '10000000-0000-0000-0000-000000000001',
       p_before_occurred_at => (select occurred_at from last_row),
       p_before_id => (select id from last_row)) as next_page
     where next_page.id in (select id from first_page) $$,
  array[0],
  'keyset pagination never repeats rows of the previous page'
);

set local role anon;
select throws_ok(
  $$ select * from public.list_audit_logs() $$,
  '42501', null, 'anonymous users cannot call list_audit_logs'
);

select * from finish();

rollback;
