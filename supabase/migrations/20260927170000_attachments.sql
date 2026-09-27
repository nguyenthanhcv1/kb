-- Page attachments (docs/PLAN.md §3.2 `attachments`, §3.5, task T3.6a).
--
--   * Storage bucket `attachments`: private, 25 MB per file, MIME whitelist (no SVG/HTML: they
--     can run script when opened). Files are served only through short-lived signed URLs.
--   * `attachments`: one row per file, declared by an editor BEFORE the upload. The object key
--     is `<space_id>/<page_id>/<uuid>-<file name>`; the row is what grants access to the object,
--     so a page moved to another Space keeps its files readable by the new Space's members.
--   * Access to an object = access to the page of its (non-deleted) row: one helper,
--     `app.attachment_object_role(name)`, used by every storage.objects policy (V2 page
--     permissions change `app.user_page_role`, not these policies).
--   * Deleting an attachment is soft (`deleted_at`) — the file stays until a cleanup job
--     (later task) removes objects of deleted rows and purged pages.

-- ---------------------------------------------------------------------------
-- Bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  26214400,
  array[
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
    'application/pdf',
    'text/plain', 'text/csv', 'text/markdown',
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete restrict,
  page_id uuid not null references public.pages (id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (char_length(mime_type) between 3 and 255),
  size_bytes bigint not null check (size_bytes between 1 and 26214400),
  width integer check (width > 0),
  height integer check (height > 0),
  uploaded_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null,
  check (deleted_by is null or deleted_at is not null),
  -- `<space_id at upload>/<page_id>/<uuid>-<name>`; the Space part is kept when the page moves.
  check (storage_path ~ ('^[0-9a-f-]{36}/' || page_id::text || '/[0-9a-f-]{36}-[^/]+$'))
);

comment on table public.attachments is
  'Files of a page in the private storage bucket `attachments`. The row grants access to the object.';
comment on column public.attachments.storage_path is
  'Object key in bucket attachments: <space_id>/<page_id>/<uuid>-<file name>.';

create index attachments_page_id_idx on public.attachments (page_id) where deleted_at is null;
create index attachments_space_id_idx on public.attachments (space_id);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Space always follows the page; identity columns never change after insert.
create or replace function app.attachments_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space_id uuid;
  v_deleted_at timestamptz;
begin
  if tg_op = 'INSERT' then
    select space_id, deleted_at into v_space_id, v_deleted_at
    from public.pages where id = new.page_id;
    if not found then
      raise exception 'PAGE_NOT_FOUND' using errcode = '23503';
    end if;
    if v_deleted_at is not null then
      raise exception 'PAGE_DELETED' using errcode = '23514';
    end if;
    if new.storage_path not like v_space_id::text || '/' || new.page_id::text || '/%' then
      raise exception 'ATTACHMENT_PATH_INVALID' using errcode = '23514';
    end if;
    new.space_id := v_space_id;
    new.created_at := now();
    new.deleted_at := null;
    new.deleted_by := null;
  else
    new.id := old.id;
    new.page_id := old.page_id;
    new.storage_path := old.storage_path;
    new.uploaded_by := old.uploaded_by;
    new.created_at := old.created_at;
    if new.deleted_at is null then
      new.deleted_by := null;
    elsif old.deleted_at is null then
      new.deleted_by := coalesce(new.deleted_by, app.actor_id());
    end if;
  end if;
  return new;
end;
$$;

create trigger attachments_before_write
before insert or update on public.attachments
for each row execute function app.attachments_before_write();

-- A page moved to another Space (the pages trigger cascades to its subtree) takes its files along.
create or replace function app.attachments_follow_page_space()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.attachments set space_id = new.space_id where page_id = new.id;
  return new;
end;
$$;

create trigger pages_attachments_space
after update of space_id on public.pages
for each row
when (new.space_id is distinct from old.space_id)
execute function app.attachments_follow_page_space();

-- ---------------------------------------------------------------------------
-- Permission helper for storage.objects
-- ---------------------------------------------------------------------------

-- Role of the current user on the page owning object `p_name` of bucket attachments
-- (null = no access). Deleted attachments grant nothing.
create or replace function app.attachment_object_role(p_name text)
returns public.space_role
language sql
stable
security definer
set search_path = ''
as $$
  select app.page_role(a.page_id)
  from public.attachments as a
  where a.storage_path = p_name
    and a.deleted_at is null
$$;

comment on function app.attachment_object_role(text) is
  'Role of the current user on the page of attachment object p_name (bucket attachments), null = none.';

-- True when the current user declared `p_name` (upload only goes to a path declared by its uploader).
create or replace function app.can_upload_attachment_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.attachments as a
    where a.storage_path = p_name
      and a.deleted_at is null
      and a.uploaded_by = (select auth.uid())
      and app.page_role(a.page_id) in ('editor'::public.space_role, 'admin'::public.space_role)
  )
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.attachments enable row level security;

create policy attachments_select on public.attachments
for select to authenticated
using (app.page_role(page_id) is not null);

create policy attachments_insert on public.attachments
for insert to authenticated
with check (
  app.page_role(page_id) in ('editor'::public.space_role, 'admin'::public.space_role)
  and uploaded_by = (select auth.uid())
);

-- Soft delete / restore by editors (only `deleted_at` is granted).
create policy attachments_update on public.attachments
for update to authenticated
using (app.page_role(page_id) in ('editor'::public.space_role, 'admin'::public.space_role))
with check (app.page_role(page_id) in ('editor'::public.space_role, 'admin'::public.space_role));

revoke all on public.attachments from anon, authenticated;
grant select on public.attachments to authenticated;
grant insert (id, page_id, storage_path, file_name, mime_type, size_bytes, width, height, uploaded_by)
  on public.attachments to authenticated;
grant update (deleted_at) on public.attachments to authenticated;

-- Objects: read = can view the page; write = the editor who declared the row; no overwrite
-- (no UPDATE policy — every upload gets a fresh key); delete = editors of the page.
create policy attachments_objects_select on storage.objects
for select to authenticated
using (bucket_id = 'attachments' and app.attachment_object_role(name) is not null);

create policy attachments_objects_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'attachments' and app.can_upload_attachment_object(name));

create policy attachments_objects_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'attachments'
  and app.attachment_object_role(name) in ('editor'::public.space_role, 'admin'::public.space_role)
);

revoke all on function app.attachments_before_write() from public;
revoke all on function app.attachments_follow_page_space() from public;
revoke all on function app.attachment_object_role(text) from public;
revoke all on function app.can_upload_attachment_object(text) from public;

grant execute on function app.attachment_object_role(text) to authenticated, service_role;
grant execute on function app.can_upload_attachment_object(text) to authenticated, service_role;
