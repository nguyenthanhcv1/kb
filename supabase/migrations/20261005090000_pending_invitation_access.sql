-- T7.8 — a guest invited to a Space keeps their session until they accept (or the invitation
-- ends). `app.before_user_created_hook` lets a guest sign up through a pending invitation, but
-- `app.has_active_access` (the middleware's per-request re-check) only counted accepted
-- memberships: the first request outside `/invite` — often a prefetch of a sidebar link — signed
-- the guest out before they could accept. A valid pending invitation (not accepted, not revoked,
-- not expired: the sign-up hook's rule) now counts as active access. It grants nothing else: RLS
-- still only follows `space_members`, so the guest sees no Space until they accept. When the
-- invitation expires or is revoked, the next request signs them out as before.
--
-- The admin screens follow the same rule: `admin_access_impact` no longer counts such users as
-- losing access, and `admin_list_users` reports them as `invitation` instead of `none`.

-- Does `p_email` have an invitation that can still be accepted? The sign-up hook's rule, plus the
-- Space not archived (`accept_invitation` refuses those). Compared with lower() on text (see
-- app.entry_matches_email for why not citext `=`).
create or replace function app.has_pending_invitation(p_email extensions.citext)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.invitations as i
    join public.spaces as s on s.id = i.space_id
    where lower(i.email::text) = lower(p_email::text)
      and s.archived_at is null
      and i.accepted_at is null
      and i.revoked_at is null
      and i.expires_at > now()
  )
$$;

comment on function app.has_pending_invitation(extensions.citext) is
  'True when the email has an invitation that can still be accepted: not accepted, revoked or '
  'expired, to a Space that is not archived.';

revoke all on function app.has_pending_invitation(extensions.citext) from public, anon, authenticated;

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
        or app.has_pending_invitation(p.email)
      )
  )
$$;

comment on function app.has_active_access() is
  'Session-level access re-check (T1.2a, T7.8). True when the signed-in caller may keep using '
  'their session right now: not deactivated, and still allowlisted, a super admin, a member of at '
  'least one Space, or invited to one (invitation not accepted, revoked or expired yet). Called by '
  'the middleware on every request as the caller, so it only ever answers for auth.uid() itself.';

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
      exists (select 1 from public.space_members as m where m.user_id = p.id)
        or app.has_pending_invitation(p.email) as keeps_session
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
    (count(*) filter (where not matched.keeps_internal and not matched.keeps_session))::integer,
    (count(*) filter (where not matched.keeps_internal and matched.keeps_session))::integer
  from matched;
end;
$$;

comment on function public.admin_access_impact(uuid[]) is
  'Super admin only. Effect on active users of removing the given allowlist entries (a Space '
  'membership or a pending invitation keeps the session, as a guest).';

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
  'Super admin only. Users (guests included) with sign-in status; total_count ignores limit/offset.';
