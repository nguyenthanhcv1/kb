begin;

select plan(20);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000002', 'admin@example.com'),
  ('00000000-0000-0000-0000-000000000003', 'editor@example.com'),
  ('00000000-0000-0000-0000-000000000004', 'viewer@example.com'),
  ('00000000-0000-0000-0000-000000000005', 'outsider@example.com'),
  ('00000000-0000-0000-0000-000000000006', 'guest@partner.test');

-- Fixtures are internal users except the guest (who is a viewer of space A only).
select set_config('request.jwt.claim.role', 'service_role', true);
update public.profiles set is_guest = (id = '00000000-0000-0000-0000-000000000006');
select set_config('request.jwt.claim.role', '', true);

insert into public.spaces (id, slug, name, visibility, created_by) values
  ('10000000-0000-0000-0000-00000000000a', 'space-a', 'A', 'restricted', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000b', 'space-b', 'B', 'restricted', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000c', 'space-c', 'C', 'internal', '00000000-0000-0000-0000-000000000002');
insert into public.space_members (space_id, user_id, role, added_by) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000003', 'editor', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', 'viewer', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000006', 'viewer', '00000000-0000-0000-0000-000000000002');
insert into public.pages (id, space_id, position, title, created_by) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'V', 'Quy trình nghỉ phép', '00000000-0000-0000-0000-000000000003'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000b', 'V', 'Bí mật', '00000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-00000000000c', 'V', 'Nội quy', '00000000-0000-0000-0000-000000000002');

-- ---------------------------------------------------------------- normalisation
select is(app.vn_unaccent('Quy Trình NGHỈ PHÉP Đà Nẵng'), 'quy trinh nghi phep da nang',
  'vn_unaccent removes diacritics, maps đ to d and lowercases');
select is(app.vn_unaccent(normalize('nghỉ phép', NFD)), app.vn_unaccent('nghỉ phép'),
  'vn_unaccent gives the same result for NFD and NFC input');
select ok(
  to_tsvector('vi_unaccent', 'Quy trình nghỉ phép năm') @@ plainto_tsquery('vi_unaccent', 'nghi phep'),
  '"nghi phep" matches "nghỉ phép" with vi_unaccent'
);
select ok(
  to_tsvector('vi_unaccent', 'Đường dây nóng') @@ plainto_tsquery('vi_unaccent', 'duong'),
  '"duong" matches "Đường"'
);
select ok(
  not (to_tsvector('vi_unaccent', 'running') @@ plainto_tsquery('vi_unaccent', 'run')),
  'vi_unaccent does not stem'
);

-- ---------------------------------------------------------------- maintenance
select is(
  (select count(*)::int from public.page_search),
  3,
  'every page gets a page_search row'
);
select is(
  (select title_norm from public.page_search where page_id = '20000000-0000-0000-0000-000000000001'),
  'quy trinh nghi phep',
  'title_norm is the unaccented title'
);

-- Content written by kb-collab (NFD, as pasted from macOS) is indexed as NFC.
update public.page_documents
set content_text = normalize('Nhân viên được nghỉ phép 12 ngày mỗi năm.', NFD),
    headings_text = 'Chính sách',
    table_text = 'Loại | Số ngày'
where page_id = '20000000-0000-0000-0000-000000000001';

select ok(
  (select tsv @@ plainto_tsquery('vi_unaccent', 'nhan vien 12 ngay') from public.page_search
   where page_id = '20000000-0000-0000-0000-000000000001'),
  'content update refreshes tsv and NFD content matches an unaccented query'
);
select ok(
  (select tsv_exact @@ plainto_tsquery('simple', 'nhân viên') from public.page_search
   where page_id = '20000000-0000-0000-0000-000000000001'),
  'NFD content matches an accented NFC query in tsv_exact'
);
select ok(
  (select not (tsv_exact @@ plainto_tsquery('simple', 'nhan vien')) from public.page_search
   where page_id = '20000000-0000-0000-0000-000000000001'),
  'tsv_exact keeps accents'
);
select ok(
  (select tsv @@ to_tsquery('vi_unaccent', 'so & ngay') from public.page_search
   where page_id = '20000000-0000-0000-0000-000000000001'),
  'table text is indexed'
);
select is(
  (select ts_rank(tsv, plainto_tsquery('vi_unaccent', 'quy trinh')) > ts_rank(tsv, plainto_tsquery('vi_unaccent', 'chinh sach'))
   from public.page_search where page_id = '20000000-0000-0000-0000-000000000001'),
  true,
  'title words weigh more than heading words'
);

update public.pages set title = 'Quy định làm thêm giờ' where id = '20000000-0000-0000-0000-000000000001';
select is(
  (select title_norm from public.page_search where page_id = '20000000-0000-0000-0000-000000000001'),
  'quy dinh lam them gio',
  'renaming a page refreshes page_search'
);

-- ---------------------------------------------------------------- RLS
set local role authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select results_eq(
  $$ select page_id from public.page_search order by page_id $$,
  $$ values ('20000000-0000-0000-0000-000000000001'::uuid), ('20000000-0000-0000-0000-000000000003'::uuid) $$,
  'viewer sees pages of their Space and of internal Spaces'
);
select throws_ok($$ update public.page_search set title = 'x' $$, '42501', null,
  'authenticated cannot write page_search');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select results_eq(
  $$ select page_id from public.page_search $$,
  $$ values ('20000000-0000-0000-0000-000000000001'::uuid) $$,
  'guest sees only the Space they were invited to (not internal Spaces)'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select results_eq(
  $$ select page_id from public.page_search $$,
  $$ values ('20000000-0000-0000-0000-000000000003'::uuid) $$,
  'internal non-member sees internal Spaces only'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
update public.pages set deleted_at = now() where id = '20000000-0000-0000-0000-000000000001';
select is_empty(
  $$ select 1 from public.page_search where page_id = '20000000-0000-0000-0000-000000000001' $$,
  'trashed pages are hidden from search, even for editors'
);

reset role;

select ok(
  (select is_deleted from public.page_search where page_id = '20000000-0000-0000-0000-000000000001'),
  'trashing a page marks its page_search row deleted'
);

set local role anon;
select throws_ok($$ select * from public.page_search $$, '42501', null, 'anon cannot read page_search');
reset role;

select * from finish();

rollback;
