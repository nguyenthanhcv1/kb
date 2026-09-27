-- Space members + guest invitations (docs/PLAN.md §9 T1.5, task T1.5a).
--
-- Tables `space_members` / `invitations`, their RLS policies, the guest/last-admin guards and the
-- audit triggers already exist (T1.1, T1.6a). This migration only adds what the server contract
-- (apps/web/src/server/members) needs on top:
--   * app.invitation_token_hash: the one place that turns a raw invite token into `token_hash`
--     (sha256, hex). The raw token only ever lives in the email / invite link.
--   * public.get_invitation / public.accept_invitation: the `/invite/[token]` flow. The invitee is
--     not a Space admin, so `invitations_select` hides the row from them; these SECURITY DEFINER
--     functions look it up by token hash instead, so kb-web never needs service_role for it.
--   * public.list_space_members / public.search_member_candidates: SECURITY INVOKER read helpers,
--     so RLS on `space_members` / `profiles` still decides what the caller sees.
--   * Invitation state guard + column grants: an accepted invitation is frozen and a revoked one
--     cannot be un-revoked, so a token really is single-use even for Space admins writing through
--     PostgREST directly.

-- ---------------------------------------------------------------------------
-- Token hash
-- ---------------------------------------------------------------------------

create or replace function app.invitation_token_hash(p_token text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex')
$$;

comment on function app.invitation_token_hash(text) is
  'sha256 (hex) of a raw invitation token, as stored in invitations.token_hash. '
  'Must match hashInvitationToken() in apps/web/src/server/members.';

revoke all on function app.invitation_token_hash(text) from public;
grant execute on function app.invitation_token_hash(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Invitation state guard
-- ---------------------------------------------------------------------------

-- Applies to every writer, Space admins included: once accepted an invitation never changes again
-- (single-use), and once revoked it stays revoked. `public.accept_invitation` is the only path that
-- sets accepted_at/accepted_by (column grants below keep them out of reach of `authenticated`).
create or replace function app.guard_invitation_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.accepted_at is not null then
    raise exception 'INVITATION_ALREADY_USED' using errcode = '23514';
  end if;
  if old.revoked_at is not null then
    raise exception 'INVITATION_REVOKED' using errcode = '23514';
  end if;
  if (new.email, new.space_id, new.invited_by, new.created_at)
      is distinct from (old.email, old.space_id, old.invited_by, old.created_at) then
    raise exception 'INVITATION_IMMUTABLE' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function app.guard_invitation_state() from public;

create trigger invitations_guard_state
before update on public.invitations
for each row execute function app.guard_invitation_state();

-- `invited_by` is always the caller on insert through PostgREST; a Space admin cannot attribute an
-- invitation (and its audit trail) to someone else. Service jobs (service_role / postgres) keep
-- what they pass.
create or replace function app.set_invitation_inviter()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and current_user = 'authenticated' then
    new.invited_by := (select auth.uid());
  end if;
  new.accepted_at := null;
  new.accepted_by := null;
  new.revoked_at := null;
  return new;
end;
$$;

revoke all on function app.set_invitation_inviter() from public;

create trigger invitations_set_inviter
before insert on public.invitations
for each row execute function app.set_invitation_inviter();

-- Admins may only rotate the token / extend the expiry (resend), change the role of a pending
-- invitation, or revoke it. Everything else is written by SECURITY DEFINER functions only.
revoke update on public.invitations from authenticated;
grant update (role, token_hash, expires_at, revoked_at) on public.invitations to authenticated;

-- ---------------------------------------------------------------------------
-- Invite page: preview + accept
-- ---------------------------------------------------------------------------

-- Invitation behind a raw token, for the `/invite/[token]` page. Zero rows when the token matches
-- nothing (or the Space is archived) — the caller maps that to INVITATION_NOT_FOUND. Any signed-in
-- user may call it: the 256-bit token itself is the secret, and only the Space name/icon, role,
-- invitee email and inviter name are exposed.
create or replace function public.get_invitation(p_token text)
returns table (
  invitation_id uuid,
  space_id uuid,
  space_slug text,
  space_name text,
  space_icon text,
  role public.space_role,
  email text,
  inviter_name text,
  inviter_email text,
  expires_at timestamptz,
  status text,
  email_matches boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id,
    s.id,
    s.slug::text,
    s.name,
    s.icon,
    i.role,
    i.email::text,
    inviter.full_name,
    inviter.email::text,
    i.expires_at,
    case
      when i.accepted_at is not null then 'accepted'
      when i.revoked_at is not null then 'revoked'
      when i.expires_at <= now() then 'expired'
      else 'pending'
    end,
    coalesce(lower(me.email::text) = lower(i.email::text), false)
  from public.invitations as i
  join public.spaces as s on s.id = i.space_id and s.archived_at is null
  left join public.profiles as inviter on inviter.id = i.invited_by
  left join public.profiles as me on me.id = (select auth.uid())
  where (select auth.uid()) is not null
    and i.token_hash = app.invitation_token_hash(p_token)
$$;

comment on function public.get_invitation(text) is
  'Preview of the invitation behind a raw token (invite page). Status: pending | accepted | revoked | expired.';

revoke all on function public.get_invitation(text) from public, anon;
grant execute on function public.get_invitation(text) to authenticated;

-- Accepts an invitation as the signed-in caller: single-use, not expired, not revoked, and only for
-- the invited email. Adds (or upgrades — never downgrades) the caller's membership with the
-- invited role, then marks the invitation accepted. Both writes fire the existing audit triggers
-- (`member.add` / `member.role_change`, `invitation.accept`) with the caller as actor.
-- Errors (message = code, for errors.<CODE>): UNAUTHORIZED, FORBIDDEN (deactivated),
-- INVITATION_NOT_FOUND, INVITATION_ALREADY_USED, INVITATION_REVOKED, INVITATION_EXPIRED,
-- INVITATION_EMAIL_MISMATCH.
create or replace function public.accept_invitation(p_token text)
returns table (space_id uuid, space_slug text, role public.space_role)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles%rowtype;
  v_invitation public.invitations%rowtype;
  v_slug text;
  v_role public.space_role;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles as p where p.id = v_uid;
  if not found or v_profile.deactivated_at is not null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- Row lock: two concurrent accepts of the same token serialize here, the second sees accepted_at.
  select i.* into v_invitation
  from public.invitations as i
  where i.token_hash = app.invitation_token_hash(p_token)
  for update;

  select s.slug::text into v_slug
  from public.spaces as s
  where s.id = v_invitation.space_id and s.archived_at is null;

  if v_invitation.id is null or v_slug is null then
    raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_invitation.accepted_at is not null then
    raise exception 'INVITATION_ALREADY_USED' using errcode = 'P0001';
  end if;
  if v_invitation.revoked_at is not null then
    raise exception 'INVITATION_REVOKED' using errcode = 'P0001';
  end if;
  if v_invitation.expires_at <= now() then
    raise exception 'INVITATION_EXPIRED' using errcode = 'P0001';
  end if;
  -- lower(): with search_path = '' the citext operators are not in scope, `=` would be text equality.
  if lower(v_profile.email::text) is distinct from lower(v_invitation.email::text) then
    raise exception 'INVITATION_EMAIL_MISMATCH' using errcode = 'P0001';
  end if;

  insert into public.space_members as m (space_id, user_id, role, added_by)
  values (v_invitation.space_id, v_uid, v_invitation.role, v_invitation.invited_by)
  on conflict on constraint space_members_pkey do update
    set role = excluded.role
    where m.role < excluded.role;

  select m.role into v_role
  from public.space_members as m
  where m.space_id = v_invitation.space_id and m.user_id = v_uid;

  update public.invitations
  set accepted_at = now(), accepted_by = v_uid
  where id = v_invitation.id;

  return query select v_invitation.space_id, v_slug, v_role;
end;
$$;

comment on function public.accept_invitation(text) is
  'Single-use acceptance of a Space invitation by the invited, signed-in user (T1.5a).';

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Member list + "add internal member" search (SECURITY INVOKER: RLS decides)
-- ---------------------------------------------------------------------------

-- Members of a Space the caller can view (empty otherwise), admins first, then by name/email.
-- Profile columns are null when `profiles_select` hides the member from the caller (e.g. a guest
-- member seen by an internal non-member of an `internal` Space).
create or replace function public.list_space_members(p_space_id uuid)
returns table (
  user_id uuid,
  role public.space_role,
  email text,
  full_name text,
  avatar_url text,
  is_guest boolean,
  added_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    m.user_id, m.role, p.email::text, p.full_name, p.avatar_url, p.is_guest,
    m.added_by, m.created_at, m.updated_at
  from public.space_members as m
  left join public.profiles as p on p.id = m.user_id
  where m.space_id = p_space_id
  order by
    case m.role when 'admin' then 0 when 'editor' then 1 else 2 end,
    lower(coalesce(p.full_name, p.email::text, '')),
    m.user_id
$$;

comment on function public.list_space_members(uuid) is
  'Members of a Space visible to the caller (RLS), admins first.';

revoke all on function public.list_space_members(uuid) from public, anon;
grant execute on function public.list_space_members(uuid) to authenticated;

-- Internal (non-guest, active) people who are not yet members of the Space, matching a name/email
-- fragment — accent- and case-insensitive ("nguyen" finds "Nguyễn"). Only a Space admin gets rows;
-- guests are never candidates (they join through an email invitation instead).
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

comment on function public.search_member_candidates(uuid, text, integer) is
  'Internal people not yet in the Space whose name/email contains p_query (accent-insensitive). Space admins only.';

revoke all on function public.search_member_candidates(uuid, text, integer) from public, anon;
grant execute on function public.search_member_candidates(uuid, text, integer) to authenticated;
