-- Access administration (task T1.7a, docs/PLAN.md §3.2 `access_allowlist`, §9 T1.7).
--
-- `access_allowlist` and its RLS (super admin only; nobody deletes the row matching their own
-- email) come from the core schema, its audit (`access.add/update/remove`) from T1.6a and the
-- per-request session re-check (`app.has_active_access`) from T1.2a. This migration adds what the
-- /admin/access and /admin/users screens need on top:
--
--   * `is_guest` follows the allowlist: a profile whose email/domain gets allowlisted becomes an
--     internal user (PLAN §3.2 step 4), and one that loses its last matching entry becomes a guest
--     again (it keeps only its explicit Space memberships — "trừ khi vẫn còn membership dạng
--     khách", §3.2 step 3) instead of silently keeping implicit access to every `internal` Space.
--     Super admins never become guests.
--   * Invariants on the privileged profile fields, enforced for every caller: nobody can
--     deactivate themselves or revoke their own super admin, the last active super admin stays.
--     The admin functions add UI rules on top: a guest (not allowlisted) or a deactivated user
--     cannot be made super admin.
--   * Audit of those changes (`user.deactivate/reactivate/super_admin_grant/super_admin_revoke`).
--   * SECURITY DEFINER read/write functions for the admin screens (super admin only, checked
--     inside each function): entry list with per-entry user counts, removal impact preview, user
--     list (incl. guests, which `profiles_select` hides from other internal users), lock/unlock
--     and grant/revoke super admin.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Does allowlist entry (kind, value) cover `p_email`? Compared with lower() on text on purpose:
-- inside `set search_path = ''` functions the citext `=` operator (schema `extensions`) is not
-- visible, so `citext = citext` silently falls back to case-sensitive text equality.
create or replace function app.entry_matches_email(
  p_kind text,
  p_value extensions.citext,
  p_email extensions.citext
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'email' then lower(p_value::text) = lower(p_email::text)
    when 'domain' then lower(p_value::text) = lower(split_part(p_email::text, '@', 2))
    else false
  end
$$;

-- Does `p_email` match an allowlist entry (exact email, or its domain), ignoring the entries in
-- `p_exclude` (used to answer "would this user still match once these entries are removed?").
create or replace function app.allowlist_matches(
  p_email extensions.citext,
  p_exclude uuid[] default '{}'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.access_allowlist as a
    where not (a.id = any (coalesce(p_exclude, '{}')))
      and app.entry_matches_email(a.kind, a.value, p_email)
  )
$$;

comment on function app.allowlist_matches(extensions.citext, uuid[]) is
  'True when the email is allowlisted (exact email or domain entry), not counting p_exclude.';

-- ---------------------------------------------------------------------------
-- T1.2a fixes
-- ---------------------------------------------------------------------------

-- The T1.2a sign-in functions compared citext values inside `set search_path = ''`, which is
-- case-sensitive (see app.entry_matches_email): allowlisting `An@Example.com` did not let
-- `an@example.com` sign up, and vice versa. Same decisions, case-insensitive comparisons.

create or replace function app.before_user_created_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email extensions.citext := (event -> 'user' ->> 'email')::extensions.citext;
begin
  if v_email is null then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'AUTH_NOT_ALLOWED'));
  end if;

  if app.allowlist_matches(v_email)
     or exists (
       select 1 from public.invitations
       where lower(email::text) = lower(v_email::text)
         and accepted_at is null
         and revoked_at is null
         and expires_at > now()
     )
  then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'AUTH_NOT_ALLOWED'));
end;
$$;

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_guest boolean;
  v_is_super_admin boolean;
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

  v_full_name := coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name');
  v_avatar_url := coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture');

  insert into public.profiles (id, email, full_name, avatar_url, is_guest, is_super_admin)
  values (new.id, new.email, v_full_name, v_avatar_url, v_is_guest, v_is_super_admin)
  on conflict (id) do nothing;

  return new;
end;
$$;

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
      and (
        p.is_super_admin
        or app.allowlist_matches(p.email)
        or exists (select 1 from public.space_members as m where m.user_id = p.id)
      )
  )
$$;

-- The middleware calls `supabase.rpc("has_active_access")`, but PostgREST only exposes `public`
-- (supabase/config.toml `[api] schemas`): the call answered 404 (PGRST202) and the middleware,
-- which fails open on errors, never signed anyone out. This wrapper is what it reaches.
create or replace function public.has_active_access()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select app.has_active_access()
$$;

comment on function public.has_active_access() is
  'PostgREST entry point of app.has_active_access() (the per-request session re-check of the '
  'middleware, apps/web/src/lib/supabase/middleware.ts). Answers for auth.uid() only.';

create or replace function app.require_super_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_super_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileged profile fields
-- ---------------------------------------------------------------------------

-- Same rule as the core schema (only super admins / service_role touch email, is_guest,
-- is_super_admin, deactivated_at), plus one exception: `is_guest` may change inside another
-- trigger (pg_trigger_depth() > 1), which is how `app.sync_guest_flags_from_allowlist` keeps it in
-- line with the allowlist whoever edits the allowlist (super admin, service_role bootstrap sync,
-- migration owner in tests). Clients cannot run trigger code of their own, so this does not
-- widen what a signed-in user can do.
create or replace function app.guard_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.is_super_admin() or (select auth.role()) = 'service_role' then
    return new;
  end if;

  if (new.email, new.is_super_admin, new.deactivated_at)
       is distinct from (old.email, old.is_super_admin, old.deactivated_at)
     or (new.is_guest is distinct from old.is_guest and pg_trigger_depth() <= 1) then
    raise exception 'PROFILE_PRIVILEGED_FIELDS_FORBIDDEN' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Fires before `profiles_guard_privileged_fields` (same-event triggers run in name order).
create or replace function app.guard_profile_admin_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id = (select auth.uid()) and (
       (old.is_super_admin and not new.is_super_admin)
       or (old.deactivated_at is null and new.deactivated_at is not null)
     ) then
    raise exception 'USER_CANNOT_CHANGE_SELF' using errcode = '42501';
  end if;

  if (old.is_super_admin and old.deactivated_at is null)
     and not (new.is_super_admin and new.deactivated_at is null) then
    -- Serialize concurrent demotions so two admins cannot demote each other at the same time.
    perform pg_advisory_xact_lock(hashtext('app.active_super_admins'));
    if not exists (
      select 1 from public.profiles
      where id <> old.id and is_super_admin and deactivated_at is null
    ) then
      raise exception 'LAST_SUPER_ADMIN' using errcode = '23514';
    end if;
  end if;

  if new.is_super_admin is distinct from old.is_super_admin then
    new.is_guest := not (new.is_super_admin or app.allowlist_matches(new.email));
  end if;

  return new;
end;
$$;

comment on function app.guard_profile_admin_changes() is
  'Invariants of /admin/users (T1.7a): no self-deactivation or self-demotion, keep one active '
  'super admin; is_guest follows is_super_admin.';

create trigger profiles_admin_changes
before update on public.profiles
for each row execute function app.guard_profile_admin_changes();

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

  return new;
end;
$$;

create trigger profiles_audit
after update on public.profiles
for each row execute function app.audit_profiles();

-- ---------------------------------------------------------------------------
-- is_guest follows the allowlist
-- ---------------------------------------------------------------------------

create or replace function app.sync_guest_flags_from_allowlist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entries jsonb := '[]'::jsonb;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    v_entries := v_entries || jsonb_build_array(jsonb_build_object('kind', new.kind, 'value', new.value));
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    v_entries := v_entries || jsonb_build_array(jsonb_build_object('kind', old.kind, 'value', old.value));
  end if;

  update public.profiles as p
  set is_guest = not (p.is_super_admin or app.allowlist_matches(p.email))
  where exists (
      select 1
      from jsonb_to_recordset(v_entries) as e(kind text, value text)
      where app.entry_matches_email(e.kind, e.value::extensions.citext, p.email)
    )
    and p.is_guest is distinct from not (p.is_super_admin or app.allowlist_matches(p.email));

  return null;
end;
$$;

comment on function app.sync_guest_flags_from_allowlist() is
  'Keeps profiles.is_guest = not (super admin or allowlisted) for profiles matching a changed entry.';

create trigger access_allowlist_sync_guest_flags
after insert or update or delete on public.access_allowlist
for each row execute function app.sync_guest_flags_from_allowlist();

-- ---------------------------------------------------------------------------
-- Admin read functions (contract: apps/web/src/server/admin)
-- ---------------------------------------------------------------------------

-- Allowlist entries with the number of active (not deactivated) users each one matches.
create or replace function public.admin_list_access_entries(p_entry_ids uuid[] default null)
returns table (
  id uuid,
  kind text,
  value text,
  note text,
  created_by uuid,
  created_by_email text,
  created_at timestamptz,
  user_count integer
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
    a.id,
    a.kind,
    a.value::text,
    a.note,
    a.created_by,
    creator.email::text,
    a.created_at,
    (
      select count(*)::integer
      from public.profiles as p
      where p.deactivated_at is null
        and app.entry_matches_email(a.kind, a.value, p.email)
    )
  from public.access_allowlist as a
  left join public.profiles as creator on creator.id = a.created_by
  where p_entry_ids is null or a.id = any (p_entry_ids)
  order by a.kind, a.value;
end;
$$;

comment on function public.admin_list_access_entries(uuid[]) is
  'Super admin only. Allowlist entries (all, or p_entry_ids) with the count of active users each matches.';

-- What removing `p_entry_ids` would do to active users, per `app.has_active_access` semantics:
--   matched_users   — active users matching at least one of the entries;
--   losing_access   — of those, no other entry matches, not super admin, no Space membership:
--                     signed out on their next request;
--   becoming_guest  — no other entry matches, not super admin, but still a Space member: they
--                     keep access to those Spaces only, as a guest.
create or replace function public.admin_access_impact(p_entry_ids uuid[])
returns table (matched_users integer, losing_access integer, becoming_guest integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform app.require_super_admin();

  return query
  with matched as (
    select
      p.is_super_admin or app.allowlist_matches(p.email, p_entry_ids) as keeps_internal,
      exists (select 1 from public.space_members as m where m.user_id = p.id) as is_member
    from public.profiles as p
    where p.deactivated_at is null
      and exists (
        select 1
        from public.access_allowlist as a
        where a.id = any (coalesce(p_entry_ids, '{}'))
          and app.entry_matches_email(a.kind, a.value, p.email)
      )
  )
  select
    count(*)::integer,
    (count(*) filter (where not matched.keeps_internal and not matched.is_member))::integer,
    (count(*) filter (where not matched.keeps_internal and matched.is_member))::integer
  from matched;
end;
$$;

comment on function public.admin_access_impact(uuid[]) is
  'Super admin only. Effect on active users of removing the given allowlist entries.';

-- Every user (guests included), ordered by email. `access` explains why the user can sign in:
-- deactivated | super_admin | allowlist | membership | none (signed out on the next request).
create or replace function public.admin_list_users(
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
        or (p_status = 'active' and p.deactivated_at is null)
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
      when c.is_super_admin then 'super_admin'
      when app.allowlist_matches(c.email) then 'allowlist'
      when c.spaces > 0 then 'membership'
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
  'Super admin only. Users (guests included) with sign-in status; total_count ignores limit/offset.';

-- ---------------------------------------------------------------------------
-- Admin write functions. Invariants live in the profiles triggers above; these only check the
-- caller and that the target exists (profiles_select hides guests from other users, so a plain
-- PostgREST UPDATE could not reach them).
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_user_deactivated(p_user_id uuid, p_deactivated boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_super_admin();

  update public.profiles
  set deactivated_at = case
    when p_deactivated then coalesce(deactivated_at, now())
    else null
  end
  where id = p_user_id;

  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.admin_set_super_admin(p_user_id uuid, p_is_super_admin boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  perform app.require_super_admin();

  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_is_super_admin and not v_profile.is_super_admin then
    if v_profile.deactivated_at is not null then
      raise exception 'USER_DEACTIVATED' using errcode = '23514';
    end if;
    -- Allowlist a guest first: super admin would otherwise silently turn them internal.
    if v_profile.is_guest and not app.allowlist_matches(v_profile.email) then
      raise exception 'USER_IS_GUEST' using errcode = '23514';
    end if;
  end if;

  update public.profiles
  set is_super_admin = p_is_super_admin
  where id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function app.entry_matches_email(text, extensions.citext, extensions.citext) from public;
revoke all on function app.allowlist_matches(extensions.citext, uuid[]) from public;
revoke all on function app.require_super_admin() from public;
revoke all on function app.guard_profile_admin_changes() from public;
revoke all on function app.audit_profiles() from public;
revoke all on function app.sync_guest_flags_from_allowlist() from public;
revoke all on function public.admin_list_access_entries(uuid[]) from public, anon;
revoke all on function public.admin_access_impact(uuid[]) from public, anon;
revoke all on function public.admin_list_users(text, text, uuid, integer, integer) from public, anon;
revoke all on function public.admin_set_user_deactivated(uuid, boolean) from public, anon;
revoke all on function public.admin_set_super_admin(uuid, boolean) from public, anon;

revoke all on function public.has_active_access() from public, anon;
grant execute on function public.has_active_access() to authenticated;
grant execute on function public.admin_list_access_entries(uuid[]) to authenticated;
grant execute on function public.admin_access_impact(uuid[]) to authenticated;
grant execute on function public.admin_list_users(text, text, uuid, integer, integer) to authenticated;
grant execute on function public.admin_set_user_deactivated(uuid, boolean) to authenticated;
grant execute on function public.admin_set_super_admin(uuid, boolean) to authenticated;
