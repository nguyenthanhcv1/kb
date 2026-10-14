-- Page shares: a share gives a person access to a page and its subpages on top of their Space
-- role (highest wins, never admin); only Space admins share; editors by share edit content and
-- title but cannot move/trash/create; shares reach search, versions, documents and the Space name
-- only; page invitations grant a share on accept; everything is audited.
begin;

select plan(70);

insert into public.access_allowlist (kind, value) values ('domain', 'corp.example');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000901', 'admin@corp.example'),
  ('00000000-0000-0000-0000-000000000902', 'editor@corp.example'),
  ('00000000-0000-0000-0000-000000000903', 'viewer@corp.example'),
  ('00000000-0000-0000-0000-000000000904', 'internal@corp.example'),
  ('00000000-0000-0000-0000-000000000905', 'guest@partner.example'),
  ('00000000-0000-0000-0000-000000000906', 'guest2@partner.example'),
  ('00000000-0000-0000-0000-000000000907', 'locked@partner.example'),
  ('00000000-0000-0000-0000-000000000908', 'invitee@partner.example');

select set_config('request.jwt.claim.role', 'service_role', true);
update public.profiles set deactivated_at = now() where id = '00000000-0000-0000-0000-000000000907';
select set_config('request.jwt.claim.role', '', true);

-- Space S (restricted): admin 901, editor 902, viewer 903. Space T (restricted): admin 901.
insert into public.spaces (id, slug, name, visibility, created_by) values
  ('a0000000-0000-0000-0000-000000000001', 'pp-s', 'Shared Space', 'restricted', '00000000-0000-0000-0000-000000000901'),
  ('a0000000-0000-0000-0000-000000000002', 'pp-t', 'Other Space', 'restricted', '00000000-0000-0000-0000-000000000901');
insert into public.space_members (space_id, user_id, role) values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000902', 'editor'),
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000903', 'viewer');

-- Tree of S: root P1 > child P2 > grandchild P3; sibling root P4.
insert into public.pages (id, space_id, parent_id, position, title, created_by) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', null, 'a0', 'Hợp đồng', '00000000-0000-0000-0000-000000000901'),
  ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', null, 'a1', 'Nội bộ', '00000000-0000-0000-0000-000000000901');
insert into public.pages (id, space_id, parent_id, position, title, created_by) values
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'a0', 'Phụ lục', '00000000-0000-0000-0000-000000000901');
insert into public.pages (id, space_id, parent_id, position, title, created_by) values
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'a0', 'Bảng giá đối tác', '00000000-0000-0000-0000-000000000901');

-- ---------------------------------------------------------------- only Space admins share
set local role authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000902', true);
select is(app.can_share_page('b0000000-0000-0000-0000-000000000001'), false, 'a Space editor cannot share');
select throws_ok(
  $$ insert into public.page_permissions (page_id, user_id, role) values ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000905', 'viewer') $$,
  '42501', null, 'nor insert a share directly'
);
select throws_ok(
  $$ select * from public.share_page('b0000000-0000-0000-0000-000000000001', 'guest@partner.example', 'viewer') $$,
  '42501', 'FORBIDDEN', 'nor through share_page'
);
select throws_ok($$ select * from public.list_page_shares('b0000000-0000-0000-0000-000000000001') $$,
  '42501', 'FORBIDDEN', 'nor list the shares of a page');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000901', true);
select is(app.can_share_page('b0000000-0000-0000-0000-000000000001'), true, 'a Space admin can share');
select results_eq(
  $$ select status, role::text from public.share_page('b0000000-0000-0000-0000-000000000001', ' GUEST@partner.example ', 'viewer') $$,
  $$ values ('granted', 'viewer') $$,
  'share_page grants a share to an existing account (email trimmed, case-insensitive)'
);
select results_eq(
  $$ select status, user_id from public.share_page('b0000000-0000-0000-0000-000000000001', 'nobody@partner.example', 'viewer') $$,
  $$ values ('no_account', null::uuid) $$,
  'an email without an account is reported as no_account'
);
select throws_ok(
  $$ select * from public.share_page('b0000000-0000-0000-0000-000000000001', 'locked@partner.example', 'viewer') $$,
  'P0001', 'PAGE_SHARE_USER_INACTIVE', 'a locked account cannot get a share'
);
select throws_ok(
  $$ select * from public.share_page('b0000000-0000-0000-0000-000000000001', 'guest@partner.example', 'admin') $$,
  '22023', 'VALIDATION_FAILED', 'a share is never admin'
);
select throws_ok(
  $$ insert into public.page_permissions (page_id, user_id, role) values ('b0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000905', 'admin') $$,
  '23514', null, 'not even by a direct insert'
);
select lives_ok(
  $$ insert into public.page_permissions (page_id, user_id, role) values ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000906', 'editor') $$,
  'a Space admin inserts a share directly (guest2 edits P2)'
);
select is(
  (select granted_by from public.page_permissions where page_id = 'b0000000-0000-0000-0000-000000000002' and user_id = '00000000-0000-0000-0000-000000000906'),
  '00000000-0000-0000-0000-000000000901'::uuid, 'granted_by is the caller'
);
select lives_ok(
  $$ select * from public.share_page('b0000000-0000-0000-0000-000000000003', 'internal@corp.example', 'editor') $$,
  'an internal non-member gets editor on P3'
);

select results_eq(
  $$ select email, role::text, source_page_id, inherited from public.list_page_shares('b0000000-0000-0000-0000-000000000003') $$,
  $$ values ('internal@corp.example', 'editor', 'b0000000-0000-0000-0000-000000000003'::uuid, false),
            ('guest2@partner.example', 'editor', 'b0000000-0000-0000-0000-000000000002'::uuid, true),
            ('guest@partner.example', 'viewer', 'b0000000-0000-0000-0000-000000000001'::uuid, true) $$,
  'list_page_shares shows direct shares first, then inherited ones with their source page'
);

-- ---------------------------------------------------------------- effective roles
reset role;

select is(app.user_page_role('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000905'), 'viewer'::public.space_role, 'guest is viewer of the shared page');
select is(app.user_page_role('b0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000905'), 'viewer'::public.space_role, 'and of its grandchild');
select is(app.user_page_role('b0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000905'), null, 'but not of a sibling page');
select is(app.user_space_role('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000905'), null, 'a share is not Space access');
select is(app.user_page_role('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000906'), null, 'a share on a child does not reach the parent');
select is(app.user_page_role('b0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000906'), 'editor'::public.space_role, 'an editor share covers subpages');
select is(app.user_page_role('b0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000904'), 'editor'::public.space_role, 'the internal person is editor of P3');
select is(app.authorize_document('b0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000906'), 'editor'::public.space_role, 'kb-collab lets an editor by share connect');
select is(app.authorize_document('b0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000906'), null, 'but not to an unshared page');

-- Highest wins: a Space viewer with an editor share edits that page only.
insert into public.page_permissions (page_id, user_id, role) values
  ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000903', 'editor');
select is(app.user_page_role('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000903'), 'editor'::public.space_role, 'a Space viewer with an editor share is editor of that page');
select is(app.user_page_role('b0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000903'), 'viewer'::public.space_role, 'and stays viewer elsewhere');
-- A share never lowers a Space role.
insert into public.page_permissions (page_id, user_id, role) values
  ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000902', 'viewer');
select is(app.user_page_role('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000902'), 'editor'::public.space_role, 'a viewer share does not lower a Space editor');

-- ---------------------------------------------------------------- RLS as the guest
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000905', true);

select results_eq(
  $$ select id from public.pages order by id $$,
  $$ values ('b0000000-0000-0000-0000-000000000001'::uuid), ('b0000000-0000-0000-0000-000000000002'::uuid), ('b0000000-0000-0000-0000-000000000003'::uuid) $$,
  'the guest sees the shared page and its subpages, nothing else'
);
select is((select count(*)::int from public.page_documents), 3, 'and their documents');
select is((select count(*)::int from public.page_search), 3, 'and their search rows');
select results_eq($$ select slug::text from public.spaces $$, $$ values ('pp-s') $$,
  'the guest sees the Space of the shared page (name for links), not other Spaces');
select is(app.can_view_space('a0000000-0000-0000-0000-000000000001'), false, 'but cannot view the Space itself');
select is_empty($$ select * from public.space_members $$, 'nor its members');
select is((select count(*)::int from public.page_permissions), 1, 'the guest sees their own share only');
select is(app.has_active_access(), true, 'a share keeps the session alive');
select is(public.my_page_role('b0000000-0000-0000-0000-000000000002'), 'viewer'::public.space_role, 'my_page_role reports the share');
select results_eq(
  $$ select page_id, space_slug, role::text from public.list_shared_with_me() $$,
  $$ values ('b0000000-0000-0000-0000-000000000001'::uuid, 'pp-s', 'viewer') $$,
  'list_shared_with_me lists the directly shared page with its Space'
);
select results_eq(
  $$ select page_id from public.search_pages('bang gia') $$,
  $$ values ('b0000000-0000-0000-0000-000000000003'::uuid) $$,
  'search finds a shared subpage (accent-insensitive)'
);
select is_empty($$ select * from public.search_pages('noi bo') $$, 'but not an unshared page');
select is_empty(
  $$ update public.pages set title = 'Hack' where id = 'b0000000-0000-0000-0000-000000000001' returning id $$,
  'a viewer by share cannot rename'
);
select throws_ok(
  $$ insert into public.pages (space_id, parent_id, position, title) values ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'b0', 'Mới') $$,
  '42501', null, 'nor create a subpage'
);

-- ---------------------------------------------------------------- an editor by share
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000906', true);
select isnt_empty(
  $$ update public.pages set title = 'Phụ lục (sửa)', icon = '📎' where id = 'b0000000-0000-0000-0000-000000000002' returning id $$,
  'an editor by share renames and sets the icon of the shared page'
);
select throws_ok(
  $$ update public.pages set deleted_at = now() where id = 'b0000000-0000-0000-0000-000000000002' $$,
  '42501', null, 'but cannot trash it'
);
select throws_ok(
  $$ update public.pages set parent_id = null, position = 'z0' where id = 'b0000000-0000-0000-0000-000000000003' $$,
  '42501', 'FORBIDDEN', 'nor move a subpage'
);
select throws_ok(
  $$ update public.pages set space_id = 'a0000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-000000000002' $$,
  '42501', null, 'nor move it to another Space'
);
select is_empty(
  $$ update public.pages set title = 'x' where id = 'b0000000-0000-0000-0000-000000000001' returning id $$,
  'nor rename the unshared parent'
);
select is_empty(
  $$ update public.page_permissions set role = 'editor' where user_id = '00000000-0000-0000-0000-000000000906' returning page_id $$,
  'a person cannot touch their own share'
);
select is_empty(
  $$ update public.page_permissions set role = 'viewer' where user_id = '00000000-0000-0000-0000-000000000906' returning page_id $$,
  'nor change it at all (only Space admins update shares)'
);

-- ---------------------------------------------------------------- trash, archive, lock
reset role;
update public.pages set deleted_at = now() where id = 'b0000000-0000-0000-0000-000000000001';
select is(app.user_page_role('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000906'), null, 'shares do not reach trashed pages');
select is(app.user_page_role('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000902'), 'editor'::public.space_role, 'Space editors still reach the trash');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000905', true);
select is_empty($$ select * from public.list_shared_with_me() $$, 'a trashed page leaves the shared list');
select is_empty($$ select * from public.spaces $$, 'and its Space is no longer visible');
reset role;
update public.pages set deleted_at = null where id = 'b0000000-0000-0000-0000-000000000001';
select is(app.user_page_role('b0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000905'), 'viewer'::public.space_role, 'restoring brings the share back');

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
update public.profiles set deactivated_at = now() where id = '00000000-0000-0000-0000-000000000905';
select is(app.user_page_role('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000905'), null, 'a locked account loses its shares');
update public.profiles set deactivated_at = null where id = '00000000-0000-0000-0000-000000000905';
select set_config('request.jwt.claim.role', '', true);

update public.spaces set archived_at = now() where id = 'a0000000-0000-0000-0000-000000000001';
select is(app.user_page_role('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000905'), null, 'shares do not reach an archived Space');
update public.spaces set archived_at = null where id = 'a0000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------- page invitations
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000901', true);
select lives_ok(
  $$ insert into public.invitations (id, email, space_id, page_id, role, token_hash, invited_by)
     values ('c0000000-0000-0000-0000-000000000001', 'invitee@partner.example', 'a0000000-0000-0000-0000-000000000002',
             'b0000000-0000-0000-0000-000000000002', 'editor', app.invitation_token_hash('tok-page'), '00000000-0000-0000-0000-000000000901') $$,
  'a Space admin invites an email to a page'
);
select is(
  (select space_id from public.invitations where id = 'c0000000-0000-0000-0000-000000000001'),
  'a0000000-0000-0000-0000-000000000001'::uuid, 'a page invitation always belongs to the Space of its page'
);
select throws_ok(
  $$ update public.invitations set page_id = 'b0000000-0000-0000-0000-000000000004' where id = 'c0000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'the page of an invitation cannot be changed through PostgREST'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000902', true);
select throws_ok(
  $$ insert into public.invitations (email, space_id, page_id, role, token_hash, invited_by)
     values ('x@partner.example', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
             'viewer', app.invitation_token_hash('tok-x'), '00000000-0000-0000-0000-000000000902') $$,
  '42501', null, 'a Space editor cannot invite to a page'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000908', true);
select results_eq(
  $$ select page_id, page_title, space_slug, role::text, status from public.get_invitation('tok-page') $$,
  $$ values ('b0000000-0000-0000-0000-000000000002'::uuid, 'Phụ lục (sửa)', 'pp-s', 'editor', 'pending') $$,
  'the invite page previews the page'
);
select is(app.has_active_access(), true, 'a pending page invitation keeps the session');
select results_eq(
  $$ select space_slug, role::text, page_id from public.accept_invitation('tok-page') $$,
  $$ values ('pp-s', 'editor', 'b0000000-0000-0000-0000-000000000002'::uuid) $$,
  'accepting grants the page share and returns the page'
);
select is(public.my_page_role('b0000000-0000-0000-0000-000000000003'), 'editor'::public.space_role, 'the invitee now edits the page and its subpages');
select is(app.can_view_space('a0000000-0000-0000-0000-000000000001'), false, 'without becoming a Space member');
select is(
  (select granted_by from public.page_permissions where user_id = '00000000-0000-0000-0000-000000000908'),
  '00000000-0000-0000-0000-000000000901'::uuid, 'the share is granted by the inviter'
);

-- ---------------------------------------------------------------- leave, unshare, audit
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000908', true);
select isnt_empty($$ delete from public.page_permissions where user_id = '00000000-0000-0000-0000-000000000908' returning page_id $$,
  'a person can leave a page shared with them');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000901', true);
select lives_ok($$ select * from public.share_page('b0000000-0000-0000-0000-000000000001', 'guest@partner.example', 'editor') $$,
  'a Space admin changes the role of a share');
select isnt_empty(
  $$ delete from public.page_permissions where page_id = 'b0000000-0000-0000-0000-000000000003' and user_id = '00000000-0000-0000-0000-000000000904' returning page_id $$,
  'and removes a share'
);
reset role;

select results_eq(
  $$ select action, metadata ->> 'email', coalesce(metadata ->> 'role', metadata ->> 'to_role'), space_id
     from public.audit_logs
     where action like 'page.%share%' and space_id = 'a0000000-0000-0000-0000-000000000001'
     order by occurred_at, id $$,
  $$ select * from (values
       ('page.share', 'guest@partner.example', 'viewer', 'a0000000-0000-0000-0000-000000000001'::uuid),
       ('page.share', 'guest2@partner.example', 'editor', 'a0000000-0000-0000-0000-000000000001'::uuid),
       ('page.share', 'internal@corp.example', 'editor', 'a0000000-0000-0000-0000-000000000001'::uuid),
       ('page.share', 'viewer@corp.example', 'editor', 'a0000000-0000-0000-0000-000000000001'::uuid),
       ('page.share', 'editor@corp.example', 'viewer', 'a0000000-0000-0000-0000-000000000001'::uuid),
       ('page.share', 'invitee@partner.example', 'editor', 'a0000000-0000-0000-0000-000000000001'::uuid),
       ('page.unshare', 'invitee@partner.example', 'editor', 'a0000000-0000-0000-0000-000000000001'::uuid),
       ('page.share_role_change', 'guest@partner.example', 'editor', 'a0000000-0000-0000-0000-000000000001'::uuid),
       ('page.unshare', 'internal@corp.example', 'editor', 'a0000000-0000-0000-0000-000000000001'::uuid)
     ) as v(a, e, r, s) $$,
  'every share, role change and removal is audited in the Space'
);
select is(
  (select metadata ->> 'page_id' from public.audit_logs where action = 'invitation.create' and entity_id = 'c0000000-0000-0000-0000-000000000001'),
  'b0000000-0000-0000-0000-000000000002', 'a page invitation names its page in the audit trail'
);

-- Purging a page removes its shares without an extra audit row.
update public.pages set deleted_at = now() where id = 'b0000000-0000-0000-0000-000000000001';
delete from public.pages where id = 'b0000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.page_permissions), 0, 'purging a page removes the shares of its subtree');

select * from finish();
rollback;
