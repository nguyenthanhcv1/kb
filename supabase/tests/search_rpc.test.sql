begin;

select plan(18);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000002', 'admin@example.com'),
  ('00000000-0000-0000-0000-000000000003', 'editor@example.com'),
  ('00000000-0000-0000-0000-000000000004', 'viewer@example.com'),
  ('00000000-0000-0000-0000-000000000005', 'outsider@example.com'),
  ('00000000-0000-0000-0000-000000000006', 'guest@partner.test');

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
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000b', 'V', 'Nghỉ phép bí mật', '00000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-00000000000c', 'V', 'Nội quy công ty', '00000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-00000000000a', 'W', 'Ghi chú nghi phep', '00000000-0000-0000-0000-000000000003'),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-00000000000a', 'X', 'Bảng nhân sự', '00000000-0000-0000-0000-000000000003');

update public.page_documents set
  content_text = 'Nhân viên được nghỉ phép 12 ngày mỗi năm.', headings_text = 'Chính sách'
  where page_id = '20000000-0000-0000-0000-000000000001';
update public.page_documents set content_text = 'Chỉ dành cho ban giám đốc, nghỉ phép riêng.'
  where page_id = '20000000-0000-0000-0000-000000000002';
update public.page_documents set content_text = 'Giờ làm việc và nghỉ phép theo quy định.'
  where page_id = '20000000-0000-0000-0000-000000000003';
update public.page_documents set content_text = 'Ghi chú nội bộ nghi phep khong dau.'
  where page_id = '20000000-0000-0000-0000-000000000004';
update public.page_documents set table_text = 'Mã | Tên' || E'\n' || 'NV001 | Nguyễn Văn Phương'
  where page_id = '20000000-0000-0000-0000-000000000005';

-- ---------------------------------------------------------------- permissions
set local role authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select results_eq(
  $$ select page_id from public.search_pages('nghi phep') order by page_id $$,
  $$ values ('20000000-0000-0000-0000-000000000001'::uuid),
            ('20000000-0000-0000-0000-000000000003'::uuid),
            ('20000000-0000-0000-0000-000000000004'::uuid) $$,
  'viewer finds pages of their Space and internal Spaces, never the restricted Space B'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select results_eq(
  $$ select page_id from public.search_pages('nghi phep') order by page_id $$,
  $$ values ('20000000-0000-0000-0000-000000000001'::uuid),
            ('20000000-0000-0000-0000-000000000004'::uuid) $$,
  'guest finds only the Space they were invited to'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select results_eq(
  $$ select page_id from public.search_pages('nghi phep') $$,
  $$ values ('20000000-0000-0000-0000-000000000003'::uuid) $$,
  'internal non-member finds internal Spaces only'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select is(
  (select count(*)::int from public.search_pages('nghi phep',
     array['10000000-0000-0000-0000-00000000000b']::uuid[])),
  1,
  'Space filter restricts results to the given Spaces'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);

-- ---------------------------------------------------------------- matching
select ok(
  (select count(*) from public.search_pages('NGHỈ PHÉP')) = 3,
  'accented, upper-case queries match the same pages as unaccented ones'
);
select is(
  (select page_id from public.search_pages('quy trinh nghi ph') order by score desc limit 1),
  '20000000-0000-0000-0000-000000000001'::uuid,
  'the last word matches as a prefix while typing'
);
select is(
  (select count(*)::int from public.search_pages('nghi phep -quy')),
  1,
  '-word excludes pages containing the word (only the unaccented note remains)'
);
select is(
  (select match_in from public.search_pages('nguyen van phuong')),
  'table',
  'a match only in a table is reported as match_in = table'
);
select is(
  (select match_in from public.search_pages('chinh sach')),
  'heading',
  'a match in a heading is reported as match_in = heading'
);
select is(
  (select match_in from public.search_pages('quy trinh')),
  'title',
  'a match in the title is reported as match_in = title'
);

-- ---------------------------------------------------------------- ranking and snippets
select is(
  (select page_id from public.search_pages('nghỉ phép') order by score desc limit 1),
  '20000000-0000-0000-0000-000000000001'::uuid,
  'the page whose title and text match is ranked first'
);
select ok(
  (select score from public.search_pages('nghỉ phép') where page_id = '20000000-0000-0000-0000-000000000001')
  > (select score from public.search_pages('nghỉ phép') where page_id = '20000000-0000-0000-0000-000000000004'),
  'the correctly accented text ranks above the unaccented one for an accented query'
);
select ok(
  (select snippet from public.search_pages('nghi phep') where page_id = '20000000-0000-0000-0000-000000000001')
  like '%<mark>nghỉ</mark> <mark>phép</mark>%',
  'the snippet highlights the original accented words for an unaccented query'
);
select is(
  (select count(*)::int from public.search_pages('nghi phep', null, 1, 0)),
  1,
  'limit caps the number of results'
);

-- ---------------------------------------------------------------- trash, rate limit, anon
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
update public.pages set deleted_at = now() where id = '20000000-0000-0000-0000-000000000004';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is(
  (select count(*)::int from public.search_pages('nghi phep') where page_id = '20000000-0000-0000-0000-000000000004'),
  0,
  'trashed pages are not returned'
);

select is(
  (select count(*)::int from public.search_pages('   ')),
  0,
  'a blank query returns nothing'
);

select throws_ok(
  $$ select count(public.search_pages('nghi')) from generate_series(1, 100) $$,
  'P0001', 'RATE_LIMITED', 'more than 60 searches per minute are rate limited'
);

reset role;
set local role anon;
select throws_ok($$ select * from public.search_pages('nghi phep') $$, '42501', null,
  'anon cannot call search_pages');
reset role;

select * from finish();

rollback;
