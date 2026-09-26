begin;

select plan(19);

-- Fixture: one internal admin (to own the invitation + the space) and the allow/deny data
-- the hook and the profile trigger both read. The allowlist rows go in *before* the owner's
-- `auth.users` row so `app.handle_new_user` sees them and creates a non-guest profile for the
-- owner (mirroring production, where the allowlist is seeded ahead of any sign-in) — otherwise
-- `spaces_add_creator_as_admin` would try to add a guest as space admin and
-- `guard_guest_space_admin` would reject the fixture itself. `created_by` starts null (the owner
-- profile doesn't exist yet) and is backfilled once the owner has signed up.
insert into public.access_allowlist (kind, value) values
  ('email', 'owner@example.com'),
  ('email', 'bootstrap-admin@example.com'),
  ('domain', 'internal.example');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000101', 'owner@example.com');

update public.access_allowlist set created_by = '00000000-0000-0000-0000-000000000101'
where created_by is null;

insert into public.spaces (id, slug, name, visibility, created_by) values
  ('20000000-0000-0000-0000-000000000001', 'hooks-fixture', 'Hooks fixture', 'restricted', '00000000-0000-0000-0000-000000000101');

insert into public.invitations (email, space_id, role, token_hash, invited_by, expires_at) values
  ('invited-guest@outside.example', '20000000-0000-0000-0000-000000000001', 'viewer', 'hook-token-active', '00000000-0000-0000-0000-000000000101', now() + interval '14 days'),
  ('expired-guest@outside.example', '20000000-0000-0000-0000-000000000001', 'viewer', 'hook-token-expired', '00000000-0000-0000-0000-000000000101', now() - interval '1 day');

update public.app_settings set bootstrap_admin_emails = array['bootstrap-admin@example.com']::extensions.citext[]
where id = 1;

-- app.before_user_created_hook: the allow/deny decision -----------------------------------

select is(
  app.before_user_created_hook(jsonb_build_object('user', jsonb_build_object('email', 'owner@example.com'))),
  '{}'::jsonb,
  'allowlisted email is allowed through'
);

select is(
  app.before_user_created_hook(jsonb_build_object('user', jsonb_build_object('email', 'someone@internal.example'))),
  '{}'::jsonb,
  'email on an allowlisted domain is allowed through'
);

select is(
  app.before_user_created_hook(jsonb_build_object('user', jsonb_build_object('email', 'invited-guest@outside.example'))),
  '{}'::jsonb,
  'email with a pending invitation is allowed through'
);

select is(
  app.before_user_created_hook(jsonb_build_object('user', jsonb_build_object('email', 'stranger@outside.example'))) -> 'error' ->> 'message',
  'AUTH_NOT_ALLOWED',
  'email with no allowlist entry and no invitation is rejected'
);

select is(
  (app.before_user_created_hook(jsonb_build_object('user', jsonb_build_object('email', 'stranger@outside.example'))) -> 'error' ->> 'http_code')::int,
  403,
  'rejection carries a 403 http_code for GoTrue'
);

select is(
  app.before_user_created_hook(jsonb_build_object('user', jsonb_build_object('email', 'expired-guest@outside.example'))) -> 'error' ->> 'message',
  'AUTH_NOT_ALLOWED',
  'email with only an expired invitation is rejected'
);

select is(
  app.before_user_created_hook(jsonb_build_object('user', '{}'::jsonb)) -> 'error' ->> 'message',
  'AUTH_NOT_ALLOWED',
  'event with no email is rejected'
);

-- app.handle_new_user (auth_users_create_profile trigger): the profile it creates ----------

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000102', 'owner-two@internal.example', jsonb_build_object('full_name', 'Owner Two', 'avatar_url', 'https://example.com/o2.png')),
  ('00000000-0000-0000-0000-000000000103', 'invited-guest@outside.example', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000104', 'bootstrap-admin@example.com', '{}'::jsonb);

select is(
  (select full_name from public.profiles where id = '00000000-0000-0000-0000-000000000102'),
  'Owner Two',
  'allowlisted signup copies the Google display name onto the profile'
);

select is(
  (select avatar_url from public.profiles where id = '00000000-0000-0000-0000-000000000102'),
  'https://example.com/o2.png',
  'allowlisted signup copies the Google avatar onto the profile'
);

select is(
  (select is_guest from public.profiles where id = '00000000-0000-0000-0000-000000000102'),
  false,
  'domain-allowlisted signup gets an internal (non-guest) profile'
);

select is(
  (select is_guest from public.profiles where id = '00000000-0000-0000-0000-000000000103'),
  true,
  'signup that only got in through an invitation is marked as a guest'
);

select is(
  (select is_super_admin from public.profiles where id = '00000000-0000-0000-0000-000000000104'),
  true,
  'signup whose email is in app_settings.bootstrap_admin_emails becomes super admin on first insert'
);

select lives_ok(
  $$ insert into public.profiles (id, email) values ('00000000-0000-0000-0000-000000000102', 'owner-two@internal.example') on conflict (id) do nothing $$,
  'the trigger insert (on conflict do nothing) never fights a profile that already exists'
);

-- app.has_active_access: per-request re-check, independent of what let the user sign up ---------
-- 105: never allowlisted, but flagged super admin after the fact (mirrors an existing admin).
-- 106: never allowlisted; kept access solely through an accepted Space invitation (membership).
-- 107: a stranger — no allowlist entry, no membership. 108: allowlisted but deactivated.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000105', 'promoted-admin@outside.example'),
  ('00000000-0000-0000-0000-000000000106', 'ex-internal@outside.example'),
  ('00000000-0000-0000-0000-000000000107', 'stranger-two@outside.example'),
  ('00000000-0000-0000-0000-000000000108', 'deactivated-admin@internal.example')
on conflict (id) do nothing;

select set_config('request.jwt.claim.role', 'service_role', true);

update public.profiles set is_super_admin = true
where id = '00000000-0000-0000-0000-000000000105';

select set_config('request.jwt.claim.role', '', true);

insert into public.space_members (space_id, user_id, role, added_by) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000106', 'viewer', '00000000-0000-0000-0000-000000000101');

set local role authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000101', true);
select is(app.has_active_access(), true, 'still-allowlisted user keeps active access');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000105', true);
select is(app.has_active_access(), true, 'super admin keeps active access even without an allowlist entry');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000106', true);
select is(app.has_active_access(), true, 'active Space membership keeps access after losing the allowlist');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000103', true);
select is(app.has_active_access(), false, 'a pending, not-yet-accepted invitation is not active access');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000107', true);
select is(app.has_active_access(), false, 'a stranger with no allowlist entry and no membership has no active access');

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);

update public.profiles set deactivated_at = now()
where id = '00000000-0000-0000-0000-000000000108';

select set_config('request.jwt.claim.role', '', true);
set local role authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000108', true);
select is(app.has_active_access(), false, 'a deactivated profile has no active access even if still allowlisted');

reset role;

select * from finish();

rollback;
