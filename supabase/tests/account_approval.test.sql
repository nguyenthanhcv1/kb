-- Account approval: every new account is pending until a super admin approves it (or rejects it).
-- Fixtures turn `require_account_approval` on (the local seed turns it off for the other tests).
begin;

select plan(31);

update public.app_settings
set require_account_approval = true,
    bootstrap_admin_emails = array['admin@corp.example']::extensions.citext[]
where id = 1;

insert into public.access_allowlist (kind, value) values ('domain', 'corp.example');

-- The bootstrap admin signs up first (exempt), owns a Space and invites someone.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000301', 'admin@corp.example');

insert into public.spaces (id, slug, name, visibility, created_by) values
  ('60000000-0000-0000-0000-000000000001', 'approval-internal', 'Approval internal', 'internal', '00000000-0000-0000-0000-000000000301');

insert into public.invitations (email, space_id, role, token_hash, invited_by, expires_at) values
  ('invited@outside.example', '60000000-0000-0000-0000-000000000001', 'viewer', 'approval-token', '00000000-0000-0000-0000-000000000301', now() + interval '14 days');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000302', 'staff@corp.example'),
  ('00000000-0000-0000-0000-000000000303', 'stranger@outside.example'),
  ('00000000-0000-0000-0000-000000000304', 'invited@outside.example'),
  ('00000000-0000-0000-0000-000000000305', 'reject-me@outside.example'),
  ('00000000-0000-0000-0000-000000000306', 'second-chance@outside.example');

-- Sign-in gate ----------------------------------------------------------------------------

select is(
  app.before_user_created_hook(jsonb_build_object('user', jsonb_build_object('email', 'anyone@outside.example'))),
  '{}'::jsonb,
  'approval required: any email may create an account'
);

update public.app_settings set require_account_approval = false where id = 1;
select is(
  app.before_user_created_hook(jsonb_build_object('user', jsonb_build_object('email', 'anyone@outside.example'))) -> 'error' ->> 'message',
  'AUTH_NOT_ALLOWED',
  'approval off: an unknown email is rejected again (allowlist / invitation gate)'
);
update public.app_settings set require_account_approval = true where id = 1;

-- Initial status ----------------------------------------------------------------------------

select results_eq(
  $$ select email::text, status::text from public.profiles
     where id::text like '00000000-0000-0000-0000-0000000003%' order by email $$,
  $$ values ('admin@corp.example', 'active'), ('invited@outside.example', 'active'),
            ('reject-me@outside.example', 'pending'), ('second-chance@outside.example', 'pending'),
            ('staff@corp.example', 'pending'), ('stranger@outside.example', 'pending') $$,
  'bootstrap admin and invited email start active; allowlisted and unknown emails start pending'
);

-- A pending account sees and does nothing ----------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000302', true);

select is(public.account_status(), 'pending', 'account_status: pending');
select is(app.has_active_access(), false, 'pending account has no active access (not even when allowlisted)');
select is(app.can_view_space('60000000-0000-0000-0000-000000000001'), false, 'pending internal user cannot view an internal Space');
select is_empty($$ select id from public.spaces $$, 'pending user sees no Spaces');
select is((select count(*)::int from public.profiles), 1, 'pending user only sees their own profile');
select throws_ok($$ select * from public.admin_list_pending_accounts() $$, '42501', 'FORBIDDEN', 'pending user cannot list accounts');
select throws_ok(
  $$ select public.admin_approve_account('00000000-0000-0000-0000-000000000302', false) $$,
  '42501', 'FORBIDDEN', 'pending user cannot approve themselves'
);
select throws_ok(
  $$ update public.profiles set status = 'active' where id = '00000000-0000-0000-0000-000000000302' $$,
  '42501', null, 'pending user cannot flip their own status'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000304', true);
select is(public.account_status(), 'active', 'invited account is active');
select is(app.has_active_access(), true, 'invited account keeps its session (pending invitation)');

-- Super admin reviews -------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000301', true);

select results_eq(
  $$ select email, total_count from public.admin_list_pending_accounts('pending') order by email $$,
  $$ values ('reject-me@outside.example', 4), ('second-chance@outside.example', 4),
            ('staff@corp.example', 4), ('stranger@outside.example', 4) $$,
  'super admin lists the pending accounts, oldest first'
);
select throws_ok($$ select * from public.admin_list_pending_accounts('bogus') $$, '22023', 'VALIDATION_FAILED', 'unknown status filter is rejected');

select lives_ok($$ select public.admin_approve_account('00000000-0000-0000-0000-000000000302', false) $$, 'approve as internal user');
select lives_ok($$ select public.admin_approve_account('00000000-0000-0000-0000-000000000303', true) $$, 'approve as guest');
select lives_ok($$ select public.admin_reject_account('00000000-0000-0000-0000-000000000305', '  Not one of ours  ') $$, 'reject with a reason');
select lives_ok($$ select public.admin_reject_account('00000000-0000-0000-0000-000000000306') $$, 'reject without a reason');
select lives_ok($$ select public.admin_approve_account('00000000-0000-0000-0000-000000000306', true) $$, 'a rejected account can be approved later');

select throws_ok($$ select public.admin_approve_account('00000000-0000-0000-0000-000000000302', false) $$, '23514', 'ACCOUNT_NOT_PENDING', 'approving an active account is refused');
select throws_ok($$ select public.admin_reject_account('00000000-0000-0000-0000-000000000302') $$, '23514', 'ACCOUNT_NOT_PENDING', 'rejecting a non-pending account is refused');
select throws_ok($$ select public.admin_approve_account('00000000-0000-0000-0000-0000000003ff', false) $$, 'P0002', 'USER_NOT_FOUND', 'unknown user');

-- After the decision ---------------------------------------------------------------------------

reset role;

select results_eq(
  $$ select email::text, status::text, is_guest, reviewed_by is not null and reviewed_at is not null, reject_reason
     from public.profiles where id::text like '00000000-0000-0000-0000-00000000030%'
       and id not in ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000304')
     order by email $$,
  $$ values ('reject-me@outside.example', 'rejected', true, true, 'Not one of ours'),
            ('second-chance@outside.example', 'active', true, true, null),
            ('staff@corp.example', 'active', false, true, null),
            ('stranger@outside.example', 'active', true, true, null) $$,
  'decisions are recorded: status, the admin picked internal/guest, reviewer, reason (trimmed)'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000302', true);
select is(app.has_active_access(), true, 'approved internal user keeps access without a Space membership');
select is(app.can_view_space('60000000-0000-0000-0000-000000000001'), true, 'approved internal user views internal Spaces');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000303', true);
select is(app.can_view_space('60000000-0000-0000-0000-000000000001'), false, 'approved guest does not see internal Spaces');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000305', true);
select is(public.account_status(), 'rejected', 'account_status: rejected');
select is(app.has_active_access(), false, 'rejected account has no access');

reset role;

-- Audit ---------------------------------------------------------------------------------------

select is(
  (select count(*)::int from public.audit_logs where action = 'user.approve'),
  3,
  'every approval is audited'
);
select is(
  (select metadata ->> 'reason' from public.audit_logs where action = 'user.reject' and entity_id = '00000000-0000-0000-0000-000000000305'),
  'Not one of ours',
  'a rejection is audited with its reason'
);

select * from finish();
rollback;
