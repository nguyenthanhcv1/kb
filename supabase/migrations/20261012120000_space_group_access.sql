-- Space access for groups: a Space grants a role to a whole group (e.g. "KAS" → editor), so adding
-- or removing a person in the group changes their access to every Space granted to it.
--
-- Design (kept apart from `space_members` on purpose, so no existing table, key or policy changes):
--   * `space_groups (space_id, group_id, role)`, role `viewer` or `editor` — a group is never a
--     Space admin; admins are always named people.
--   * One place computes access: `app.user_space_role()` (used by `app.space_role()`, every RLS
--     policy, the collab server's `authorize_document` and search). The effective role is the
--     HIGHEST of: the direct membership, the roles granted to the groups the person is in, and
--     viewer on an `internal` Space. There is no "deny". Super admins stay admin everywhere.
--   * Group grants only count for active internal users (not guests, pending, rejected or locked),
--     like every other source of access.
--   * Space admins manage the grants of their Space (RLS); everyone who can view the Space can
--     read them.
--   * Audited as `member.group_add`, `member.group_role_change`, `member.group_remove` (Space
--     scope, so they show on the Space audit page). Deleting a group removes its grants; that is
--     audited once as `group.delete`, now with the number of Spaces affected.

create table public.space_groups (
  space_id uuid not null references public.spaces (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  role public.space_role not null check (role in ('viewer', 'editor')),
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (space_id, group_id)
);

-- "Which Spaces does this group reach?" (group page, delete impact).
create index space_groups_group_idx on public.space_groups (group_id);

alter table public.space_groups enable row level security;

create policy space_groups_select on public.space_groups
for select to authenticated using (app.can_view_space(space_id));
create policy space_groups_insert on public.space_groups
for insert to authenticated with check (app.is_space_admin(space_id));
create policy space_groups_update on public.space_groups
for update to authenticated
using (app.is_space_admin(space_id)) with check (app.is_space_admin(space_id));
create policy space_groups_delete on public.space_groups
for delete to authenticated using (app.is_space_admin(space_id));

revoke all on public.space_groups from anon, authenticated, service_role;
grant select, insert, delete on public.space_groups to authenticated, service_role;
grant update (role) on public.space_groups to authenticated;
grant update on public.space_groups to service_role;

create trigger space_groups_touch_updated_at
before update on public.space_groups
for each row execute function app.touch_updated_at();

create or replace function app.set_space_group_adder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.added_by := coalesce((select auth.uid()), new.added_by);
  return new;
end;
$$;

create trigger space_groups_set_adder
before insert on public.space_groups
for each row execute function app.set_space_group_adder();

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

create or replace function app.audit_space_groups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.space_groups := case when tg_op = 'DELETE' then old else new end;
  v_name text;
begin
  select g.name into v_name from public.groups as g where g.id = v_row.group_id;
  -- The group itself is being deleted: `group.delete` already says so.
  if v_name is null then
    return v_row;
  end if;

  if tg_op = 'INSERT' then
    perform app.write_audit('member.group_add', 'member', v_row.group_id, v_row.space_id,
      jsonb_build_object('group_id', v_row.group_id, 'name', v_name, 'role', v_row.role));
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      perform app.write_audit('member.group_role_change', 'member', v_row.group_id, v_row.space_id,
        jsonb_build_object('group_id', v_row.group_id, 'name', v_name,
                           'from_role', old.role, 'to_role', new.role));
    end if;
  else
    perform app.write_audit('member.group_remove', 'member', v_row.group_id, v_row.space_id,
      jsonb_build_object('group_id', v_row.group_id, 'name', v_name, 'role', v_row.role));
  end if;
  return v_row;
end;
$$;

create trigger space_groups_audit
after insert or update or delete on public.space_groups
for each row execute function app.audit_space_groups();

create or replace function app.audit_group_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.write_audit('group.delete', 'group', old.id, null,
    jsonb_build_object(
      'name', old.name,
      'member_count', (select count(*) from public.group_members as m where m.group_id = old.id),
      'space_count', (select count(*) from public.space_groups as sg where sg.group_id = old.id)
    ));
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- The one place that decides a person's role in a Space
-- ---------------------------------------------------------------------------

create or replace function app.user_space_role(p_space_id uuid, p_user_id uuid)
returns public.space_role
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p.is_super_admin then 'admin'::public.space_role
    else (
      select max(sources.role)
      from (
        -- direct membership
        select m.role
        from public.space_members as m
        where m.space_id = s.id and m.user_id = p.id
        union all
        -- roles granted to the groups the person is in (internal users only)
        select sg.role
        from public.space_groups as sg
        join public.group_members as gm on gm.group_id = sg.group_id and gm.user_id = p.id
        where sg.space_id = s.id and not p.is_guest
        union all
        -- everyone internal reads an `internal` Space
        select 'viewer'::public.space_role
        where s.visibility = 'internal' and not p.is_guest
      ) as sources
    )
  end
  from public.profiles as p
  join public.spaces as s on s.id = p_space_id and s.archived_at is null
  where p.id = p_user_id
    and p.deactivated_at is null
    and p.status = 'active'
$$;

comment on function app.user_space_role(uuid, uuid) is
  'Role of a user in a Space: admin for super admins, else the highest of direct membership, '
  'group grants (internal users) and viewer on an internal Space; null when none applies.';

-- A person who only reaches Spaces through a group keeps their session (the admin put them there).
create or replace function app.has_active_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = (select auth.uid())
      and p.deactivated_at is null
      and p.status = 'active'
      and (
        p.is_super_admin
        or p.reviewed_at is not null
        or app.allowlist_matches(p.email)
        or exists (select 1 from public.space_members as m where m.user_id = p.id)
        or exists (select 1 from public.group_members as gm where gm.user_id = p.id)
        or app.has_pending_invitation(p.email)
      )
  )
$$;

-- ---------------------------------------------------------------------------
-- Reads for the screens
-- ---------------------------------------------------------------------------

-- Groups with access to a Space (anyone who can view the Space), with member counts a plain
-- viewer could not count themselves (group memberships are private to admins).
create or replace function public.list_space_groups(p_space_id uuid)
returns table (
  group_id uuid,
  name text,
  description text,
  role public.space_role,
  member_count integer,
  added_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not app.can_view_space(p_space_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return query
  select
    g.id,
    g.name,
    g.description,
    sg.role,
    (select count(*)::integer from public.group_members as gm where gm.group_id = g.id),
    sg.created_at
  from public.space_groups as sg
  join public.groups as g on g.id = sg.group_id
  where sg.space_id = p_space_id
  order by lower(g.name), g.id;
end;
$$;

-- Groups a Space admin could still grant access to, by an accent-insensitive name fragment.
create or replace function public.search_grantable_groups(
  p_space_id uuid,
  p_query text,
  p_limit integer default 10
)
returns table (
  group_id uuid,
  name text,
  description text,
  member_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_needle text := lower(extensions.unaccent(replace(replace(btrim(coalesce(p_query, '')), 'đ', 'd'), 'Đ', 'D')));
begin
  if not app.is_space_admin(p_space_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if length(v_needle) = 0 then
    return;
  end if;

  return query
  select
    g.id,
    g.name,
    g.description,
    (select count(*)::integer from public.group_members as gm where gm.group_id = g.id)
  from public.groups as g
  where not exists (
      select 1 from public.space_groups as sg
      where sg.space_id = p_space_id and sg.group_id = g.id
    )
    and strpos(
      lower(extensions.unaccent(replace(replace(g.name, 'đ', 'd'), 'Đ', 'D'))),
      v_needle
    ) > 0
  order by
    (lower(extensions.unaccent(g.name)) like v_needle || '%') desc,
    lower(g.name),
    g.id
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
end;
$$;

-- Spaces a group reaches (super admin: the group page and the delete warning).
create or replace function public.admin_list_group_spaces(p_group_id uuid)
returns table (
  space_id uuid,
  slug text,
  name text,
  role public.space_role
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform app.require_super_admin();
  perform app.require_group(p_group_id);

  return query
  select s.id, s.slug::text, s.name, sg.role
  from public.space_groups as sg
  join public.spaces as s on s.id = sg.space_id
  where sg.group_id = p_group_id and s.archived_at is null
  order by lower(s.name), s.id;
end;
$$;

-- The group list gains the number of Spaces each group reaches.
drop function public.admin_list_groups();

create function public.admin_list_groups()
returns table (
  id uuid,
  name text,
  description text,
  member_count integer,
  space_count integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform app.require_super_admin();

  return query
  select
    g.id,
    g.name,
    g.description,
    (select count(*)::integer from public.group_members as m where m.group_id = g.id),
    (select count(*)::integer from public.space_groups as sg
       join public.spaces as s on s.id = sg.space_id
      where sg.group_id = g.id and s.archived_at is null),
    g.created_at
  from public.groups as g
  order by lower(g.name), g.id;
end;
$$;

revoke all on function app.set_space_group_adder() from public;
revoke all on function app.audit_space_groups() from public;
revoke all on function public.list_space_groups(uuid) from public, anon;
revoke all on function public.search_grantable_groups(uuid, text, integer) from public, anon;
revoke all on function public.admin_list_group_spaces(uuid) from public, anon;
revoke all on function public.admin_list_groups() from public, anon;
grant execute on function public.list_space_groups(uuid) to authenticated;
grant execute on function public.search_grantable_groups(uuid, text, integer) to authenticated;
grant execute on function public.admin_list_group_spaces(uuid) to authenticated;
grant execute on function public.admin_list_groups() to authenticated;
