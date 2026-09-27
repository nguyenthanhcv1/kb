-- Page version history (docs/PLAN.md §3.2 `page_versions`, §3.5, §3.6, task T6.1a).
--
-- Snapshots are written only by kb-collab (role `kb_collab`): `auto` / `manual` by the snapshot
-- policy (T6.1b), `pre_restore` / `restore` by the restore flow (T6.3a). Clients read the list and
-- the derived `content_json`; the Yjs update (`ydoc_update`) stays server-side like
-- `page_documents.ydoc`. Rows are immutable: no UPDATE/DELETE for any client role; only the
-- retention job (`app.prune_page_versions`) and the page purge cascade remove rows.

create type public.version_reason as enum ('auto', 'manual', 'pre_restore', 'restore');

create table public.page_versions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages (id) on delete cascade,
  -- Assigned by the before-insert trigger (max + 1 under a lock on the page row).
  version_no integer not null check (version_no > 0),
  title text not null default '',
  ydoc_update bytea not null,
  content_json jsonb not null,
  content_text text not null default '',
  schema_version integer not null check (schema_version > 0),
  reason public.version_reason not null,
  label text check (label is null or (reason = 'manual' and char_length(label) between 1 and 200)),
  restored_from_version_id uuid references public.page_versions (id) on delete set null,
  -- Defaults to app.actor_id() in the before-insert trigger (kb-collab sets app.actor_id).
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (page_id, version_no),
  check (restored_from_version_id is null or reason = 'restore')
);

comment on table public.page_versions is
  'Immutable snapshots of a page (Yjs update + derived JSON/text). Written only by kb-collab.';
comment on column public.page_versions.ydoc_update is
  'Y.encodeStateAsUpdate(doc) at snapshot time. Never readable by authenticated (column privilege).';
comment on column public.page_versions.label is
  'Name given by the user to a manual version.';

create index page_versions_page_created_idx on public.page_versions (page_id, created_at desc);
create index page_versions_restored_from_idx on public.page_versions (restored_from_version_id)
  where restored_from_version_id is not null;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Numbers versions per page and fills defaults from the page. The page row lock serialises
-- concurrent snapshots of the same page, so `version_no` never collides.
create or replace function app.page_versions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
begin
  select pg.title into v_title from public.pages as pg where pg.id = new.page_id for update;
  if not found then
    raise exception 'PAGE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if new.restored_from_version_id is not null and not exists (
    select 1 from public.page_versions as v
    where v.id = new.restored_from_version_id and v.page_id = new.page_id
  ) then
    raise exception 'VERSION_NOT_FOUND' using errcode = 'P0002';
  end if;

  new.version_no := coalesce(
    (select max(v.version_no) from public.page_versions as v where v.page_id = new.page_id), 0
  ) + 1;
  new.title := coalesce(nullif(new.title, ''), v_title, '');
  new.created_by := coalesce(new.created_by, app.actor_id());
  return new;
end;
$$;

create or replace function app.audit_page_versions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reason = 'restore' then
    perform app.write_audit('version.restore', 'version', new.id,
      (select pg.space_id from public.pages as pg where pg.id = new.page_id),
      jsonb_build_object('page_id', new.page_id, 'title', new.title, 'version_no', new.version_no,
                         'restored_from_version_id', new.restored_from_version_id,
                         'restored_from_version_no',
                           (select v.version_no from public.page_versions as v
                            where v.id = new.restored_from_version_id)));
  end if;
  return new;
end;
$$;

create trigger page_versions_before_insert
before insert on public.page_versions
for each row execute function app.page_versions_before_insert();

create trigger page_versions_0_audit
after insert on public.page_versions
for each row execute function app.audit_page_versions();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.page_versions enable row level security;

create policy page_versions_select on public.page_versions
for select to authenticated
using (app.page_role(page_id) is not null);

create policy page_versions_kb_collab_select on public.page_versions
for select to kb_collab using (true);

create policy page_versions_kb_collab_insert on public.page_versions
for insert to kb_collab with check (true);

-- No UPDATE/DELETE policy for anyone: versions are immutable.

revoke all on public.page_versions from anon, authenticated, service_role, kb_collab;

-- ydoc_update is deliberately missing: clients preview content_json, never the Yjs state.
grant select (id, page_id, version_no, title, content_json, content_text, schema_version, reason,
              label, restored_from_version_id, created_by, created_at)
  on public.page_versions to authenticated;

-- kb-collab reads versions back for restore (T6.3a) and writes new snapshots.
grant select on public.page_versions to kb_collab;
grant insert (id, page_id, title, ydoc_update, content_json, content_text, schema_version, reason, label,
              restored_from_version_id, created_by)
  on public.page_versions to kb_collab;

-- ---------------------------------------------------------------------------
-- Retention (§3.2): keep every manual / restore / pre_restore version and every auto version of
-- the last 30 days; older auto versions thin out to the latest one per page and local day
-- (Asia/Ho_Chi_Minh). Versions a restore points back to are kept.
-- ---------------------------------------------------------------------------

create or replace function app.prune_page_versions(
  p_now timestamptz default now(),
  p_keep_all interval default interval '30 days',
  p_time_zone text default 'Asia/Ho_Chi_Minh'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  with ranked as (
    select v.id,
           row_number() over (
             partition by v.page_id, (v.created_at at time zone p_time_zone)::date
             order by v.created_at desc, v.version_no desc
           ) as rn
    from public.page_versions as v
    where v.reason = 'auto'
      and v.created_at < p_now - p_keep_all
  )
  delete from public.page_versions as v
  using ranked as r
  where v.id = r.id
    and r.rn > 1
    and not exists (
      select 1 from public.page_versions as ref where ref.restored_from_version_id = v.id
    );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function app.prune_page_versions(timestamptz, interval, text) is
  'Nightly retention of page_versions: thins auto versions older than p_keep_all to one per page and local day. Returns rows deleted.';

revoke all on function app.page_versions_before_insert() from public;
revoke all on function app.audit_page_versions() from public;
revoke all on function app.prune_page_versions(timestamptz, interval, text) from public;
-- Scheduled nightly by kb-collab (apps/collab/src/retention.ts) — no pg_cron: its jobs only run in
-- the `cron.database_name` database, which breaks restoring a backup into another database (T0.9 drill).
grant execute on function app.prune_page_versions(timestamptz, interval, text) to kb_collab, service_role;
