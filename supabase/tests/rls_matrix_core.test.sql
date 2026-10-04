-- T7.1a: role × operation RLS matrix for the access-control tables (profiles, app_settings,
-- access_allowlist, spaces, space_members, invitations, audit_logs).
--
-- Roles: 1 super admin, 2 Space admin (A and B), 3 editor of A, 4 viewer of A, 5 internal user who is
-- no member of A, 6 guest who is a viewer of A, 7 guest outside every Space, 8 deactivated user
-- who is still an editor of A (a deactivation must beat the membership), plus anon, service_role
-- and kb_collab. Space A is restricted, Space B internal.
--
-- Convention: a statement the table grants refuse raises 42501 (permission denied); a statement
-- the grant allows but RLS hides touches 0 rows (UPDATE/DELETE/SELECT) or raises 42501 with
-- "violates row-level security policy" (INSERT). `rls_rows` returns the number of rows a
-- statement saw or changed, as the calling role.
begin;

select plan(138);

create function extensions.rls_rows(p_sql text) returns bigint
language plpgsql
as $$
declare
  v_rows bigint;
begin
  execute p_sql;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'super@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'admin@example.com'),
  ('00000000-0000-0000-0000-000000000003', 'editor@example.com'),
  ('00000000-0000-0000-0000-000000000004', 'viewer@example.com'),
  ('00000000-0000-0000-0000-000000000005', 'internal@example.com'),
  ('00000000-0000-0000-0000-000000000006', 'guest@example.net'),
  ('00000000-0000-0000-0000-000000000007', 'guest-outside@example.net'),
  ('00000000-0000-0000-0000-000000000008', 'deactivated@example.com');

select set_config('request.jwt.claim.role', 'service_role', true);
update public.profiles as p set
  is_guest = v.is_guest,
  is_super_admin = v.is_super_admin,
  deactivated_at = v.deactivated_at
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid, false, true, null::timestamptz),
  ('00000000-0000-0000-0000-000000000002'::uuid, false, false, null::timestamptz),
  ('00000000-0000-0000-0000-000000000003'::uuid, false, false, null::timestamptz),
  ('00000000-0000-0000-0000-000000000004'::uuid, false, false, null::timestamptz),
  ('00000000-0000-0000-0000-000000000005'::uuid, false, false, null::timestamptz),
  ('00000000-0000-0000-0000-000000000006'::uuid, true, false, null::timestamptz),
  ('00000000-0000-0000-0000-000000000007'::uuid, true, false, null::timestamptz),
  ('00000000-0000-0000-0000-000000000008'::uuid, false, false, now())
) as v(id, is_guest, is_super_admin, deactivated_at)
where p.id = v.id;
select set_config('request.jwt.claim.role', '', true);

insert into public.spaces (id, slug, name, visibility, created_by) values
  ('10000000-0000-0000-0000-00000000000a', 'space-a', 'A', 'restricted', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000b', 'space-b', 'B', 'internal', '00000000-0000-0000-0000-000000000002');
-- The creator (2) became admin of both Spaces through the spaces trigger.
insert into public.space_members (space_id, user_id, role, added_by) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000003', 'editor', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', 'viewer', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000006', 'viewer', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000008', 'editor', '00000000-0000-0000-0000-000000000002');

insert into public.invitations (id, email, space_id, role, token_hash, invited_by) values
  ('50000000-0000-0000-0000-000000000001', 'invitee@example.net', '10000000-0000-0000-0000-00000000000a', 'viewer', 'hash-1', '00000000-0000-0000-0000-000000000002'),
  ('50000000-0000-0000-0000-000000000002', 'invitee-b@example.net', '10000000-0000-0000-0000-00000000000b', 'viewer', 'hash-2', '00000000-0000-0000-0000-000000000002');

insert into public.access_allowlist (id, kind, value, created_by) values
  ('60000000-0000-0000-0000-000000000001', 'email', 'super@example.com', '00000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000002', 'email', 'someone@elsewhere.test', '00000000-0000-0000-0000-000000000001');

grant usage on schema extensions to kb_collab;

-- ================================================================ anon
-- No table of the schema is reachable without signing in.
set local role anon;
select throws_ok($$ select 1 from public.profiles $$, '42501', null, 'anon cannot select profiles');
select throws_ok($$ select 1 from public.app_settings $$, '42501', null, 'anon cannot select app_settings');
select throws_ok($$ select 1 from public.access_allowlist $$, '42501', null, 'anon cannot select access_allowlist');
select throws_ok($$ select 1 from public.space_members $$, '42501', null, 'anon cannot select space_members');
select throws_ok($$ select 1 from public.invitations $$, '42501', null, 'anon cannot select invitations');
select throws_ok($$ select 1 from public.audit_logs $$, '42501', null, 'anon cannot select audit_logs');
select throws_ok(
  $$ insert into public.access_allowlist (kind, value) values ('email', 'anon@elsewhere.test') $$,
  '42501', null, 'anon cannot insert into the allowlist'
);
select throws_ok($$ update public.spaces set name = 'x' $$, '42501', null, 'anon cannot update spaces');
select throws_ok($$ delete from public.space_members $$, '42501', null, 'anon cannot delete members');

-- ================================================================ profiles
set local role authenticated;

-- SELECT: self, every active internal user, and the co-members of one's Spaces. A guest sees
-- only the people of the Spaces they joined.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is(extensions.rls_rows($$ select 1 from public.profiles $$), 6::bigint, 'super admin sees the six non-guest profiles');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select is(extensions.rls_rows($$ select 1 from public.profiles $$), 7::bigint, 'Space admin sees internal users plus the guest of their Space');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is(extensions.rls_rows($$ select 1 from public.profiles $$), 7::bigint, 'editor sees internal users plus the guest of their Space');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is(extensions.rls_rows($$ select 1 from public.profiles $$), 7::bigint, 'viewer sees internal users plus the guest of their Space');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select is(extensions.rls_rows($$ select 1 from public.profiles $$), 6::bigint, 'internal non-member sees only internal users (no guest)');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select results_eq(
  $$ select id::text from public.profiles order by id $$,
  array['00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000006',
        '00000000-0000-0000-0000-000000000008'],
  'guest sees only themselves and the members of their Space'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select results_eq(
  $$ select id::text from public.profiles $$,
  array['00000000-0000-0000-0000-000000000007'],
  'guest outside every Space sees only themselves'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select is(
  extensions.rls_rows($$ select 1 from public.profiles where id <> '00000000-0000-0000-0000-000000000008' and not is_guest $$),
  0::bigint,
  'deactivated user does not see other internal users (is_internal_user is false)'
);

-- UPDATE: own display fields; the privileged flags are out of reach (column grants).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is(extensions.rls_rows($$ update public.profiles set full_name = 'Editor' where id = '00000000-0000-0000-0000-000000000003' $$), 1::bigint, 'user updates their own profile');
select is(extensions.rls_rows($$ update public.profiles set full_name = 'Hacked' where id = '00000000-0000-0000-0000-000000000004' $$), 0::bigint, 'user cannot update another profile');
select throws_ok($$ update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-000000000003' $$, '42501', null, 'user cannot promote themselves');
select throws_ok($$ update public.profiles set is_guest = false where id = '00000000-0000-0000-0000-000000000003' $$, '42501', null, 'user cannot change is_guest');
select throws_ok($$ update public.profiles set deactivated_at = null where id = '00000000-0000-0000-0000-000000000003' $$, '42501', null, 'user cannot change deactivated_at');
select throws_ok($$ update public.profiles set email = 'new@example.com' where id = '00000000-0000-0000-0000-000000000003' $$, '42501', null, 'user cannot change their email');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is(extensions.rls_rows($$ update public.profiles set locale = 'en' where id = '00000000-0000-0000-0000-000000000006' $$), 1::bigint, 'guest updates their own locale');
select is(extensions.rls_rows($$ update public.profiles set full_name = 'Hacked' where id = '00000000-0000-0000-0000-000000000003' $$), 0::bigint, 'guest cannot update an internal profile');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is(extensions.rls_rows($$ update public.profiles set full_name = 'Fixed' where id = '00000000-0000-0000-0000-000000000004' $$), 1::bigint, 'super admin updates another profile''s display fields');
select throws_ok($$ update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-000000000004' $$, '42501', null, 'privileged flags are only changed through the admin functions, even by a super admin');

-- INSERT / DELETE: profiles follow auth.users (trigger / cascade), never the client.
select throws_ok($$ insert into public.profiles (id, email) values (gen_random_uuid(), 'x@example.com') $$, '42501', null, 'super admin cannot insert a profile');
select throws_ok($$ delete from public.profiles where id = '00000000-0000-0000-0000-000000000004' $$, '42501', null, 'super admin cannot delete a profile');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select throws_ok($$ delete from public.profiles where id = '00000000-0000-0000-0000-000000000003' $$, '42501', null, 'user cannot delete their own profile');

-- ================================================================ app_settings
-- Every signed-in user reads the public columns; only a super admin changes them.
select is(extensions.rls_rows($$ select id, default_space_visibility, ai_enabled from public.app_settings $$), 1::bigint, 'editor reads the public app settings');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is(extensions.rls_rows($$ select id, default_space_visibility, ai_enabled from public.app_settings $$), 1::bigint, 'guest reads the public app settings');
select throws_ok($$ select bootstrap_admin_emails from public.app_settings $$, '42501', null, 'guest cannot read bootstrap_admin_emails');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select throws_ok($$ select bootstrap_admin_emails from public.app_settings $$, '42501', null, 'not even a super admin reads bootstrap_admin_emails');
select is(extensions.rls_rows($$ update public.app_settings set ai_enabled = true $$), 1::bigint, 'super admin updates app settings');
select throws_ok($$ update public.app_settings set bootstrap_admin_emails = '{x@example.com}' $$, '42501', null, 'super admin cannot write bootstrap_admin_emails');
select throws_ok($$ insert into public.app_settings (id) values (2) $$, '42501', null, 'super admin cannot insert a settings row');
select throws_ok($$ delete from public.app_settings $$, '42501', null, 'super admin cannot delete the settings row');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select is(extensions.rls_rows($$ update public.app_settings set ai_enabled = false $$), 0::bigint, 'Space admin cannot update app settings');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is(extensions.rls_rows($$ update public.app_settings set default_space_visibility = 'internal' $$), 0::bigint, 'guest cannot update app settings');
select is((select ai_enabled from public.app_settings), true, 'the row set by the super admin is unchanged by the rejected writes');
set local role anon;
select throws_ok($$ update public.app_settings set ai_enabled = false $$, '42501', null, 'anon cannot update app settings');
set local role authenticated;

-- ================================================================ access_allowlist
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is(extensions.rls_rows($$ select 1 from public.access_allowlist $$), 2::bigint, 'super admin reads the allowlist');
select lives_ok($$ insert into public.access_allowlist (kind, value) values ('email', 'new@elsewhere.test') $$, 'super admin inserts an entry');
select is(extensions.rls_rows($$ update public.access_allowlist set note = 'n' where value = 'someone@elsewhere.test' $$), 1::bigint, 'super admin updates an entry');
select is(extensions.rls_rows($$ delete from public.access_allowlist where value = 'new@elsewhere.test' $$), 1::bigint, 'super admin deletes an entry');
select is(extensions.rls_rows($$ delete from public.access_allowlist where value = 'super@example.com' $$), 0::bigint, 'super admin cannot delete the entry of their own email');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select is(extensions.rls_rows($$ select 1 from public.access_allowlist $$), 0::bigint, 'Space admin sees no allowlist entries');
select throws_ok($$ insert into public.access_allowlist (kind, value) values ('email', 'admin-added@elsewhere.test') $$, '42501', null, 'Space admin cannot insert an entry');
select is(extensions.rls_rows($$ update public.access_allowlist set note = 'x' $$), 0::bigint, 'Space admin cannot update entries');
select is(extensions.rls_rows($$ delete from public.access_allowlist $$), 0::bigint, 'Space admin cannot delete entries');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is(extensions.rls_rows($$ select 1 from public.access_allowlist $$), 0::bigint, 'editor sees no allowlist entries');
select throws_ok($$ insert into public.access_allowlist (kind, value) values ('domain', 'editor-added.test') $$, '42501', null, 'editor cannot insert an entry');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is(extensions.rls_rows($$ delete from public.access_allowlist $$), 0::bigint, 'viewer cannot delete entries');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is(extensions.rls_rows($$ select 1 from public.access_allowlist $$), 0::bigint, 'guest sees no allowlist entries');
select throws_ok($$ insert into public.access_allowlist (kind, value) values ('email', 'guest-added@elsewhere.test') $$, '42501', null, 'guest cannot insert an entry');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select is(extensions.rls_rows($$ select 1 from public.access_allowlist $$), 0::bigint, 'deactivated user sees no allowlist entries');

-- ================================================================ spaces
-- SELECT: viewable Spaces only (membership, or internal for non-guests); a deactivated user sees none.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is(extensions.rls_rows($$ select 1 from public.spaces $$), 2::bigint, 'super admin sees every Space');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is(extensions.rls_rows($$ select 1 from public.spaces $$), 2::bigint, 'editor sees their restricted Space and the internal one');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select is(extensions.rls_rows($$ select 1 from public.spaces $$), 0::bigint, 'deactivated member sees no Space');

-- INSERT: internal users create Spaces as themselves; guests and the deactivated cannot.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select lives_ok(
  $$ insert into public.spaces (id, slug, name, created_by)
     values ('10000000-0000-0000-0000-00000000000c', 'space-c', 'C', '00000000-0000-0000-0000-000000000005') $$,
  'internal user creates a Space'
);
select throws_ok(
  $$ insert into public.spaces (slug, name, created_by) values ('spoofed', 'S', '00000000-0000-0000-0000-000000000004') $$,
  '42501', null, 'a Space cannot be created in somebody else''s name'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select throws_ok(
  $$ insert into public.spaces (slug, name, created_by) values ('guest-space', 'G', '00000000-0000-0000-0000-000000000006') $$,
  '42501', null, 'guest cannot create a Space'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select throws_ok(
  $$ insert into public.spaces (slug, name, created_by) values ('ghost-space', 'G', '00000000-0000-0000-0000-000000000008') $$,
  '42501', null, 'deactivated user cannot create a Space'
);

-- UPDATE: Space admins (and super admins) only, and only the granted columns.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select is(extensions.rls_rows($$ update public.spaces set name = 'A1' where id = '10000000-0000-0000-0000-00000000000a' $$), 1::bigint, 'Space admin updates their Space');
select throws_ok($$ update public.spaces set created_by = '00000000-0000-0000-0000-000000000003' where id = '10000000-0000-0000-0000-00000000000a' $$, '42501', null, 'created_by cannot be changed');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is(extensions.rls_rows($$ update public.spaces set name = 'A2' where id = '10000000-0000-0000-0000-00000000000a' $$), 1::bigint, 'super admin updates any Space');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is(extensions.rls_rows($$ update public.spaces set name = 'Hacked' where id = '10000000-0000-0000-0000-00000000000a' $$), 0::bigint, 'editor cannot update the Space');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is(extensions.rls_rows($$ update public.spaces set name = 'Hacked' where id = '10000000-0000-0000-0000-00000000000a' $$), 0::bigint, 'viewer cannot update the Space');
select is(extensions.rls_rows($$ update public.spaces set name = 'Hacked' where id = '10000000-0000-0000-0000-00000000000b' $$), 0::bigint, 'viewer of an internal Space cannot update it');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select is(extensions.rls_rows($$ update public.spaces set name = 'Hacked' where id = '10000000-0000-0000-0000-00000000000a' $$), 0::bigint, 'internal non-member cannot update a restricted Space');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is(extensions.rls_rows($$ update public.spaces set name = 'Hacked' where id = '10000000-0000-0000-0000-00000000000a' $$), 0::bigint, 'guest viewer cannot update the Space');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select is(extensions.rls_rows($$ update public.spaces set name = 'Hacked' where id = '10000000-0000-0000-0000-00000000000a' $$), 0::bigint, 'deactivated editor cannot update the Space');

-- DELETE: no client deletes a Space (archive instead), whatever their role.
select throws_ok($$ delete from public.spaces where id = '10000000-0000-0000-0000-00000000000a' $$, '42501', null, 'deactivated editor cannot delete a Space');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select throws_ok($$ delete from public.spaces where id = '10000000-0000-0000-0000-00000000000a' $$, '42501', null, 'Space admin cannot delete a Space');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select throws_ok($$ delete from public.spaces where id = '10000000-0000-0000-0000-00000000000a' $$, '42501', null, 'super admin cannot delete a Space');

-- ================================================================ space_members
-- SELECT: the members of every Space one can view.
select is(extensions.rls_rows($$ select 1 from public.space_members $$), 7::bigint, 'super admin sees every membership');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is(extensions.rls_rows($$ select 1 from public.space_members $$), 6::bigint, 'viewer sees the members of Space A and of the internal Space B');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select results_eq(
  $$ select space_id::text from public.space_members order by space_id $$,
  array['10000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000c'],
  'internal non-member sees only the memberships of the internal Space and of their own Space C'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select results_eq(
  $$ select distinct space_id::text from public.space_members $$,
  array['10000000-0000-0000-0000-00000000000a'],
  'guest sees only the memberships of their Space'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select is(extensions.rls_rows($$ select 1 from public.space_members $$), 0::bigint, 'guest outside every Space sees no membership');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select is(extensions.rls_rows($$ select 1 from public.space_members $$), 0::bigint, 'deactivated member sees no membership');

-- INSERT: only Space admins add members.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select throws_ok(
  $$ insert into public.space_members (space_id, user_id, role) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000005', 'viewer') $$,
  '42501', null, 'editor cannot add a member'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select throws_ok(
  $$ insert into public.space_members (space_id, user_id, role) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', 'admin') $$,
  '42501', null, 'viewer cannot make themselves an admin'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select throws_ok(
  $$ insert into public.space_members (space_id, user_id, role) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000007', 'viewer') $$,
  '42501', null, 'guest cannot add a member'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select throws_ok(
  $$ insert into public.space_members (space_id, user_id, role) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000005', 'viewer') $$,
  '42501', null, 'an outsider cannot join a restricted Space on their own'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select throws_ok(
  $$ insert into public.space_members (space_id, user_id, role) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000008', 'admin') $$,
  '42501', null, 'deactivated editor cannot add members'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$ insert into public.space_members (space_id, user_id, role) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000005', 'viewer') $$,
  'Space admin adds a member'
);
select throws_ok(
  $$ insert into public.space_members (space_id, user_id, role) values ('10000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000003', 'viewer') $$,
  '42501', null, 'a Space admin of A and B cannot add members to the Space C they do not administer'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$ insert into public.space_members (space_id, user_id, role) values ('10000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000003', 'viewer') $$,
  'super admin adds a member to any Space'
);

-- UPDATE: only the role, only by Space admins.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select is(extensions.rls_rows($$ update public.space_members set role = 'editor' where space_id = '10000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-000000000004' $$), 1::bigint, 'Space admin changes a member''s role');
select throws_ok($$ update public.space_members set user_id = '00000000-0000-0000-0000-000000000007' where space_id = '10000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-000000000004' $$, '42501', null, 'a membership cannot be reassigned to another user');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is(extensions.rls_rows($$ update public.space_members set role = 'admin' where space_id = '10000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-000000000003' $$), 0::bigint, 'editor cannot promote themselves');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is(extensions.rls_rows($$ update public.space_members set role = 'editor' where space_id = '10000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-000000000006' $$), 0::bigint, 'guest cannot raise their own role');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select is(extensions.rls_rows($$ update public.space_members set role = 'admin' where space_id = '10000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-000000000005' $$), 0::bigint, 'a freshly added viewer cannot promote themselves');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select is(extensions.rls_rows($$ update public.space_members set role = 'admin' where space_id = '10000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-000000000008' $$), 0::bigint, 'deactivated editor cannot promote themselves');

-- DELETE: admins remove anyone; everybody may leave on their own.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is(extensions.rls_rows($$ delete from public.space_members where space_id = '10000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-000000000006' $$), 0::bigint, 'editor cannot remove another member');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is(extensions.rls_rows($$ delete from public.space_members where space_id = '10000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-000000000003' $$), 0::bigint, 'member cannot remove another member');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select is(extensions.rls_rows($$ delete from public.space_members where space_id = '10000000-0000-0000-0000-00000000000a' $$), 0::bigint, 'an outsider guest removes nothing');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is(extensions.rls_rows($$ delete from public.space_members where space_id = '10000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-000000000006' $$), 1::bigint, 'guest leaves the Space on their own');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select is(extensions.rls_rows($$ delete from public.space_members where space_id = '10000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-000000000008' $$), 1::bigint, 'Space admin removes a member');

-- ================================================================ invitations
-- (Space A: admin 2, editor 3, viewer 4→editor, internal 5 viewer, guest 6 left.)
select is(extensions.rls_rows($$ select 1 from public.invitations $$), 2::bigint, 'Space admin sees the invitations of the Spaces they administer');
select lives_ok(
  $$ insert into public.invitations (email, space_id, role, token_hash, invited_by)
     values ('new-guest@example.net', '10000000-0000-0000-0000-00000000000a', 'viewer', 'hash-3', '00000000-0000-0000-0000-000000000002') $$,
  'Space admin invites a viewer'
);
select throws_ok(
  $$ insert into public.invitations (email, space_id, role, token_hash, invited_by)
     values ('new-admin@example.net', '10000000-0000-0000-0000-00000000000a', 'admin', 'hash-4', '00000000-0000-0000-0000-000000000002') $$,
  '23514', null, 'nobody is invited straight into the admin role'
);
select is(extensions.rls_rows($$ update public.invitations set revoked_at = now() where id = '50000000-0000-0000-0000-000000000002' $$), 1::bigint, 'Space admin revokes an invitation');
select throws_ok($$ update public.invitations set accepted_at = now() where id = '50000000-0000-0000-0000-000000000001' $$, '42501', null, 'accepted_at is only set by accept_invitation');
select throws_ok($$ delete from public.invitations where id = '50000000-0000-0000-0000-000000000001' $$, '42501', null, 'Space admin cannot delete an invitation');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select is(extensions.rls_rows($$ select 1 from public.invitations $$), 0::bigint, 'a viewer-level member sees no invitations');
select throws_ok(
  $$ insert into public.invitations (email, space_id, role, token_hash, invited_by)
     values ('x@example.net', '10000000-0000-0000-0000-00000000000a', 'viewer', 'hash-5', '00000000-0000-0000-0000-000000000005') $$,
  '42501', null, 'viewer cannot invite'
);
select is(extensions.rls_rows($$ update public.invitations set revoked_at = now() where id = '50000000-0000-0000-0000-000000000001' $$), 0::bigint, 'viewer cannot revoke an invitation');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is(extensions.rls_rows($$ select 1 from public.invitations $$), 0::bigint, 'editor sees no invitations');
select throws_ok(
  $$ insert into public.invitations (email, space_id, role, token_hash, invited_by)
     values ('x@example.net', '10000000-0000-0000-0000-00000000000a', 'viewer', 'hash-6', '00000000-0000-0000-0000-000000000003') $$,
  '42501', null, 'editor cannot invite'
);
select is(extensions.rls_rows($$ update public.invitations set role = 'editor' where id = '50000000-0000-0000-0000-000000000001' $$), 0::bigint, 'editor cannot change an invitation');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select is(extensions.rls_rows($$ select 1 from public.invitations $$), 0::bigint, 'guest outside every Space sees no invitations');
select throws_ok(
  $$ insert into public.invitations (email, space_id, role, token_hash, invited_by)
     values ('x@example.net', '10000000-0000-0000-0000-00000000000a', 'viewer', 'hash-7', '00000000-0000-0000-0000-000000000007') $$,
  '42501', null, 'outsider guest cannot invite'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select is(extensions.rls_rows($$ select 1 from public.invitations $$), 0::bigint, 'deactivated user sees no invitations');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is(extensions.rls_rows($$ select 1 from public.invitations $$), 3::bigint, 'super admin sees every invitation');
select throws_ok($$ delete from public.invitations $$, '42501', null, 'super admin cannot delete invitations either');

-- ================================================================ audit_logs
-- Reads follow Space administration; nobody writes, not even a super admin or service_role.
select isnt_empty($$ select 1 from public.audit_logs $$, 'super admin reads the audit log');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select ok(
  (select count(*) filter (where space_id is distinct from '10000000-0000-0000-0000-00000000000c') = 0 and count(*) > 0
   from public.audit_logs),
  'the admin of Space C only reads the entries of Space C'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is(extensions.rls_rows($$ select 1 from public.audit_logs $$), 0::bigint, 'editor reads no audit entries');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is(extensions.rls_rows($$ select 1 from public.audit_logs $$), 0::bigint, 'viewer reads no audit entries');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is(extensions.rls_rows($$ select 1 from public.audit_logs $$), 0::bigint, 'guest reads no audit entries');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select is(extensions.rls_rows($$ select 1 from public.audit_logs $$), 0::bigint, 'outsider guest reads no audit entries');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select is(extensions.rls_rows($$ select 1 from public.audit_logs $$), 0::bigint, 'deactivated user reads no audit entries');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select throws_ok($$ insert into public.audit_logs (action, entity_type) values ('space.create', 'space') $$, '42501', null, 'super admin cannot insert audit entries');
select throws_ok($$ update public.audit_logs set metadata = '{}' $$, '42501', null, 'super admin cannot update audit entries');
select throws_ok($$ delete from public.audit_logs $$, '42501', null, 'super admin cannot delete audit entries');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select throws_ok($$ delete from public.audit_logs $$, '42501', null, 'Space admin cannot delete audit entries');
set local role service_role;
select throws_ok($$ insert into public.audit_logs (action, entity_type) values ('space.create', 'space') $$, '42501', null, 'service_role cannot insert audit entries');
select throws_ok($$ delete from public.audit_logs $$, '42501', null, 'service_role cannot delete audit entries');
set local role kb_collab;
select throws_ok($$ select 1 from public.audit_logs $$, '42501', null, 'kb_collab cannot read audit entries');

-- ================================================================ kb_collab
-- The collab role touches page content only: none of the access-control tables.
select throws_ok($$ select 1 from public.profiles $$, '42501', null, 'kb_collab cannot read profiles');
select throws_ok($$ select 1 from public.spaces $$, '42501', null, 'kb_collab cannot read spaces');
select throws_ok($$ select 1 from public.space_members $$, '42501', null, 'kb_collab cannot read space_members');
select throws_ok($$ select 1 from public.invitations $$, '42501', null, 'kb_collab cannot read invitations');
select throws_ok($$ select 1 from public.app_settings $$, '42501', null, 'kb_collab cannot read app_settings');
select throws_ok($$ select 1 from public.access_allowlist $$, '42501', null, 'kb_collab cannot read access_allowlist');

select * from finish();

rollback;
