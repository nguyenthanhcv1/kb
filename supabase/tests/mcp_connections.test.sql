begin;

select plan(21);

-- u1 owns the connections, u2 is another internal user, admin a super admin.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'u1@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'u2@example.com'),
  ('00000000-0000-0000-0000-0000000000a3', 'admin@example.com');

select set_config('request.jwt.claim.role', 'service_role', true);
update public.profiles set is_guest = false;
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-0000000000a3';
select set_config('request.jwt.claim.role', '', true);

-- kb-web (service_role) registers a client, a connection and its tokens.
set local role service_role;

insert into public.mcp_clients (id, client_name, redirect_uris) values
  ('20000000-0000-0000-0000-000000000001', 'Claude', array['https://claude.ai/api/mcp/auth_callback']);

insert into public.mcp_connections (id, user_id, client_id, name, scope) values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1',
   '20000000-0000-0000-0000-000000000001', 'Claude', 'write'),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a2',
   null, 'Laptop', 'read');

insert into public.mcp_tokens (token_hash, connection_id, kind, expires_at) values
  (repeat('a', 64), '30000000-0000-0000-0000-000000000001', 'access', now() + interval '1 hour');

select throws_ok(
  $$ insert into public.mcp_tokens (token_hash, connection_id, kind, expires_at)
     values (repeat('b', 64), '30000000-0000-0000-0000-000000000001', 'code', now()) $$,
  '23514', null, 'an authorization code needs its PKCE challenge and redirect URI'
);
select throws_ok(
  $$ insert into public.mcp_tokens (token_hash, connection_id, kind, expires_at)
     values ('not-a-hash', '30000000-0000-0000-0000-000000000001', 'access', now()) $$,
  '23514', null, 'only sha256 hashes are stored'
);

reset role;

select is(
  (select count(*)::int from public.audit_logs
   where action = 'mcp.connect' and entity_id = '30000000-0000-0000-0000-000000000001'
     and actor_id = '00000000-0000-0000-0000-0000000000a1'),
  1, 'connecting is audited with the user as actor'
);

-- ---------------------------------------------------------------- owner
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

select results_eq(
  $$ select id from public.mcp_connections $$,
  $$ values ('30000000-0000-0000-0000-000000000001'::uuid) $$,
  'a user sees only their own connections'
);
select throws_ok($$ select 1 from public.mcp_tokens $$, '42501', null, 'tokens are not readable');
select is_empty($$ select 1 from public.mcp_clients $$, 'clients are not readable by users');
select throws_ok(
  $$ update public.mcp_connections set scope = 'read' $$,
  '42501', null, 'users cannot change the scope themselves'
);
select throws_ok(
  $$ insert into public.mcp_connections (user_id, name, scope)
     values ('00000000-0000-0000-0000-0000000000a1', 'x', 'write') $$,
  '42501', null, 'users cannot create connections directly'
);
select throws_ok(
  $$ delete from public.mcp_tokens $$,
  '42501', null, 'users cannot delete tokens'
);

update public.mcp_connections set revoked_at = now()
where id = '30000000-0000-0000-0000-000000000001';
select isnt(
  (select revoked_at from public.mcp_connections where id = '30000000-0000-0000-0000-000000000001'),
  null, 'a user revokes their own connection'
);
select throws_ok(
  $$ update public.mcp_connections set revoked_at = null
     where id = '30000000-0000-0000-0000-000000000001' $$,
  '23514', 'MCP_CONNECTION_REVOKED', 'a revoked connection stays revoked'
);

-- Someone else's connection: invisible, so the update touches nothing.
update public.mcp_connections set revoked_at = now()
where id = '30000000-0000-0000-0000-000000000002';

reset role;

select is(
  (select revoked_at from public.mcp_connections where id = '30000000-0000-0000-0000-000000000002'),
  null, 'nobody revokes another user''s connection'
);
select is(
  (select count(*)::int from public.audit_logs
   where action = 'mcp.revoke' and entity_id = '30000000-0000-0000-0000-000000000001'),
  1, 'revoking is audited'
);

-- ---------------------------------------------------------------- super admin
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);

select is(
  (select count(*)::int from public.mcp_clients), 1, 'super admins see the registered clients'
);
select is_empty(
  $$ select 1 from public.mcp_connections $$,
  'super admins do not read other users'' connections (the audit log has them)'
);

-- ---------------------------------------------------------------- anon
set local role anon;
select throws_ok(
  $$ select 1 from public.mcp_connections $$, '42501', null, 'anon has no access'
);

-- ---------------------------------------------------------------- limit
reset role;
set local role service_role;
insert into public.mcp_connections (user_id, name, scope)
select '00000000-0000-0000-0000-0000000000a2', 'token ' || n, 'read' from generate_series(2, 50) as n;
select throws_ok(
  $$ insert into public.mcp_connections (user_id, name, scope)
     values ('00000000-0000-0000-0000-0000000000a2', 'token 51', 'read') $$,
  'P0001', 'MCP_CONNECTION_LIMIT', 'at most 50 active connections per user'
);

-- ---------------------------------------------------------------- my_page_role
insert into public.spaces (id, slug, name, visibility, created_by) values
  ('10000000-0000-0000-0000-0000000000b1', 'mcp-space', 'MCP', 'restricted', '00000000-0000-0000-0000-0000000000a1');
insert into public.space_members (space_id, user_id, role, added_by) values
  ('10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a2', 'viewer',
   '00000000-0000-0000-0000-0000000000a1');
insert into public.pages (id, space_id, title, position) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000b1', 'P', 'a');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select is(public.my_page_role('40000000-0000-0000-0000-000000000001')::text, 'admin',
  'my_page_role: the Space creator is admin');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
select is(public.my_page_role('40000000-0000-0000-0000-000000000001')::text, 'viewer',
  'my_page_role: a viewer member');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
select is(public.my_page_role('40000000-0000-0000-0000-000000000001')::text, 'admin',
  'my_page_role: a super admin');
set local role anon;
select throws_ok($$ select public.my_page_role('40000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'my_page_role: not for anon');

select * from finish();

rollback;
