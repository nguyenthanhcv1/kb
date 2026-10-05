-- T1.5a: invitation accept flow (single-use, expiry, revoke, email match), invitation state guard,
-- member list and "add internal member" search, across admin / editor / viewer / guest / outsider.
begin;

select plan(55);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'super@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'admin@example.com'),
  ('00000000-0000-0000-0000-000000000003', 'editor@example.com'),
  ('00000000-0000-0000-0000-000000000004', 'viewer@example.com'),
  ('00000000-0000-0000-0000-000000000005', 'outsider@example.com'),
  ('00000000-0000-0000-0000-000000000006', 'Guest@Outside.test'),
  ('00000000-0000-0000-0000-000000000007', 'other-guest@outside.test'),
  ('00000000-0000-0000-0000-000000000008', 'deactivated@example.com');

select set_config('request.jwt.claim.role', 'service_role', true);
update public.profiles as p set
  is_guest = v.is_guest,
  is_super_admin = v.is_super_admin,
  deactivated_at = v.deactivated_at,
  full_name = v.full_name
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid, false, true, null::timestamptz, 'Super Admin'),
  ('00000000-0000-0000-0000-000000000002'::uuid, false, false, null::timestamptz, 'Ada Admin'),
  ('00000000-0000-0000-0000-000000000003'::uuid, false, false, null::timestamptz, 'Eddie Editor'),
  ('00000000-0000-0000-0000-000000000004'::uuid, false, false, null::timestamptz, 'Vi Viewer'),
  ('00000000-0000-0000-0000-000000000005'::uuid, false, false, null::timestamptz, 'Nguyễn Văn Đức'),
  ('00000000-0000-0000-0000-000000000006'::uuid, true, false, null::timestamptz, 'Gia Guest'),
  ('00000000-0000-0000-0000-000000000007'::uuid, true, false, null::timestamptz, 'Nguyen Guest'),
  ('00000000-0000-0000-0000-000000000008'::uuid, false, false, now(), 'Nguyen Deactivated')
) as v(id, is_guest, is_super_admin, deactivated_at, full_name)
where p.id = v.id;
select set_config('request.jwt.claim.role', '', true);

insert into public.spaces (id, slug, name, icon, visibility, created_by) values
  ('10000000-0000-0000-0000-000000000001', 'members-a', 'Members A', '📘', 'restricted', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000002', 'members-b', 'Members B', null, 'restricted', '00000000-0000-0000-0000-000000000002');

insert into public.space_members (space_id, user_id, role, added_by) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'editor', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'viewer', '00000000-0000-0000-0000-000000000002');

-- Tokens are hashed with the same function kb-web mirrors (sha256 hex).
insert into public.invitations (id, email, space_id, role, token_hash, invited_by, expires_at) values
  ('20000000-0000-0000-0000-000000000001', 'guest@outside.test', '10000000-0000-0000-0000-000000000001', 'viewer',
   app.invitation_token_hash('tok-valid'), '00000000-0000-0000-0000-000000000002', now() + interval '14 days'),
  ('20000000-0000-0000-0000-000000000002', 'guest@outside.test', '10000000-0000-0000-0000-000000000001', 'viewer',
   app.invitation_token_hash('tok-expired'), '00000000-0000-0000-0000-000000000002', now() - interval '1 minute'),
  ('20000000-0000-0000-0000-000000000003', 'guest@outside.test', '10000000-0000-0000-0000-000000000001', 'viewer',
   app.invitation_token_hash('tok-revoked'), '00000000-0000-0000-0000-000000000002', now() + interval '14 days'),
  ('20000000-0000-0000-0000-000000000004', 'viewer@example.com', '10000000-0000-0000-0000-000000000001', 'editor',
   app.invitation_token_hash('tok-upgrade'), '00000000-0000-0000-0000-000000000002', now() + interval '14 days'),
  ('20000000-0000-0000-0000-000000000005', 'editor@example.com', '10000000-0000-0000-0000-000000000001', 'viewer',
   app.invitation_token_hash('tok-no-downgrade'), '00000000-0000-0000-0000-000000000002', now() + interval '14 days'),
  ('20000000-0000-0000-0000-000000000006', 'guest@outside.test', '10000000-0000-0000-0000-000000000002', 'viewer',
   app.invitation_token_hash('tok-archived'), '00000000-0000-0000-0000-000000000002', now() + interval '14 days'),
  ('20000000-0000-0000-0000-000000000007', 'deactivated@example.com', '10000000-0000-0000-0000-000000000001', 'viewer',
   app.invitation_token_hash('tok-deactivated'), '00000000-0000-0000-0000-000000000002', now() + interval '14 days'),
  ('20000000-0000-0000-0000-000000000008', 'pending@outside.test', '10000000-0000-0000-0000-000000000001', 'viewer',
   app.invitation_token_hash('tok-pending'), '00000000-0000-0000-0000-000000000002', now() + interval '14 days');

update public.invitations set revoked_at = now() where id = '20000000-0000-0000-0000-000000000003';
update public.spaces set archived_at = now() where id = '10000000-0000-0000-0000-000000000002';

-- ---------------------------------------------------------------- token hash
select is(
  app.invitation_token_hash('abc'),
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  'invitation_token_hash is sha256 hex (matches node:crypto)'
);

set local role authenticated;

-- ---------------------------------------------------------------- get_invitation
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select results_eq(
  $$ select space_slug, space_name, space_icon, role::text, email, inviter_name, status, email_matches
     from public.get_invitation('tok-valid') $$,
  $$ values ('members-a'::text, 'Members A'::text, '📘'::text, 'viewer'::text, 'guest@outside.test'::text,
             'Ada Admin'::text, 'pending'::text, true) $$,
  'invitee previews a pending invitation (email match is case-insensitive)'
);
select is((select status from public.get_invitation('tok-expired')), 'expired', 'expired invitation reports expired');
select is((select status from public.get_invitation('tok-revoked')), 'revoked', 'revoked invitation reports revoked');
select is((select count(*)::int from public.get_invitation('tok-unknown')), 0, 'unknown token returns no row');
select is((select count(*)::int from public.get_invitation('tok-archived')), 0, 'invitation to an archived space returns no row');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select is((select email_matches from public.get_invitation('tok-valid')), false, 'another account sees email_matches = false');

select set_config('request.jwt.claim.sub', '', true);
select is((select count(*)::int from public.get_invitation('tok-valid')), 0, 'no row without a signed-in user');

-- ---------------------------------------------------------------- accept_invitation: failures
select throws_ok($$ select * from public.accept_invitation('tok-valid') $$, '42501', 'UNAUTHORIZED',
  'accepting requires a signed-in user');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select throws_ok($$ select * from public.accept_invitation('tok-unknown') $$, 'P0002', 'INVITATION_NOT_FOUND',
  'unknown token is INVITATION_NOT_FOUND');
select throws_ok($$ select * from public.accept_invitation('tok-expired') $$, 'P0001', 'INVITATION_EXPIRED',
  'expired token is INVITATION_EXPIRED');
select throws_ok($$ select * from public.accept_invitation('tok-revoked') $$, 'P0001', 'INVITATION_REVOKED',
  'revoked token is INVITATION_REVOKED');
select throws_ok($$ select * from public.accept_invitation('tok-archived') $$, 'P0002', 'INVITATION_NOT_FOUND',
  'token for an archived space is INVITATION_NOT_FOUND');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select throws_ok($$ select * from public.accept_invitation('tok-valid') $$, 'P0001', 'INVITATION_EMAIL_MISMATCH',
  'another account cannot accept someone else''s invitation');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', true);
select throws_ok($$ select * from public.accept_invitation('tok-deactivated') $$, '42501', 'FORBIDDEN',
  'deactivated user cannot accept');

-- ---------------------------------------------------------------- accept_invitation: success
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is(app.has_active_access(), true, 'guest with a valid pending invitation keeps the session (T7.8)');
select is(app.space_role('10000000-0000-0000-0000-000000000001'), null::public.space_role, 'guest cannot view the space before accepting');
select results_eq(
  $$ select space_id, space_slug, role::text from public.accept_invitation('tok-valid') $$,
  $$ values ('10000000-0000-0000-0000-000000000001'::uuid, 'members-a'::text, 'viewer'::text) $$,
  'invitee accepts and gets the invited role'
);
select is(app.space_role('10000000-0000-0000-0000-000000000001'), 'viewer'::public.space_role, 'accepted guest is now a viewer');
select is(app.has_active_access(), true, 'accepted guest now has active access');
select throws_ok($$ select * from public.accept_invitation('tok-valid') $$, 'P0001', 'INVITATION_ALREADY_USED',
  'a token is single-use');
select is((select status from public.get_invitation('tok-valid')), 'accepted', 'preview reports accepted');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select throws_ok($$ select * from public.accept_invitation('tok-valid') $$, 'P0001', 'INVITATION_ALREADY_USED',
  'a used token cannot be replayed by anyone');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is((select role::text from public.accept_invitation('tok-upgrade')), 'editor', 'existing viewer is upgraded to editor');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is((select role::text from public.accept_invitation('tok-no-downgrade')), 'editor', 'existing editor is never downgraded');

reset role;
select results_eq(
  $$ select accepted_by, accepted_at is not null from public.invitations where id = '20000000-0000-0000-0000-000000000001' $$,
  $$ values ('00000000-0000-0000-0000-000000000006'::uuid, true) $$,
  'invitation is marked accepted by the invitee'
);
select is(
  (select added_by from public.space_members
    where space_id = '10000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-000000000006'),
  '00000000-0000-0000-0000-000000000002'::uuid,
  'membership is attributed to the inviter'
);
select is(
  (select actor_id from public.audit_logs where action = 'invitation.accept'
     and entity_id = '20000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-000000000006'::uuid,
  'acceptance is audited with the invitee as actor'
);
select is(
  (select count(*)::int from public.audit_logs where action = 'member.add'
     and entity_id = '00000000-0000-0000-0000-000000000006'),
  1,
  'acceptance audits member.add'
);
select is(
  (select metadata from public.audit_logs where action = 'member.role_change'
     and entity_id = '00000000-0000-0000-0000-000000000004'),
  '{"user_id": "00000000-0000-0000-0000-000000000004", "from_role": "viewer", "to_role": "editor"}'::jsonb,
  'upgrade through an invitation audits member.role_change'
);
set local role authenticated;

-- ---------------------------------------------------------------- invitation state guard
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$ update public.invitations set revoked_at = now() where id = '20000000-0000-0000-0000-000000000001' $$,
  '23514', 'INVITATION_ALREADY_USED', 'an accepted invitation cannot be revoked or changed');
select throws_ok(
  $$ update public.invitations set revoked_at = null where id = '20000000-0000-0000-0000-000000000003' $$,
  '23514', 'INVITATION_REVOKED', 'a revoked invitation cannot be un-revoked');
select throws_ok(
  $$ update public.invitations set accepted_at = now() where id = '20000000-0000-0000-0000-000000000008' $$,
  '42501', null, 'admin cannot mark an invitation accepted directly');
select throws_ok(
  $$ update public.invitations set email = 'someone@else.test' where id = '20000000-0000-0000-0000-000000000008' $$,
  '42501', null, 'admin cannot retarget an invitation to another email');
select lives_ok(
  $$ update public.invitations
     set token_hash = app.invitation_token_hash('tok-pending-2'), expires_at = now() + interval '14 days'
     where id = '20000000-0000-0000-0000-000000000008' $$,
  'admin can rotate the token and extend a pending invitation (resend)');
select is((select count(*)::int from public.get_invitation('tok-pending')), 0, 'the old token stops working after a resend');

select lives_ok(
  $$ insert into public.invitations (id, email, space_id, role, token_hash, invited_by, accepted_at, accepted_by)
     values ('20000000-0000-0000-0000-000000000009', 'forged@outside.test', '10000000-0000-0000-0000-000000000001',
             'viewer', app.invitation_token_hash('tok-forged'), '00000000-0000-0000-0000-000000000003',
             now(), '00000000-0000-0000-0000-000000000003') $$,
  'admin insert with forged fields does not fail');
select results_eq(
  $$ select invited_by, accepted_at is null, accepted_by is null from public.invitations
     where id = '20000000-0000-0000-0000-000000000009' $$,
  $$ values ('00000000-0000-0000-0000-000000000002'::uuid, true, true) $$,
  'insert forces invited_by = caller and a fresh (unaccepted) state');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is(
  (select count(*)::int from public.invitations),
  0,
  'editor cannot read invitations'
);

-- ---------------------------------------------------------------- list_space_members
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select results_eq(
  $$ select user_id, role::text, email from public.list_space_members('10000000-0000-0000-0000-000000000001') $$,
  $$ values
       ('00000000-0000-0000-0000-000000000002'::uuid, 'admin'::text, 'admin@example.com'::text),
       ('00000000-0000-0000-0000-000000000003'::uuid, 'editor'::text, 'editor@example.com'::text),
       ('00000000-0000-0000-0000-000000000004'::uuid, 'editor'::text, 'viewer@example.com'::text),
       ('00000000-0000-0000-0000-000000000006'::uuid, 'viewer'::text, 'Guest@Outside.test'::text) $$,
  'a member sees every member, admins first, including guest co-members'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is((select count(*)::int from public.list_space_members('10000000-0000-0000-0000-000000000001')), 4,
  'accepted guest sees the member list of their space');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select is((select count(*)::int from public.list_space_members('10000000-0000-0000-0000-000000000001')), 0,
  'outsider sees no members of a restricted space');

-- ---------------------------------------------------------------- search_member_candidates
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select results_eq(
  $$ select user_id from public.search_member_candidates('10000000-0000-0000-0000-000000000001', 'nguyen') $$,
  $$ values ('00000000-0000-0000-0000-000000000005'::uuid) $$,
  'admin finds internal non-members accent-insensitively (not guests, not deactivated)'
);
select results_eq(
  $$ select user_id from public.search_member_candidates('10000000-0000-0000-0000-000000000001', '  ĐỨC ') $$,
  $$ values ('00000000-0000-0000-0000-000000000005'::uuid) $$,
  'search folds đ/Đ and case'
);
select results_eq(
  $$ select user_id from public.search_member_candidates('10000000-0000-0000-0000-000000000001', 'OUTSIDER@') $$,
  $$ values ('00000000-0000-0000-0000-000000000005'::uuid) $$,
  'admin finds people by email fragment'
);
select is((select count(*)::int from public.search_member_candidates('10000000-0000-0000-0000-000000000001', 'example.com')), 2,
  'existing members are excluded (only outsider and super admin remain)');
select is((select count(*)::int from public.search_member_candidates('10000000-0000-0000-0000-000000000001', '   ')), 0,
  'blank query returns nothing');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is((select count(*)::int from public.search_member_candidates('10000000-0000-0000-0000-000000000001', 'nguyen')), 0,
  'editor gets no candidates');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select is((select count(*)::int from public.search_member_candidates('10000000-0000-0000-0000-000000000001', 'nguyen')), 0,
  'guest gets no candidates');

-- ---------------------------------------------------------------- pending invitations (T7.8)
reset role;
select is(app.has_pending_invitation('pending@outside.test'), true, 'a valid invitation is pending');
select is(app.has_pending_invitation('PENDING@Outside.Test'), true, 'pending invitations match the email case-insensitively');
select is(app.has_pending_invitation('nobody@outside.test'), false, 'no invitation, nothing pending');
-- guest@outside.test: tok-valid accepted above; tok-expired, tok-revoked and tok-archived (Space archived) left.
select is(app.has_pending_invitation('guest@outside.test'), false,
  'accepted, expired, revoked and archived-Space invitations are not pending');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000009', 'pending@outside.test');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(
  (select access from public.admin_list_users(p_query => 'pending@outside.test') where email = 'pending@outside.test'),
  'invitation',
  'the admin user list reports a guest kept by a pending invitation as invitation'
);
reset role;

-- ---------------------------------------------------------------- anon
reset role;
set local role anon;
select throws_ok($$ select * from public.accept_invitation('tok-upgrade') $$, '42501', null,
  'anon cannot call accept_invitation');

select * from finish();
rollback;
