-- Group administration (super admin only): the functions behind /admin/groups, plus approving an
-- account straight into groups. The tables, their RLS and the audit triggers come from
-- 20261012100000_user_groups.sql; these SECURITY DEFINER functions only add what the screens
-- need on top (member counts, profile details, candidate search, validated writes), each one
-- checking `app.require_super_admin()` itself. Writes go through the same triggers, so every
-- change is audited as the calling admin.

create or replace function app.normalize_group_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if char_length(v_name) not between 1 and 80 then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  return v_name;
end;
$$;

create or replace function app.group_description(p_description text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if char_length(coalesce(v_description, '')) > 500 then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  return v_description;
end;
$$;

create or replace function app.require_group(p_group_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.groups as g where g.id = p_group_id) then
    raise exception 'GROUP_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_groups()
returns table (
  id uuid,
  name text,
  description text,
  member_count integer,
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
    g.created_at
  from public.groups as g
  order by lower(g.name), g.id;
end;
$$;

create or replace function public.admin_list_group_members(p_group_id uuid)
returns table (
  user_id uuid,
  email text,
  full_name text,
  avatar_url text,
  added_at timestamptz
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
  select p.id, p.email::text, p.full_name, p.avatar_url, m.created_at
  from public.group_members as m
  join public.profiles as p on p.id = m.user_id
  where m.group_id = p_group_id
  order by lower(coalesce(p.full_name, p.email::text)), p.id;
end;
$$;

-- Active internal users who are not in the group yet, matching an accent-insensitive fragment of
-- their name or email ("nguyen" finds "Nguyễn").
create or replace function public.admin_search_group_candidates(
  p_group_id uuid,
  p_query text,
  p_limit integer default 10
)
returns table (
  user_id uuid,
  email text,
  full_name text,
  avatar_url text
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
  perform app.require_super_admin();
  perform app.require_group(p_group_id);

  if length(v_needle) = 0 then
    return;
  end if;

  return query
  select p.id, p.email::text, p.full_name, p.avatar_url
  from public.profiles as p
  where not p.is_guest
    and p.status = 'active'
    and p.deactivated_at is null
    and not exists (
      select 1 from public.group_members as m
      where m.group_id = p_group_id and m.user_id = p.id
    )
    and (
      strpos(lower(p.email::text), v_needle) > 0
      or strpos(
        lower(extensions.unaccent(replace(replace(coalesce(p.full_name, ''), 'đ', 'd'), 'Đ', 'D'))),
        v_needle
      ) > 0
    )
  order by
    (lower(p.email::text) like v_needle || '%') desc,
    lower(coalesce(p.full_name, p.email::text)),
    p.id
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
end;
$$;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_group(p_name text, p_description text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.require_super_admin();

  begin
    insert into public.groups (name, description)
    values (app.normalize_group_name(p_name), app.group_description(p_description))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'GROUP_NAME_TAKEN' using errcode = '23505';
  end;

  return v_id;
end;
$$;

create or replace function public.admin_update_group(
  p_group_id uuid,
  p_name text,
  p_description text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app.require_super_admin();
  perform app.require_group(p_group_id);

  begin
    update public.groups
    set name = app.normalize_group_name(p_name),
        description = app.group_description(p_description)
    where id = p_group_id;
  exception when unique_violation then
    raise exception 'GROUP_NAME_TAKEN' using errcode = '23505';
  end;
end;
$$;

-- Returns how many members the group had (the screen tells the admin who just lost access).
create or replace function public.admin_delete_group(p_group_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_members integer;
begin
  perform app.require_super_admin();
  perform app.require_group(p_group_id);

  select count(*)::integer into v_members from public.group_members as m where m.group_id = p_group_id;
  delete from public.groups where id = p_group_id;
  return v_members;
end;
$$;

-- Adds people to a group (those already in it are skipped); returns how many were added. One
-- person that cannot join (guest, pending, locked) makes the whole call fail.
create or replace function public.admin_add_group_members(p_group_id uuid, p_user_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := array(select distinct u from unnest(coalesce(p_user_ids, '{}')) as u);
  v_added integer;
begin
  perform app.require_super_admin();
  perform app.require_group(p_group_id);

  if cardinality(v_ids) = 0 then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  if (select count(*) from public.profiles as p where p.id = any (v_ids)) <> cardinality(v_ids) then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;

  with inserted as (
    insert into public.group_members (group_id, user_id)
    select p_group_id, u from unnest(v_ids) as u
    on conflict do nothing
    returning 1
  )
  select count(*)::integer into v_added from inserted;

  return v_added;
end;
$$;

create or replace function public.admin_remove_group_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app.require_super_admin();
  perform app.require_group(p_group_id);

  delete from public.group_members as m where m.group_id = p_group_id and m.user_id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Approving into groups
-- ---------------------------------------------------------------------------

-- Same as before (20261012090000_account_approval.sql) plus the groups the new internal user joins
-- right away. A guest cannot join groups: asking for both fails and nothing is approved.
drop function public.admin_approve_account(uuid, boolean);

create function public.admin_approve_account(
  p_user_id uuid,
  p_is_guest boolean,
  p_group_ids uuid[] default '{}'
)
returns table (email text, locale text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile public.profiles;
  v_group_ids uuid[] := array(select distinct g from unnest(coalesce(p_group_ids, '{}')) as g);
begin
  perform app.require_super_admin();

  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_profile.status = 'active' then
    raise exception 'ACCOUNT_NOT_PENDING' using errcode = '23514';
  end if;

  if cardinality(v_group_ids) > 0 then
    if coalesce(p_is_guest, true) then
      raise exception 'GROUP_MEMBER_NOT_INTERNAL' using errcode = '23514';
    end if;
    if (select count(*) from public.groups as g where g.id = any (v_group_ids)) <> cardinality(v_group_ids) then
      raise exception 'GROUP_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  update public.profiles
  set status = 'active',
      is_guest = coalesce(p_is_guest, true),
      reviewed_by = (select auth.uid()),
      reviewed_at = now(),
      reject_reason = null
  where id = p_user_id;

  -- After the update: the membership guard needs the account to be active and internal.
  insert into public.group_members (group_id, user_id)
  select g, p_user_id from unnest(v_group_ids) as g
  on conflict do nothing;

  return query select v_profile.email::text, v_profile.locale;
end;
$$;

comment on function public.admin_approve_account(uuid, boolean, uuid[]) is
  'Super admin only. pending/rejected -> active; the admin chooses internal (false) or guest (true) '
  'and the groups an internal user joins. Returns the account email and locale.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function app.normalize_group_name(text) from public;
revoke all on function app.group_description(text) from public;
revoke all on function app.require_group(uuid) from public;
revoke all on function public.admin_list_groups() from public, anon;
revoke all on function public.admin_list_group_members(uuid) from public, anon;
revoke all on function public.admin_search_group_candidates(uuid, text, integer) from public, anon;
revoke all on function public.admin_create_group(text, text) from public, anon;
revoke all on function public.admin_update_group(uuid, text, text) from public, anon;
revoke all on function public.admin_delete_group(uuid) from public, anon;
revoke all on function public.admin_add_group_members(uuid, uuid[]) from public, anon;
revoke all on function public.admin_remove_group_member(uuid, uuid) from public, anon;
revoke all on function public.admin_approve_account(uuid, boolean, uuid[]) from public, anon;

grant execute on function public.admin_list_groups() to authenticated;
grant execute on function public.admin_list_group_members(uuid) to authenticated;
grant execute on function public.admin_search_group_candidates(uuid, text, integer) to authenticated;
grant execute on function public.admin_create_group(text, text) to authenticated;
grant execute on function public.admin_update_group(uuid, text, text) to authenticated;
grant execute on function public.admin_delete_group(uuid) to authenticated;
grant execute on function public.admin_add_group_members(uuid, uuid[]) to authenticated;
grant execute on function public.admin_remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.admin_approve_account(uuid, boolean, uuid[]) to authenticated;
