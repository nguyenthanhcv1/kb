-- Page tree (docs/PLAN.md §3.2 `pages`, `page_documents`, §3.4, §3.5, task T2.1).
--
--   * `pages`: one row per page. Ordering among siblings is a fractional index (`position`,
--     collate "C") so a drag-and-drop move rewrites a single row.
--   * Tree invariants live in triggers, not in application code: parent in the same Space, no
--     cycles, no live page under a trashed parent, trashing/restoring/moving a page applies to its
--     whole subtree, purge only from the trash.
--   * `page_documents`: 1–1 with `pages`, inserted empty by trigger when the page is created so
--     page creation never depends on kb-collab. T3.3a adds the `kb_collab` role and its grants.
--   * Permission seam for V2: policies go through `app.page_role()` (by page id) or, on pages
--     itself, `app.page_row_role()` (by row, so INSERT … RETURNING works).
--   * Audit: page.create / page.update_title / page.move / page.delete /
--     page.restore_from_trash / page.purge — one row for the page the user acted on, none for
--     descendants touched by a cascade.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto with schema extensions;

-- 8-character base62 id used in page URLs (`/s/<space>/p/<slug>-<short_id>`).
create or replace function app.generate_short_id()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(
    substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', (get_byte(b.bytes, i) % 62) + 1, 1),
    '' order by i
  )
  from (select extensions.gen_random_bytes(8) as bytes) as b,
       generate_series(0, 7) as i
$$;

-- URL slug from a title: Vietnamese diacritics removed (đ → d), lowercase, `[a-z0-9-]`, ≤ 80 chars.
-- Only cosmetic — pages are looked up by short_id.
create or replace function app.slugify(p_text text)
returns text
language sql
stable
set search_path = ''
as $$
  select left(
    btrim(
      regexp_replace(
        lower(extensions.unaccent(replace(replace(coalesce(p_text, ''), 'đ', 'd'), 'Đ', 'D'))),
        '[^a-z0-9]+', '-', 'g'
      ),
      '-'
    ),
    80
  )
$$;

-- True while a trigger cascades a change down a subtree; per-row guards and audit skip then.
create or replace function app.in_page_cascade()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('app.page_cascade', true), '') = 'on'
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete restrict,
  parent_id uuid references public.pages (id) on delete restrict,
  position text collate "C" not null check (position ~ '^[0-9A-Za-z]+$'),
  title text not null default '',
  slug text not null default '',
  short_id text not null unique default app.generate_short_id()
    check (short_id ~ '^[0-9A-Za-z]{8}$'),
  icon text,
  cover_url text,
  owner_id uuid references public.profiles (id) on delete set null,
  inherit_permissions boolean not null default true,
  is_template boolean not null default false,
  template_locale text check (template_locale in ('vi', 'en')),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  last_edited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_edited_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null,
  check (parent_id is distinct from id),
  check (deleted_by is null or deleted_at is not null)
);

comment on table public.pages is
  'Page tree of a Space. Content lives in page_documents (Yjs is the source of truth).';
comment on column public.pages.position is
  'Fractional index (fractional-indexing) among siblings; compare with collate "C".';

create index pages_tree_idx on public.pages (space_id, parent_id, position) where deleted_at is null;
create index pages_parent_id_idx on public.pages (parent_id);
create index pages_space_last_edited_idx on public.pages (space_id, last_edited_at desc);
create index pages_trash_idx on public.pages (space_id) where deleted_at is not null;

create table public.page_documents (
  page_id uuid primary key references public.pages (id) on delete cascade,
  -- Y.encodeStateAsUpdate(new Y.Doc()) = [0, 0]
  ydoc bytea not null default '\x0000'::bytea,
  schema_version integer not null default 1 check (schema_version > 0),
  content_json jsonb not null default '{"type": "doc", "content": []}'::jsonb,
  content_text text not null default '',
  headings_text text not null default '',
  table_text text not null default '',
  word_count integer not null default 0 check (word_count >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.page_documents is
  'Yjs document of a page (ydoc = source of truth) plus derived JSON/text. Written only by kb-collab.';
comment on column public.page_documents.ydoc is
  'Y.encodeStateAsUpdate(doc). Never readable by authenticated (column privilege).';

-- ---------------------------------------------------------------------------
-- Permission helpers (single place for access logic, see §3.4)
-- ---------------------------------------------------------------------------

-- Effective role of any user in a Space. `app.space_role()` is this for the current user;
-- `app.authorize_document()` uses it for the user kb-collab is authenticating.
create or replace function app.user_space_role(p_space_id uuid, p_user_id uuid)
returns public.space_role
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p.is_super_admin then 'admin'::public.space_role
    when m.role is not null then m.role
    when s.visibility = 'internal' and not p.is_guest then 'viewer'::public.space_role
    else null
  end
  from public.profiles as p
  join public.spaces as s on s.id = p_space_id and s.archived_at is null
  left join public.space_members as m on m.space_id = s.id and m.user_id = p.id
  where p.id = p_user_id
    and p.deactivated_at is null
$$;

create or replace function app.space_role(p_space_id uuid)
returns public.space_role
language sql
stable
security definer
set search_path = ''
as $$
  select app.user_space_role(p_space_id, (select auth.uid()))
$$;

-- Role of a user on a page. MVP: the Space role; a trashed page is only reachable by editors
-- and admins of its Space. V2 (page permissions) changes only this function.
create or replace function app.user_page_role(p_page_id uuid, p_user_id uuid)
returns public.space_role
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when pg.deleted_at is null then r.role
    when r.role in ('editor'::public.space_role, 'admin'::public.space_role) then r.role
    else null
  end
  from public.pages as pg
  cross join lateral (select app.user_space_role(pg.space_id, p_user_id) as role) as r
  where pg.id = p_page_id
$$;

create or replace function app.page_role(p_page_id uuid)
returns public.space_role
language sql
stable
security definer
set search_path = ''
as $$
  select app.user_page_role(p_page_id, (select auth.uid()))
$$;

comment on function app.page_role(uuid) is
  'Role of the current user on a page. MVP = Space role (trashed pages: editors/admins only).';

-- Same decision from a pages row, for the pages policies themselves: a row being inserted is
-- not yet visible to a lookup by id (INSERT … RETURNING would fail the SELECT policy).
-- V2 (page permissions) changes this together with user_page_role.
create or replace function app.page_row_role(p_space_id uuid, p_page_id uuid)
returns public.space_role
language sql
stable
security definer
set search_path = ''
as $$
  select app.user_space_role(p_space_id, (select auth.uid()))
$$;

comment on function app.page_row_role(uuid, uuid) is
  'Role of the current user on a pages row (space_id, id) — used by the pages RLS policies.';

-- For kb-collab: role of the connecting user on a live page (null = reject the connection).
create or replace function app.authorize_document(p_page_id uuid, p_user_id uuid)
returns public.space_role
language sql
stable
security definer
set search_path = ''
as $$
  select app.user_page_role(pg.id, p_user_id)
  from public.pages as pg
  where pg.id = p_page_id
    and pg.deleted_at is null
$$;

comment on function app.authorize_document(uuid, uuid) is
  'kb-collab connection check: role of p_user_id on a live page, null when not allowed. T3.3a grants it to kb_collab.';

-- ---------------------------------------------------------------------------
-- Tree triggers
-- ---------------------------------------------------------------------------

create or replace function app.pages_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.pages%rowtype;
begin
  if tg_op = 'INSERT' or new.title is distinct from old.title then
    new.slug := app.slugify(new.title);
  end if;

  if tg_op = 'INSERT' then
    new.owner_id := coalesce(new.owner_id, new.created_by);
    new.last_edited_by := coalesce(new.last_edited_by, new.created_by);
    new.deleted_at := null;
    new.deleted_by := null;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.short_id := old.short_id;

    if new.deleted_at is null then
      new.deleted_by := null;
    elsif old.deleted_at is null then
      new.deleted_by := coalesce(new.deleted_by, app.actor_id());
    end if;
  end if;

  if app.in_page_cascade() then
    return new;
  end if;

  if new.parent_id is not null
     and (tg_op = 'INSERT'
          or new.parent_id is distinct from old.parent_id
          or new.space_id is distinct from old.space_id
          or (old.deleted_at is not null and new.deleted_at is null)) then
    select * into v_parent from public.pages where id = new.parent_id;

    if not found then
      raise exception 'PAGE_PARENT_NOT_FOUND' using errcode = '23503';
    end if;
    if v_parent.space_id <> new.space_id then
      raise exception 'PAGE_PARENT_SPACE_MISMATCH' using errcode = '23514';
    end if;
    if v_parent.deleted_at is not null and new.deleted_at is null then
      raise exception 'PAGE_PARENT_DELETED' using errcode = '23514';
    end if;

    if tg_op = 'UPDATE' and exists (
      with recursive ancestors as (
        select id, parent_id from public.pages where id = new.parent_id
        union
        select p.id, p.parent_id
        from public.pages as p
        join ancestors as a on p.id = a.parent_id
      )
      select 1 from ancestors where id = new.id
    ) then
      raise exception 'PAGE_MOVE_CYCLE' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.space_id is distinct from old.space_id and new.deleted_at is not null then
    raise exception 'PAGE_DELETED' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Apply trash / restore / Space change to the whole subtree, then create the empty document.
create or replace function app.pages_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_cascade boolean := app.in_page_cascade();
begin
  if tg_op = 'INSERT' then
    insert into public.page_documents (page_id) values (new.id);
    return new;
  end if;

  if (old.deleted_at is null and new.deleted_at is not null)
     or (old.deleted_at is not null and new.deleted_at is null)
     or new.space_id is distinct from old.space_id then
    perform set_config('app.page_cascade', 'on', true);

    if old.deleted_at is null and new.deleted_at is not null then
      -- Trash: every live descendant gets the same deleted_at, so the branch restores together.
      update public.pages
      set deleted_at = new.deleted_at, deleted_by = new.deleted_by
      where parent_id = new.id and deleted_at is null;
    elsif old.deleted_at is not null and new.deleted_at is null then
      -- Restore: only descendants trashed together with this page.
      update public.pages
      set deleted_at = null
      where parent_id = new.id and deleted_at = old.deleted_at;
    end if;

    if new.space_id is distinct from old.space_id then
      update public.pages set space_id = new.space_id where parent_id = new.id;
    end if;

    if not v_was_cascade then
      perform set_config('app.page_cascade', '', true);
    end if;
  end if;

  return new;
end;
$$;

-- Purge: only from the trash; children are purged before their parent (FK is RESTRICT).
create or replace function app.pages_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_cascade boolean := app.in_page_cascade();
begin
  if not v_was_cascade and old.deleted_at is null then
    raise exception 'PAGE_NOT_IN_TRASH' using errcode = '23514';
  end if;

  perform set_config('app.page_cascade', 'on', true);
  delete from public.pages where parent_id = old.id;
  if not v_was_cascade then
    perform set_config('app.page_cascade', '', true);
  end if;

  return old;
end;
$$;

create or replace function app.audit_pages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.in_page_cascade() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    perform app.write_audit('page.create', 'page', new.id, new.space_id,
      jsonb_build_object('title', new.title, 'parent_id', new.parent_id));
    return new;
  elsif tg_op = 'DELETE' then
    perform app.write_audit('page.purge', 'page', old.id, old.space_id,
      jsonb_build_object('title', old.title, 'parent_id', old.parent_id));
    return old;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    perform app.write_audit('page.delete', 'page', new.id, new.space_id,
      jsonb_build_object('title', new.title, 'parent_id', new.parent_id));
  elsif old.deleted_at is not null and new.deleted_at is null then
    perform app.write_audit('page.restore_from_trash', 'page', new.id, new.space_id,
      jsonb_build_object('title', new.title, 'parent_id', new.parent_id));
  end if;

  if new.title is distinct from old.title then
    perform app.write_audit('page.update_title', 'page', new.id, new.space_id,
      jsonb_build_object('from', old.title, 'to', new.title));
  end if;

  if (new.parent_id, new.position, new.space_id) is distinct from (old.parent_id, old.position, old.space_id) then
    perform app.write_audit('page.move', 'page', new.id, new.space_id,
      jsonb_build_object('title', new.title,
                         'from_parent', old.parent_id, 'to_parent', new.parent_id,
                         'from_space', old.space_id, 'to_space', new.space_id));
  end if;

  return new;
end;
$$;

create trigger pages_before_write
before insert or update on public.pages
for each row execute function app.pages_before_write();

create trigger pages_touch_updated_at
before update on public.pages
for each row execute function app.touch_updated_at();

-- Audit first (same-event triggers fire in name order) so page.create precedes cascades.
create trigger pages_0_audit
after insert or update or delete on public.pages
for each row execute function app.audit_pages();

create trigger pages_after_write
after insert or update on public.pages
for each row execute function app.pages_after_write();

create trigger pages_before_delete
before delete on public.pages
for each row execute function app.pages_before_delete();

create trigger page_documents_touch_updated_at
before update on public.page_documents
for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.pages enable row level security;
alter table public.page_documents enable row level security;

create policy pages_select on public.pages
for select to authenticated
using (
  (deleted_at is null and app.page_row_role(space_id, id) is not null)
  or (deleted_at is not null and app.can_edit_space(space_id))
);

create policy pages_insert on public.pages
for insert to authenticated
with check (app.can_edit_space(space_id) and created_by = (select auth.uid()));

-- Moving to another Space needs edit rights on both (USING = old row, WITH CHECK = new row).
create policy pages_update on public.pages
for update to authenticated
using (app.can_edit_space(space_id))
with check (app.can_edit_space(space_id));

create policy pages_delete on public.pages
for delete to authenticated
using (app.is_space_admin(space_id));

create policy page_documents_select on public.page_documents
for select to authenticated
using (app.page_role(page_id) is not null);

-- No INSERT/UPDATE/DELETE policy for clients: the empty row comes from the pages trigger,
-- content is written by kb-collab (T3.3a), rows go away with the page (cascade).

revoke all on public.pages, public.page_documents from anon, authenticated;

grant select on public.pages to authenticated;
grant insert (id, space_id, parent_id, position, title, icon, cover_url, owner_id, created_by)
  on public.pages to authenticated;
grant update (space_id, parent_id, position, title, icon, cover_url, owner_id, deleted_at)
  on public.pages to authenticated;
grant delete on public.pages to authenticated;

-- ydoc is deliberately missing: clients read content_json, never the Yjs state.
grant select (page_id, schema_version, content_json, content_text, headings_text, table_text,
              word_count, updated_at)
  on public.page_documents to authenticated;

revoke all on function app.generate_short_id() from public;
revoke all on function app.slugify(text) from public;
revoke all on function app.in_page_cascade() from public;
revoke all on function app.user_space_role(uuid, uuid) from public;
revoke all on function app.user_page_role(uuid, uuid) from public;
revoke all on function app.page_row_role(uuid, uuid) from public;
revoke all on function app.pages_before_write() from public;
revoke all on function app.pages_after_write() from public;
revoke all on function app.pages_before_delete() from public;
revoke all on function app.audit_pages() from public;

grant execute on function app.generate_short_id() to authenticated, service_role;
grant execute on function app.slugify(text) to authenticated, service_role;
grant execute on function app.in_page_cascade() to authenticated, service_role;
grant execute on function app.user_space_role(uuid, uuid) to service_role;
grant execute on function app.user_page_role(uuid, uuid) to service_role;
grant execute on function app.page_row_role(uuid, uuid) to authenticated, service_role;
