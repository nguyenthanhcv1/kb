-- User groups (a team such as "KAS" and its members). A group is only a set of people: it grants
-- nothing by itself. A later migration lets a Space grant a role to a group, so that adding or
-- removing a person here changes their access to every Space granted to the group at once.
--
-- Rules:
--   * Groups are flat (no nesting) and only a super admin creates, renames, deletes them or changes
--     their members. Any active internal user may read the list of groups (a Space admin picks a
--     group to grant access to); a member also sees their own memberships.
--   * Only active internal users can be members (no guests, no pending / rejected / locked
--     accounts), checked when the membership is added.
--   * Names are unique ignoring case.
--   * Everything is audited: `group.create`, `group.update`, `group.delete`,
--     `group.member_add`, `group.member_remove` (entity type `group`).

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80 and name = btrim(name)),
  description text check (description is null or char_length(description) <= 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index groups_name_key on public.groups (lower(name));

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- "Which groups is this user in?" — the lookup of every permission check that follows.
create index group_members_user_idx on public.group_members (user_id);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;

create policy groups_select on public.groups
for select to authenticated
using (app.is_super_admin() or app.is_internal_user());

create policy groups_insert on public.groups
for insert to authenticated
with check (app.is_super_admin());

create policy groups_update on public.groups
for update to authenticated
using (app.is_super_admin())
with check (app.is_super_admin());

create policy groups_delete on public.groups
for delete to authenticated
using (app.is_super_admin());

create policy group_members_select on public.group_members
for select to authenticated
using (app.is_super_admin() or user_id = (select auth.uid()));

create policy group_members_insert on public.group_members
for insert to authenticated
with check (app.is_super_admin());

create policy group_members_delete on public.group_members
for delete to authenticated
using (app.is_super_admin());

revoke all on public.groups, public.group_members from anon, authenticated, service_role;
grant select, insert, delete on public.group_members to authenticated, service_role;
grant select, insert, delete on public.groups to authenticated, service_role;
grant update (name, description) on public.groups to authenticated;
grant update on public.groups to service_role;

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

create trigger groups_touch_updated_at
before update on public.groups
for each row execute function app.touch_updated_at();

create or replace function app.set_group_creator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_by := coalesce((select auth.uid()), new.created_by);
  return new;
end;
$$;

create trigger groups_set_creator
before insert on public.groups
for each row execute function app.set_group_creator();

create or replace function app.guard_group_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.added_by := coalesce((select auth.uid()), new.added_by);

  if not exists (
    select 1
    from public.profiles as p
    where p.id = new.user_id
      and not p.is_guest
      and p.status = 'active'
      and p.deactivated_at is null
  ) then
    raise exception 'GROUP_MEMBER_NOT_INTERNAL' using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function app.guard_group_member() is
  'Only active internal users (not guests, pending, rejected or deactivated) can join a group.';

create trigger group_members_guard
before insert on public.group_members
for each row execute function app.guard_group_member();

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

create or replace function app.audit_groups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.write_audit('group.create', 'group', new.id, null,
      jsonb_build_object('name', new.name));
    return new;
  end if;

  if new.name is distinct from old.name or new.description is distinct from old.description then
    perform app.write_audit('group.update', 'group', new.id, null,
      jsonb_build_object('name', new.name)
        || app.audit_changes(to_jsonb(old), to_jsonb(new), array['name', 'description']));
  end if;
  return new;
end;
$$;

-- BEFORE DELETE so the member count is still there; the cascade then removes the memberships
-- without a `group.member_remove` entry per person (see app.audit_group_members).
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
      'member_count', (select count(*) from public.group_members as m where m.group_id = old.id)
    ));
  return old;
end;
$$;

create or replace function app.audit_group_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.group_members := case when tg_op = 'INSERT' then new else old end;
  v_group public.groups;
  v_email extensions.citext;
begin
  select * into v_group from public.groups as g where g.id = v_row.group_id;
  -- The group itself is being deleted: `group.delete` already says so.
  if not found then
    return v_row;
  end if;

  select p.email into v_email from public.profiles as p where p.id = v_row.user_id;

  perform app.write_audit(
    case tg_op when 'INSERT' then 'group.member_add' else 'group.member_remove' end,
    'group', v_row.group_id, null,
    jsonb_build_object('name', v_group.name, 'user_id', v_row.user_id, 'email', v_email));
  return v_row;
end;
$$;

create trigger groups_audit
after insert or update on public.groups
for each row execute function app.audit_groups();

create trigger groups_audit_delete
before delete on public.groups
for each row execute function app.audit_group_delete();

create trigger group_members_audit
after insert or delete on public.group_members
for each row execute function app.audit_group_members();

revoke all on function app.set_group_creator() from public;
revoke all on function app.guard_group_member() from public;
revoke all on function app.audit_groups() from public;
revoke all on function app.audit_group_delete() from public;
revoke all on function app.audit_group_members() from public;
