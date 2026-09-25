-- Audit log (docs/PLAN.md §3.2 `audit_logs`, §3.5, task T1.6a).
-- Rows are written only by SECURITY DEFINER triggers (and later by kb-collab for
-- `page.update_content`). Nobody can update or delete them except a superuser.

create table public.audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  action text not null check (action ~ '^[a-z]+(_[a-z]+)*\.[a-z]+(_[a-z]+)*$'),
  entity_type text not null check (entity_type ~ '^[a-z]+(_[a-z]+)*$'),
  entity_id uuid,
  space_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  request_id text
);

comment on table public.audit_logs is
  'Insert-only audit trail. Soft references (no FK) so history survives deleted entities.';

create index audit_logs_space_occurred_idx on public.audit_logs (space_id, occurred_at desc, id desc);
create index audit_logs_entity_occurred_idx on public.audit_logs (entity_id, occurred_at desc);
create index audit_logs_actor_occurred_idx on public.audit_logs (actor_id, occurred_at desc);
create index audit_logs_occurred_idx on public.audit_logs (occurred_at desc, id desc);

alter table public.audit_logs enable row level security;

create policy audit_logs_select on public.audit_logs
for select to authenticated
using (app.is_super_admin() or (space_id is not null and app.is_space_admin(space_id)));

-- No INSERT/UPDATE/DELETE policy and no write grant: clients can only read.
revoke all on public.audit_logs from anon, authenticated, service_role;
grant select on public.audit_logs to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Actor and request context
-- ---------------------------------------------------------------------------

-- Who performed the current statement: the JWT user, else the `app.actor_id`
-- setting that server jobs / kb-collab set with `set_config('app.actor_id', …, true)`.
create or replace function app.actor_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select auth.uid()),
    case
      when current_setting('app.actor_id', true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then current_setting('app.actor_id', true)::uuid
    end
  )
$$;

comment on function app.actor_id() is
  'auth.uid(), falling back to the transaction-local app.actor_id setting (server jobs, kb-collab).';

-- Trace id: `app.request_id` setting, else the `x-request-id` header forwarded by PostgREST.
create or replace function app.request_id()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('app.request_id', true), ''),
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-request-id'
  )
$$;

create or replace function app.write_audit(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_space_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, space_id, metadata, request_id)
  values (app.actor_id(), p_action, p_entity_type, p_entity_id, p_space_id,
          coalesce(p_metadata, '{}'::jsonb), app.request_id())
$$;

-- `{"<column>": {"from": …, "to": …}}` for the listed columns whose value changed.
create or replace function app.audit_changes(p_old jsonb, p_new jsonb, p_columns text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(c, jsonb_build_object('from', p_old -> c, 'to', p_new -> c)),
    '{}'::jsonb
  )
  from unnest(p_columns) as c
  where (p_old -> c) is distinct from (p_new -> c)
$$;

revoke all on function app.actor_id() from public;
revoke all on function app.request_id() from public;
revoke all on function app.write_audit(text, text, uuid, uuid, jsonb) from public;
revoke all on function app.audit_changes(jsonb, jsonb, text[]) from public;
grant execute on function app.actor_id() to authenticated, service_role;
grant execute on function app.request_id() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Immutability: even roles that bypass RLS (service_role) cannot rewrite history.
-- ---------------------------------------------------------------------------

create or replace function app.audit_logs_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = current_user and rolsuper) then
    raise exception 'AUDIT_LOG_IMMUTABLE' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger audit_logs_immutable_row
before update or delete on public.audit_logs
for each row execute function app.audit_logs_immutable();

create trigger audit_logs_immutable_truncate
before truncate on public.audit_logs
for each statement execute function app.audit_logs_immutable();

-- ---------------------------------------------------------------------------
-- Audit triggers (app.audit_*)
-- ---------------------------------------------------------------------------

create or replace function app.audit_spaces()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb;
begin
  if tg_op = 'INSERT' then
    perform app.write_audit('space.create', 'space', new.id, new.id,
      jsonb_build_object('name', new.name, 'slug', new.slug, 'visibility', new.visibility));
    return new;
  end if;

  if old.archived_at is null and new.archived_at is not null then
    perform app.write_audit('space.archive', 'space', new.id, new.id, jsonb_build_object('name', new.name));
  elsif old.archived_at is not null and new.archived_at is null then
    perform app.write_audit('space.unarchive', 'space', new.id, new.id, jsonb_build_object('name', new.name));
  end if;

  v_changes := app.audit_changes(to_jsonb(old), to_jsonb(new),
    array['slug', 'name', 'description', 'icon', 'visibility', 'ai_enabled']);
  if v_changes <> '{}'::jsonb then
    perform app.write_audit('space.update', 'space', new.id, new.id, jsonb_build_object('changes', v_changes));
  end if;
  return new;
end;
$$;

create or replace function app.audit_space_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.write_audit('member.add', 'member', new.user_id, new.space_id,
      jsonb_build_object('user_id', new.user_id, 'role', new.role));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      perform app.write_audit('member.role_change', 'member', new.user_id, new.space_id,
        jsonb_build_object('user_id', new.user_id, 'from_role', old.role, 'to_role', new.role));
    end if;
    return new;
  else
    perform app.write_audit('member.remove', 'member', old.user_id, old.space_id,
      jsonb_build_object('user_id', old.user_id, 'role', old.role,
                         'self', old.user_id = app.actor_id()));
    return old;
  end if;
end;
$$;

create or replace function app.audit_invitations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- token_hash is never copied into the audit trail.
  if tg_op = 'INSERT' then
    perform app.write_audit('invitation.create', 'invitation', new.id, new.space_id,
      jsonb_build_object('email', new.email, 'role', new.role, 'expires_at', new.expires_at));
    return new;
  end if;

  if old.revoked_at is null and new.revoked_at is not null then
    perform app.write_audit('invitation.revoke', 'invitation', new.id, new.space_id,
      jsonb_build_object('email', new.email, 'role', new.role));
  end if;
  if old.accepted_at is null and new.accepted_at is not null then
    perform app.write_audit('invitation.accept', 'invitation', new.id, new.space_id,
      jsonb_build_object('email', new.email, 'role', new.role, 'user_id', new.accepted_by));
  end if;
  return new;
end;
$$;

create or replace function app.audit_app_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb;
begin
  v_changes := app.audit_changes(to_jsonb(old), to_jsonb(new),
    array['bootstrap_admin_emails', 'default_space_visibility', 'ai_enabled']);
  if v_changes <> '{}'::jsonb then
    perform app.write_audit('settings.update', 'settings', null, null, jsonb_build_object('changes', v_changes));
  end if;
  return new;
end;
$$;

create or replace function app.audit_access_allowlist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb;
begin
  if tg_op = 'INSERT' then
    perform app.write_audit('access.add', 'access_entry', new.id, null,
      jsonb_build_object('kind', new.kind, 'value', new.value, 'note', new.note));
    return new;
  elsif tg_op = 'UPDATE' then
    v_changes := app.audit_changes(to_jsonb(old), to_jsonb(new), array['kind', 'value', 'note']);
    if v_changes <> '{}'::jsonb then
      perform app.write_audit('access.update', 'access_entry', new.id, null,
        jsonb_build_object('kind', new.kind, 'value', new.value, 'changes', v_changes));
    end if;
    return new;
  else
    perform app.write_audit('access.remove', 'access_entry', old.id, null,
      jsonb_build_object('kind', old.kind, 'value', old.value, 'note', old.note));
    return old;
  end if;
end;
$$;

revoke all on function app.audit_logs_immutable() from public;
revoke all on function app.audit_spaces() from public;
revoke all on function app.audit_space_members() from public;
revoke all on function app.audit_invitations() from public;
revoke all on function app.audit_app_settings() from public;
revoke all on function app.audit_access_allowlist() from public;

-- Named to fire before spaces_add_creator_as_admin (same-event triggers run in name order),
-- so space.create precedes the creator's member.add.
create trigger spaces_0_audit
after insert or update on public.spaces
for each row execute function app.audit_spaces();

create trigger space_members_audit
after insert or update or delete on public.space_members
for each row execute function app.audit_space_members();

create trigger invitations_audit
after insert or update on public.invitations
for each row execute function app.audit_invitations();

create trigger app_settings_audit
after update on public.app_settings
for each row execute function app.audit_app_settings();

create trigger access_allowlist_audit
after insert or update or delete on public.access_allowlist
for each row execute function app.audit_access_allowlist();

-- ---------------------------------------------------------------------------
-- Query contract for the UI (apps/web/src/server/audit): keyset-paginated,
-- SECURITY INVOKER so audit_logs and profiles RLS decide what the caller sees.
-- ---------------------------------------------------------------------------

create or replace function public.list_audit_logs(
  p_space_id uuid default null,
  p_actions text[] default null,
  p_actor_id uuid default null,
  p_entity_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_before_occurred_at timestamptz default null,
  p_before_id bigint default null,
  p_limit integer default 50
)
returns table (
  id bigint,
  occurred_at timestamptz,
  action text,
  entity_type text,
  entity_id uuid,
  space_id uuid,
  metadata jsonb,
  actor_id uuid,
  actor_email text,
  actor_full_name text,
  actor_avatar_url text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    l.id, l.occurred_at, l.action, l.entity_type, l.entity_id, l.space_id, l.metadata,
    l.actor_id, p.email::text, p.full_name, p.avatar_url
  from public.audit_logs as l
  left join public.profiles as p on p.id = l.actor_id
  where (p_space_id is null or l.space_id = p_space_id)
    and (p_actions is null or l.action = any (p_actions))
    and (p_actor_id is null or l.actor_id = p_actor_id)
    and (p_entity_id is null or l.entity_id = p_entity_id)
    and (p_from is null or l.occurred_at >= p_from)
    and (p_to is null or l.occurred_at < p_to)
    and (
      p_before_occurred_at is null
      or (l.occurred_at, l.id) < (p_before_occurred_at, coalesce(p_before_id, 9223372036854775807))
    )
  order by l.occurred_at desc, l.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

comment on function public.list_audit_logs(uuid, text[], uuid, uuid, timestamptz, timestamptz, timestamptz, bigint, integer) is
  'Newest-first audit entries visible to the caller. Page with (p_before_occurred_at, p_before_id) of the last row.';

revoke all on function public.list_audit_logs(uuid, text[], uuid, uuid, timestamptz, timestamptz, timestamptz, bigint, integer) from public, anon;
grant execute on function public.list_audit_logs(uuid, text[], uuid, uuid, timestamptz, timestamptz, timestamptz, bigint, integer) to authenticated, service_role;
