-- Sanity checks of a restored database (kb-backup restore-test, docs/runbooks/backup-restore.md).
-- Run as the superuser on the RESTORED database:
--   psql "<url of the restored db>" -X -At -v ON_ERROR_STOP=1 -v min_pages=0 -f verify.sql
-- Any failed check raises RESTORE_CHECK_FAILED (psql exits non-zero). The last line printed is a
-- JSON summary with the row counts.

select set_config('kb.min_pages', :'min_pages', false) \g /dev/null

do $$
declare
  missing text;
  n bigint;
begin
  -- Core tables of every milestone so far (T1.1, T1.6a, T2.1, T3.3a) and Supabase's own.
  select string_agg(t, ', ') into missing
  from unnest(array[
    'auth.users', 'public.profiles', 'public.app_settings', 'public.access_allowlist',
    'public.spaces', 'public.space_members', 'public.invitations', 'public.audit_logs',
    'public.pages', 'public.page_documents'
  ]) as t
  where to_regclass(t) is null;
  if missing is not null then
    raise exception 'RESTORE_CHECK_FAILED: missing tables %', missing;
  end if;

  select count(*) into n from public.pages;
  if n < current_setting('kb.min_pages')::bigint then
    raise exception 'RESTORE_CHECK_FAILED: % pages, expected at least %', n, current_setting('kb.min_pages');
  end if;

  -- Every page has its Yjs document (trigger of T2.1).
  select count(*) into n
  from public.pages p left join public.page_documents d on d.page_id = p.id
  where d.page_id is null;
  if n > 0 then
    raise exception 'RESTORE_CHECK_FAILED: % pages without page_documents', n;
  end if;

  -- An update of an empty Y.Doc is 2 bytes; anything shorter is not a Yjs update.
  select count(*) into n from public.page_documents where ydoc is null or length(ydoc) < 2;
  if n > 0 then
    raise exception 'RESTORE_CHECK_FAILED: % page_documents with an invalid ydoc', n;
  end if;

  -- The restore kept security: RLS on every public table (AGENTS.md §4), kb_collab's grants.
  select string_agg(c.relname, ', ') into missing
  from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if missing is not null then
    raise exception 'RESTORE_CHECK_FAILED: RLS disabled on %', missing;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'kb_collab')
     or not has_any_column_privilege('kb_collab', 'public.page_documents', 'update') then
    raise exception 'RESTORE_CHECK_FAILED: role kb_collab or its grants are missing';
  end if;

  -- Profiles reference auth.users: users and their profiles came back together.
  select count(*) into n from public.profiles p left join auth.users u on u.id = p.id where u.id is null;
  if n > 0 then
    raise exception 'RESTORE_CHECK_FAILED: % profiles without auth.users', n;
  end if;
end
$$;

-- Newest applied migration (supabase_migrations exists wherever kb-migrate ran).
select to_regclass('supabase_migrations.schema_migrations') is not null as has_migrations \gset
\if :has_migrations
select coalesce(max(version), '') as latest_migration from supabase_migrations.schema_migrations \gset
\else
\set latest_migration ''
\endif

select json_build_object(
  'auth_users', (select count(*) from auth.users),
  'profiles', (select count(*) from public.profiles),
  'spaces', (select count(*) from public.spaces),
  'pages', (select count(*) from public.pages),
  'page_documents', (select count(*) from public.page_documents),
  'audit_logs', (select count(*) from public.audit_logs),
  'last_audit_at', (select max(occurred_at) from public.audit_logs),
  'latest_migration', nullif(:'latest_migration', '')
);
