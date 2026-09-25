create extension if not exists citext with schema extensions;

create type public.space_role as enum ('viewer', 'editor', 'admin');
create type public.space_visibility as enum ('restricted', 'internal');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email extensions.citext not null unique,
  full_name text,
  avatar_url text,
  locale text not null default 'vi' check (locale in ('vi', 'en')),
  time_zone text not null default 'Asia/Ho_Chi_Minh',
  is_guest boolean not null default false,
  is_super_admin boolean not null default false,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  bootstrap_admin_emails extensions.citext[] not null default '{}',
  default_space_visibility public.space_visibility not null default 'restricted',
  ai_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

insert into public.app_settings (id) values (1);

create table public.access_allowlist (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('domain', 'email')),
  value extensions.citext not null,
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (kind, value),
  check (
    (kind = 'email' and value::text ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
    or (kind = 'domain' and value::text ~* '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$')
  )
);

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  slug extensions.citext not null unique check (slug::text ~ '^[a-z0-9-]{2,50}$'),
  name text not null check (length(btrim(name)) > 0),
  description text,
  icon text,
  visibility public.space_visibility not null default 'restricted',
  ai_enabled boolean not null default true,
  created_by uuid not null references public.profiles (id) on delete restrict,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.space_members (
  space_id uuid not null references public.spaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.space_role not null,
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create index space_members_user_id_idx on public.space_members (user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  email extensions.citext not null,
  space_id uuid not null references public.spaces (id) on delete cascade,
  role public.space_role not null check (role <> 'admin'),
  token_hash text not null unique,
  invited_by uuid not null references public.profiles (id) on delete restrict,
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (accepted_at is null or accepted_by is not null)
);

create index invitations_pending_email_idx
  on public.invitations (lower(email::text))
  where accepted_at is null and revoked_at is null;

create or replace function app.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and is_super_admin
      and deactivated_at is null
  )
$$;

create or replace function app.is_internal_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and not is_guest
      and deactivated_at is null
  )
$$;

create or replace function app.default_space_visibility()
returns public.space_visibility
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select default_space_visibility from public.app_settings where id = 1),
    'restricted'::public.space_visibility
  )
$$;

alter table public.spaces
  alter column visibility set default app.default_space_visibility();

create or replace function app.space_role(p_space_id uuid)
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
  where p.id = (select auth.uid())
    and p.deactivated_at is null
$$;

create or replace function app.can_view_space(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.space_role(p_space_id) is not null
$$;

create or replace function app.can_edit_space(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.space_role(p_space_id) in ('editor'::public.space_role, 'admin'::public.space_role)
$$;

create or replace function app.is_space_admin(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.space_role(p_space_id) = 'admin'::public.space_role
$$;

create or replace function app.page_role(p_page_id uuid)
returns public.space_role
language sql
stable
security definer
set search_path = ''
as $$
  select null::public.space_role
$$;

comment on function app.page_role(uuid) is
  'MVP permission seam. T2.1 replaces this stub when the pages table is introduced.';

create or replace function app.authorize_document(p_page_id uuid, p_user_id uuid)
returns public.space_role
language sql
stable
security definer
set search_path = ''
as $$
  select null::public.space_role
$$;

comment on function app.authorize_document(uuid, uuid) is
  'Collab authorization seam. T2.1/T3.3 replace this stub after pages exist.';

create or replace function app.guard_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.email, new.is_guest, new.is_super_admin, new.deactivated_at)
      is distinct from
     (old.email, old.is_guest, old.is_super_admin, old.deactivated_at)
     and not (app.is_super_admin() or (select auth.role()) = 'service_role') then
    raise exception 'PROFILE_PRIVILEGED_FIELDS_FORBIDDEN' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function app.guard_guest_space_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'admin'::public.space_role
     and exists (select 1 from public.profiles where id = new.user_id and is_guest) then
    raise exception 'GUEST_CANNOT_BE_SPACE_ADMIN' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app.guard_last_space_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin'::public.space_role
     and (tg_op = 'DELETE' or new.role <> 'admin'::public.space_role or new.space_id <> old.space_id)
     and not exists (
       select 1 from public.space_members
       where space_id = old.space_id
         and user_id <> old.user_id
         and role = 'admin'::public.space_role
     ) then
    raise exception 'SPACE_REQUIRES_ADMIN' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function app.add_space_creator_as_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.space_members (space_id, user_id, role, added_by)
  values (new.id, new.created_by, 'admin'::public.space_role, new.created_by);
  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function app.touch_updated_at();

create trigger profiles_guard_privileged_fields
before update on public.profiles
for each row execute function app.guard_profile_privileged_fields();

create trigger app_settings_touch_updated_at
before update on public.app_settings
for each row execute function app.touch_updated_at();

create trigger spaces_touch_updated_at
before update on public.spaces
for each row execute function app.touch_updated_at();

create trigger spaces_add_creator_as_admin
after insert on public.spaces
for each row execute function app.add_space_creator_as_admin();

create trigger space_members_touch_updated_at
before update on public.space_members
for each row execute function app.touch_updated_at();

create trigger space_members_guard_guest_admin
before insert or update on public.space_members
for each row execute function app.guard_guest_space_admin();

create trigger space_members_guard_last_admin
before delete or update on public.space_members
for each row execute function app.guard_last_space_admin();

alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.access_allowlist enable row level security;
alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.invitations enable row level security;

create policy profiles_select on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or (app.is_internal_user() and not is_guest)
  or exists (
    select 1
    from public.space_members as mine
    join public.space_members as theirs using (space_id)
    where mine.user_id = (select auth.uid())
      and theirs.user_id = profiles.id
  )
);

create policy profiles_update on public.profiles
for update to authenticated
using (id = (select auth.uid()) or app.is_super_admin())
with check (id = (select auth.uid()) or app.is_super_admin());

create policy app_settings_select on public.app_settings
for select to authenticated
using ((select auth.uid()) is not null);

create policy app_settings_update on public.app_settings
for update to authenticated
using (app.is_super_admin())
with check (app.is_super_admin());

create policy access_allowlist_select on public.access_allowlist
for select to authenticated using (app.is_super_admin());
create policy access_allowlist_insert on public.access_allowlist
for insert to authenticated with check (app.is_super_admin());
create policy access_allowlist_update on public.access_allowlist
for update to authenticated using (app.is_super_admin()) with check (app.is_super_admin());
create policy access_allowlist_delete on public.access_allowlist
for delete to authenticated
using (
  app.is_super_admin()
  and not (
    kind = 'email'
    and value = (select email from public.profiles where id = (select auth.uid()))
  )
);

create policy spaces_select on public.spaces
for select to authenticated using (app.can_view_space(id));
create policy spaces_insert on public.spaces
for insert to authenticated
with check (app.is_internal_user() and created_by = (select auth.uid()));
create policy spaces_update on public.spaces
for update to authenticated
using (app.is_space_admin(id)) with check (app.is_space_admin(id));

create policy space_members_select on public.space_members
for select to authenticated using (app.can_view_space(space_id));
create policy space_members_insert on public.space_members
for insert to authenticated with check (app.is_space_admin(space_id));
create policy space_members_update on public.space_members
for update to authenticated
using (app.is_space_admin(space_id)) with check (app.is_space_admin(space_id));
create policy space_members_delete on public.space_members
for delete to authenticated
using (app.is_space_admin(space_id) or user_id = (select auth.uid()));

create policy invitations_select on public.invitations
for select to authenticated using (app.is_space_admin(space_id));
create policy invitations_insert on public.invitations
for insert to authenticated with check (app.is_space_admin(space_id));
create policy invitations_update on public.invitations
for update to authenticated
using (app.is_space_admin(space_id)) with check (app.is_space_admin(space_id));

revoke all on public.profiles, public.app_settings, public.access_allowlist,
  public.spaces, public.space_members, public.invitations from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, avatar_url, locale, time_zone) on public.profiles to authenticated;
grant select (id, default_space_visibility, ai_enabled, updated_at, updated_by)
  on public.app_settings to authenticated;
grant update (default_space_visibility, ai_enabled, updated_by) on public.app_settings to authenticated;
grant select, insert, update, delete on public.access_allowlist to authenticated;
grant select, insert on public.spaces to authenticated;
grant update (slug, name, description, icon, visibility, ai_enabled, archived_at)
  on public.spaces to authenticated;
grant select, insert, delete on public.space_members to authenticated;
grant update (role) on public.space_members to authenticated;
grant select, insert, update on public.invitations to authenticated;

revoke all on function app.is_super_admin() from public;
revoke all on function app.is_internal_user() from public;
revoke all on function app.default_space_visibility() from public;
revoke all on function app.space_role(uuid) from public;
revoke all on function app.can_view_space(uuid) from public;
revoke all on function app.can_edit_space(uuid) from public;
revoke all on function app.is_space_admin(uuid) from public;
revoke all on function app.page_role(uuid) from public;
revoke all on function app.authorize_document(uuid, uuid) from public;

grant execute on function app.is_super_admin() to authenticated, service_role;
grant execute on function app.is_internal_user() to authenticated, service_role;
grant execute on function app.default_space_visibility() to authenticated, service_role;
grant execute on function app.space_role(uuid) to authenticated, service_role;
grant execute on function app.can_view_space(uuid) to authenticated, service_role;
grant execute on function app.can_edit_space(uuid) to authenticated, service_role;
grant execute on function app.is_space_admin(uuid) to authenticated, service_role;
grant execute on function app.page_role(uuid) to authenticated, service_role;
grant execute on function app.authorize_document(uuid, uuid) to service_role;
