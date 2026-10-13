-- Account approval: every new account waits for a super admin before it can use KB.
--
-- Until now `app.before_user_created_hook` refused sign-ups outside `access_allowlist` / pending
-- invitations. Now anyone with a Google account may create an account, but it starts as `pending`
-- and sees nothing until a super admin approves it (and picks, at that moment, whether it is an
-- internal user or a guest). Rules:
--
--   * `profiles.status`: `pending` -> `active` | `rejected` (a rejected account can be approved
--     later). Existing accounts migrate as `active`; `reviewed_at is null` marks them as "never
--     reviewed", which keeps the allowlist / membership rules of `app.has_active_access` for them.
--   * Exempt from review: emails in `app_settings.bootstrap_admin_emails` (the first super admin
--     must be able to sign in) and emails holding a pending invitation (a Space admin already
--     vouched for them; they would otherwise be unable to accept it).
--   * Pending / rejected accounts get no access at all: every permission helper that looks at
--     `deactivated_at` also requires `status = 'active'`. The middleware keeps a pending session
--     alive only for the "waiting for approval" screen (`public.account_status`).
--   * Approval is explicit: `admin_approve_account` sets `reviewed_at`, which from then on counts
--     as active access by itself, so an approved person without an allowlist entry or Space
--     membership (yet) is not signed out on their next request.
--   * `access_allowlist` still decides `is_guest` for people who were never reviewed, and still
--     ends the session of never-reviewed users it no longer covers.

-- `app_settings.require_account_approval` switches the whole flow. It is on by default (this
-- migration), so production starts requiring approval as soon as it deploys. The local seed turns
-- it off (supabase/seed.sql) so the pgTAP and integration fixtures, which create users by
-- inserting into `auth.users`, keep getting immediately usable accounts; with it off the sign-in
-- gate is the old one (allowlist or pending invitation, otherwise `AUTH_NOT_ALLOWED`).

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.app_settings
  add column require_account_approval boolean not null default true;

create type public.account_status as enum ('pending', 'active', 'rejected');

alter table public.profiles
  add column status public.account_status not null default 'active',
  add column reviewed_by uuid references public.profiles (id) on delete set null,
  add column reviewed_at timestamptz,
  add column reject_reason text check (reject_reason is null or char_length(reject_reason) <= 500);

create index profiles_status_idx on public.profiles (status, created_at)
  where status <> 'active';

-- ---------------------------------------------------------------------------
-- Sign-in gate and profile bootstrap
-- ---------------------------------------------------------------------------

-- With approval required any email may create an account (`handle_new_user` makes it pending
-- unless exempt); otherwise only allowlisted emails and invited ones may.
create or replace function app.before_user_created_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email extensions.citext := nullif(btrim(coalesce(event -> 'user' ->> 'email', '')), '')::extensions.citext;
begin
  if v_email is null then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'AUTH_NOT_ALLOWED'));
  end if;

  if coalesce((select s.require_account_approval from public.app_settings as s where s.id = 1), true)
     or app.allowlist_matches(v_email)
     or app.has_pending_invitation(v_email)
  then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'AUTH_NOT_ALLOWED'));
end;
$$;

comment on function app.before_user_created_hook(jsonb) is
  'GoTrue "before user created" hook. With app_settings.require_account_approval every account '
  'with an email may sign up (pending until a super admin approves it); without it only '
  'allowlisted or invited emails may.';

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_guest boolean;
  v_is_super_admin boolean;
  v_exempt boolean;
  v_full_name text;
  v_avatar_url text;
begin
  v_is_guest := not app.allowlist_matches(new.email::extensions.citext);

  v_is_super_admin := exists (
    select 1
    from public.app_settings, unnest(bootstrap_admin_emails) as bootstrap(email)
    where app_settings.id = 1
      and lower(bootstrap.email::text) = lower(new.email::text)
  );

  v_exempt := v_is_super_admin
    or app.has_pending_invitation(new.email::extensions.citext)
    or not coalesce((select s.require_account_approval from public.app_settings as s where s.id = 1), true);

  v_full_name := coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name');
  v_avatar_url := coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture');

  insert into public.profiles (id, email, full_name, avatar_url, is_guest, is_super_admin, status)
  values (
    new.id, new.email, v_full_name, v_avatar_url, v_is_guest, v_is_super_admin,
    case when v_exempt then 'active'::public.account_status else 'pending'::public.account_status end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permission helpers: only `active` accounts count
-- ---------------------------------------------------------------------------

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
      and status = 'active'
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
      and status = 'active'
  )
$$;

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
    and p.status = 'active'
$$;

-- Other internal users only see active internal profiles (a pending account is not a candidate
-- for anything yet); the caller always sees their own row, whatever its status.
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or (app.is_internal_user() and not is_guest and status = 'active')
  or exists (
    select 1
    from public.space_members as mine
    join public.space_members as theirs using (space_id)
    where mine.user_id = (select auth.uid())
      and theirs.user_id = profiles.id
      and profiles.status = 'active'
  )
);

create or replace function public.search_member_candidates(
  p_space_id uuid,
  p_query text,
  p_limit integer default 10
)
returns table (
  user_id uuid,
  email text,
  full_name text,
  avatar_url text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with needle as (
    select lower(extensions.unaccent(replace(replace(btrim(coalesce(p_query, '')), 'đ', 'd'), 'Đ', 'D'))) as q
  )
  select p.id, p.email::text, p.full_name, p.avatar_url
  from public.profiles as p, needle
  where app.is_space_admin(p_space_id)
    and length(needle.q) > 0
    and not p.is_guest
    and p.deactivated_at is null
    and p.status = 'active'
    and not exists (
      select 1 from public.space_members as m
      where m.space_id = p_space_id and m.user_id = p.id
    )
    and (
      strpos(lower(p.email::text), needle.q) > 0
      or strpos(
        lower(extensions.unaccent(replace(replace(coalesce(p.full_name, ''), 'đ', 'd'), 'Đ', 'D'))),
        needle.q
      ) > 0
    )
  order by
    (lower(p.email::text) like needle.q || '%') desc,
    lower(coalesce(p.full_name, p.email::text)),
    p.id
  limit least(greatest(coalesce(p_limit, 10), 1), 50)
$$;

-- Session re-check of the middleware. A reviewed account (approved by a super admin) keeps its
-- session without an allowlist entry or membership; a never-reviewed one follows the old rules.
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
        or app.has_pending_invitation(p.email)
      )
  )
$$;

-- What the middleware needs to tell "waiting for approval" from "access revoked".
create or replace function public.account_status()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when p.deactivated_at is not null then 'deactivated'
    else p.status::text
  end
  from public.profiles as p
  where p.id = (select auth.uid())
$$;

comment on function public.account_status() is
  'pending | rejected | active | deactivated for auth.uid() (null when there is no profile). '
  'Called by the middleware when app.has_active_access() is false.';

-- ---------------------------------------------------------------------------
-- Super admin functions
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_pending_accounts(
  p_status text default 'pending',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  email text,
  full_name text,
  avatar_url text,
  status text,
  reject_reason text,
  created_at timestamptz,
  reviewed_at timestamptz,
  total_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform app.require_super_admin();

  if coalesce(p_status, '') not in ('pending', 'rejected') then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  return query
  select
    p.id,
    p.email::text,
    p.full_name,
    p.avatar_url,
    p.status::text,
    p.reject_reason,
    p.created_at,
    p.reviewed_at,
    (count(*) over ())::integer
  from public.profiles as p
  where p.status = p_status::public.account_status
  order by p.created_at, p.id
  limit greatest(least(coalesce(p_limit, 50), 200), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

comment on function public.admin_list_pending_accounts(text, integer, integer) is
  'Super admin only. Accounts waiting for review (or rejected ones), oldest first.';

-- Approve a pending (or rejected) account. `p_is_guest` is the admin's choice: an internal user
-- sees `internal` Spaces, a guest only the Spaces they are added to.
create or replace function public.admin_approve_account(p_user_id uuid, p_is_guest boolean)
returns table (email text, locale text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile public.profiles;
begin
  perform app.require_super_admin();

  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_profile.status = 'active' then
    raise exception 'ACCOUNT_NOT_PENDING' using errcode = '23514';
  end if;

  update public.profiles
  set status = 'active',
      is_guest = coalesce(p_is_guest, true),
      reviewed_by = (select auth.uid()),
      reviewed_at = now(),
      reject_reason = null
  where id = p_user_id;

  return query select v_profile.email::text, v_profile.locale;
end;
$$;

comment on function public.admin_approve_account(uuid, boolean) is
  'Super admin only. pending/rejected -> active; the admin chooses internal (false) or guest (true). '
  'Returns the account email and locale (for the notification email).';

create or replace function public.admin_reject_account(p_user_id uuid, p_reason text default null)
returns table (email text, locale text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile public.profiles;
begin
  perform app.require_super_admin();

  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_profile.status <> 'pending' then
    raise exception 'ACCOUNT_NOT_PENDING' using errcode = '23514';
  end if;

  update public.profiles
  set status = 'rejected',
      reviewed_by = (select auth.uid()),
      reviewed_at = now(),
      reject_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_user_id;

  return query select v_profile.email::text, v_profile.locale;
end;
$$;

comment on function public.admin_reject_account(uuid, text) is
  'Super admin only. pending -> rejected, with an optional reason. Returns the account email and locale.';

-- /admin/users: pending and rejected accounts show up with their status as the access reason.
drop function public.admin_list_users(text, text, uuid, integer, integer);

create function public.admin_list_users(
  p_query text default null,
  p_status text default 'all',
  p_user_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  email text,
  full_name text,
  avatar_url text,
  locale text,
  is_guest boolean,
  is_super_admin boolean,
  deactivated_at timestamptz,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  space_count integer,
  access text,
  total_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_query text := lower(nullif(btrim(coalesce(p_query, '')), ''));
begin
  perform app.require_super_admin();

  if coalesce(p_status, '') not in ('all', 'active', 'deactivated') then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  return query
  with filtered as (
    select p.*
    from public.profiles as p
    where (p_user_id is null or p.id = p_user_id)
      and (
        v_query is null
        or strpos(lower(p.email::text), v_query) > 0
        or strpos(lower(coalesce(p.full_name, '')), v_query) > 0
      )
      and (
        p_status = 'all'
        or (p_status = 'active' and p.deactivated_at is null and p.status = 'active')
        or (p_status = 'deactivated' and p.deactivated_at is not null)
      )
  ),
  counted as (
    select
      f.*,
      (select count(*)::integer from public.space_members as m where m.user_id = f.id) as spaces
    from filtered as f
  )
  select
    c.id,
    c.email::text,
    c.full_name,
    c.avatar_url,
    c.locale,
    c.is_guest,
    c.is_super_admin,
    c.deactivated_at,
    c.created_at,
    u.last_sign_in_at,
    c.spaces,
    case
      when c.deactivated_at is not null then 'deactivated'
      when c.status = 'pending' then 'pending'
      when c.status = 'rejected' then 'rejected'
      when c.is_super_admin then 'super_admin'
      when c.reviewed_at is not null then 'approved'
      when app.allowlist_matches(c.email) then 'allowlist'
      when c.spaces > 0 then 'membership'
      when app.has_pending_invitation(c.email) then 'invitation'
      else 'none'
    end,
    (count(*) over ())::integer
  from counted as c
  left join auth.users as u on u.id = c.id
  order by c.email
  limit greatest(least(coalesce(p_limit, 50), 200), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

comment on function public.admin_list_users(text, text, uuid, integer, integer) is
  'Super admin only. Users (guests, pending and rejected accounts included) with sign-in status; '
  'total_count ignores limit/offset.';

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

create or replace function app.audit_profiles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metadata jsonb := jsonb_build_object('email', new.email);
begin
  if old.deactivated_at is null and new.deactivated_at is not null then
    perform app.write_audit('user.deactivate', 'user', new.id, null, v_metadata);
  elsif old.deactivated_at is not null and new.deactivated_at is null then
    perform app.write_audit('user.reactivate', 'user', new.id, null, v_metadata);
  end if;

  if new.is_super_admin and not old.is_super_admin then
    perform app.write_audit('user.super_admin_grant', 'user', new.id, null, v_metadata);
  elsif old.is_super_admin and not new.is_super_admin then
    perform app.write_audit('user.super_admin_revoke', 'user', new.id, null, v_metadata);
  end if;

  if old.status <> 'active' and new.status = 'active' then
    perform app.write_audit('user.approve', 'user', new.id, null,
      v_metadata || jsonb_build_object('is_guest', new.is_guest, 'from_status', old.status));
  elsif old.status = 'pending' and new.status = 'rejected' then
    perform app.write_audit('user.reject', 'user', new.id, null,
      v_metadata || jsonb_build_object('reason', new.reject_reason));
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.account_status() from public, anon;
revoke all on function public.admin_list_pending_accounts(text, integer, integer) from public, anon;
revoke all on function public.admin_approve_account(uuid, boolean) from public, anon;
revoke all on function public.admin_reject_account(uuid, text) from public, anon;
revoke all on function public.admin_list_users(text, text, uuid, integer, integer) from public, anon;

grant execute on function public.account_status() to authenticated;
grant execute on function public.admin_list_pending_accounts(text, integer, integer) to authenticated;
grant execute on function public.admin_approve_account(uuid, boolean) to authenticated;
grant execute on function public.admin_reject_account(uuid, text) to authenticated;
grant execute on function public.admin_list_users(text, text, uuid, integer, integer) to authenticated;
