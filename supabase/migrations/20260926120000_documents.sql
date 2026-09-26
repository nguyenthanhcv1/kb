-- Document storage access for kb-collab (docs/PLAN.md §3.2 `page_documents`, §3.5, §7.10, task T3.3a).
--
-- `page_documents` itself exists since T2.1 (empty row per page, `ydoc` hidden from clients).
-- This migration adds the one writer of page content: the Postgres role `kb_collab`, used only
-- by the kb-collab service over the internal network. RLS stays on; the role gets exactly the
-- columns and functions the persistence path needs and nothing else (no profiles, no spaces).
--
-- The role is created without a password: it cannot log in until the deploy sets one
-- (`alter role kb_collab password …`, runbook T0.8). Local development sets it in seed.sql.

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'kb_collab') then
    create role kb_collab login nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication
      connection limit 50;
  end if;
end;
$$;

comment on role kb_collab is 'kb-collab service: reads/writes page_documents, bumps pages.last_edited_*. RLS applies.';

-- Lets the migration owner (and pgTAP) `set role kb_collab`; grants nothing to kb_collab.
grant kb_collab to postgres;

-- Nothing is readable by default: PostgREST roles get their grants per table, kb_collab too.
grant usage on schema public, app to kb_collab;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

grant select (id, space_id, parent_id, title, deleted_at, last_edited_at, last_edited_by) on public.pages to kb_collab;
grant update (last_edited_at, last_edited_by) on public.pages to kb_collab;

grant select on public.page_documents to kb_collab;
grant update (ydoc, schema_version, content_json, content_text, headings_text, table_text, word_count)
  on public.page_documents to kb_collab;

create policy pages_kb_collab_select on public.pages
for select to kb_collab using (true);

create policy pages_kb_collab_update on public.pages
for update to kb_collab using (true) with check (true);

create policy page_documents_kb_collab_select on public.page_documents
for select to kb_collab using (true);

create policy page_documents_kb_collab_update on public.page_documents
for update to kb_collab using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Audit of content edits: at most one `page.update_content` row per editor, page and 10 minutes.
-- kb-collab calls this after each successful store instead of inserting into audit_logs.
-- ---------------------------------------------------------------------------

create or replace function app.record_content_edit(p_page_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space_id uuid;
begin
  select space_id into v_space_id from public.pages where id = p_page_id;
  if v_space_id is null then
    raise exception 'PAGE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.audit_logs
    where entity_id = p_page_id
      and action = 'page.update_content'
      and actor_id is not distinct from p_user_id
      and occurred_at > now() - interval '10 minutes'
  ) then
    return false;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, space_id, metadata, request_id)
  values (p_user_id, 'page.update_content', 'page', p_page_id, v_space_id, '{}'::jsonb, app.request_id());
  return true;
end;
$$;

comment on function app.record_content_edit(uuid, uuid) is
  'Audit page.update_content for kb-collab, coalesced to one row per user/page/10 minutes. Returns true when a row was written.';

revoke all on function app.record_content_edit(uuid, uuid) from public;
grant execute on function app.record_content_edit(uuid, uuid) to kb_collab, service_role;

-- Connection check (implemented in T2.1) and the actor/request helpers used by triggers.
grant execute on function app.authorize_document(uuid, uuid) to kb_collab;
grant execute on function app.actor_id() to kb_collab;
grant execute on function app.request_id() to kb_collab;
grant execute on function app.in_page_cascade() to kb_collab;
