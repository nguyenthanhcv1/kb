begin;

select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000002', 'admin@example.com'),
  ('00000000-0000-0000-0000-000000000003', 'admin2@example.com');

select set_config('request.jwt.claim.role', 'service_role', true);
update public.profiles set is_guest = false;
select set_config('request.jwt.claim.role', '', true);

insert into public.spaces (id, slug, name, visibility, created_by) values
  ('10000000-0000-0000-0000-00000000000a', 'space-a', 'A', 'restricted', '00000000-0000-0000-0000-000000000002');
insert into public.space_members (space_id, user_id, role, added_by) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000003', 'admin', '00000000-0000-0000-0000-000000000002');

-- ---------------------------------------------------------------- invitations
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);

select lives_ok(
  $$ insert into public.invitations (email, space_id, role, token_hash, invited_by)
     select 'guest' || n || '@outside.test', '10000000-0000-0000-0000-00000000000a', 'viewer',
            app.invitation_token_hash('tok-' || n), '00000000-0000-0000-0000-000000000002'
     from generate_series(1, 30) as n $$,
  'an admin sends 30 invitations within an hour'
);
select throws_ok(
  $$ insert into public.invitations (email, space_id, role, token_hash, invited_by)
     values ('guest31@outside.test', '10000000-0000-0000-0000-00000000000a', 'viewer',
             app.invitation_token_hash('tok-31'), '00000000-0000-0000-0000-000000000002') $$,
  'P0001', 'RATE_LIMITED', 'the 31st invitation in the hour is rate limited'
);
select throws_ok(
  $$ update public.invitations set token_hash = app.invitation_token_hash('tok-1b')
     where email = 'guest1@outside.test' $$,
  'P0001', 'RATE_LIMITED', 're-sending (new token) counts against the same limit'
);
select lives_ok(
  $$ update public.invitations set role = 'editor' where email = 'guest1@outside.test' $$,
  'changing the role of a pending invitation is not rate limited'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select lives_ok(
  $$ insert into public.invitations (email, space_id, role, token_hash, invited_by)
     values ('other@outside.test', '10000000-0000-0000-0000-00000000000a', 'viewer',
             app.invitation_token_hash('tok-other'), '00000000-0000-0000-0000-000000000003') $$,
  'limits are per user: another admin can still invite'
);

-- ---------------------------------------------------------------- consume_rate_limit
select lives_ok($$ select app.consume_rate_limit('search', 2, interval '1 minute') $$, 'hit 1 of 2');
select lives_ok($$ select app.consume_rate_limit('search', 2, interval '1 minute') $$, 'hit 2 of 2');
select throws_ok($$ select app.consume_rate_limit('search', 2, interval '1 minute') $$,
  'P0001', 'RATE_LIMITED', 'hit 3 of 2 is rate limited');

select throws_ok($$ select * from app.rate_limit_hits $$, '42501', null,
  'clients cannot read the counters');

reset role;

-- Finished windows are removed on the next hit of the same caller and bucket.
update app.rate_limit_hits set window_start = window_start - interval '1 hour'
where bucket = 'search' and subject = '00000000-0000-0000-0000-000000000003';
set local role authenticated;
select app.consume_rate_limit('search', 2, interval '1 minute');
reset role;
select is(
  (select count(*)::int from app.rate_limit_hits
   where bucket = 'search' and subject = '00000000-0000-0000-0000-000000000003'),
  1, 'old windows are cleaned up by the next hit'
);

select set_config('request.jwt.claim.sub', '', true);

-- No actor (migrations, maintenance as superuser) is never limited.
select lives_ok(
  $$ select app.consume_rate_limit('search', 1, interval '1 minute') from generate_series(1, 5) $$,
  'no actor = not limited'
);

select * from finish();
rollback;
