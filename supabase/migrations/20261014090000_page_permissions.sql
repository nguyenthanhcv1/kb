-- Page sharing: give one person access to one page (and its subpages) without making them a
-- member of the whole Space — typically an external guest who should read a few pages only.
--
-- Design (docs/PLAN.md §3.4 "V2 page permissions", additive only):
--   * `page_permissions (page_id, user_id, role)`, role `viewer` or `editor` — a share never makes
--     anyone admin. A share on a page also covers every subpage (nearest-ancestor walk); there is
--     no "deny": the effective role on a page is the HIGHEST of the Space role and the shares on
--     the page or its ancestors. `pages.inherit_permissions` stays unused (restricting is not
--     part of this).
--   * Still one place decides: `app.user_page_role()` (and `app.page_row_role()` for the pages
--     policies). Every policy that already goes through them — pages, page_documents,
--     page_versions, page_search, attachments + storage objects — and kb-collab's
--     `authorize_document` follow without change. Shares only count on live pages of active
--     Spaces and for active accounts; trashed pages stay reserved to Space editors/admins.
--   * A page editor by share edits the content and the title/icon of the shared pages; moving,
--     trashing and creating pages still need edit rights on the Space (`pages_0_guard_shared_edit`).
--   * Only Space admins share (and see who a page is shared with); a person may remove their own
--     share ("leave"). Sharing by email: `public.share_page` grants at once when the email has an
--     account; otherwise kb-web creates an invitation tied to the page (`invitations.page_id`),
--     which reuses the whole invite flow (sign-up exemption, `/invite/<token>`, rate limit, audit).
--   * Someone who only reaches pages through shares sees the name of those Spaces (`spaces_select`)
--     so links and breadcrumbs resolve, but nothing else of the Space (members, other pages).
--   * Audited as `page.share`, `page.share_role_change`, `page.unshare` (Space scope).

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.page_permissions (
  page_id uuid not null references public.pages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.space_role not null check (role in ('viewer', 'editor')),
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (page_id, user_id)
);

comment on table public.page_permissions is
  'Page shares: role of a person on a page and its subpages, on top of their Space role.';

-- "What is shared with me?" and the cheap "has this person any share at all?" check.
create index page_permissions_user_idx on public.page_permissions (user_id);

create trigger page_permissions_touch_updated_at
before update on public.page_permissions
for each row execute function app.touch_updated_at();

-- Through PostgREST the sharer is always the caller; SECURITY DEFINER callers
-- (`accept_invitation`) keep what they pass (the person who sent the invitation).
create or replace function app.set_page_permission_granter()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    new.granted_by := (select auth.uid());
  end if;
  return new;
end;
$$;

create trigger page_permissions_set_granter
before insert on public.page_permissions
for each row execute function app.set_page_permission_granter();

-- ---------------------------------------------------------------------------
-- Permission helpers
-- ---------------------------------------------------------------------------

-- Highest share of an active person on a page or any of its ancestors (null = none). Starts with
-- a cheap "has any share" check so people without shares never walk the tree.
create or replace function app.user_page_grant_role(p_page_id uuid, p_user_id uuid)
returns public.space_role
language sql
stable
security definer
set search_path = ''
as $$
  with recursive chain as (
    select pg.id, pg.parent_id, 1 as depth
    from public.pages as pg
    where pg.id = p_page_id
      and exists (select 1 from public.page_permissions as any_share where any_share.user_id = p_user_id)
      and exists (
        select 1 from public.profiles as pr
        where pr.id = p_user_id and pr.deactivated_at is null and pr.status = 'active'
      )
    union all
    select p.id, p.parent_id, c.depth + 1
    from public.pages as p
    join chain as c on p.id = c.parent_id
    where c.depth < 64
  )
  select max(pp.role)
  from chain as c
  join public.page_permissions as pp on pp.page_id = c.id and pp.user_id = p_user_id
$$;

comment on function app.user_page_grant_role(uuid, uuid) is
  'Highest page share of an active user on a page or its ancestors; null when none.';

-- Role of a user on a page: the Space role, raised by shares on live pages of active Spaces.
-- Trashed pages: Space editors/admins only (shares do not reach the trash).
create or replace function app.user_page_role(p_page_id uuid, p_user_id uuid)
returns public.space_role
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when pg.deleted_at is not null then
      case when r.role in ('editor'::public.space_role, 'admin'::public.space_role) then r.role end
    -- A share is at most editor: nothing to raise.
    when r.role in ('editor'::public.space_role, 'admin'::public.space_role) then r.role
    when s.archived_at is not null then null
    else greatest(r.role, app.user_page_grant_role(pg.id, p_user_id))
  end
  from public.pages as pg
  join public.spaces as s on s.id = pg.space_id
  cross join lateral (select app.user_space_role(pg.space_id, p_user_id) as role) as r
  where pg.id = p_page_id
$$;

comment on function app.user_page_role(uuid, uuid) is
  'Role of a user on a page: highest of the Space role and page shares (page or ancestor); '
  'trashed pages: Space editors/admins only.';

comment on function app.page_role(uuid) is
  'Role of the current user on a page (Space role raised by page shares; trashed pages: editors/admins only).';

-- Same decision from a pages row (live rows only — the pages policies handle the trash).
create or replace function app.page_row_role(p_space_id uuid, p_page_id uuid)
returns public.space_role
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when r.role in ('editor'::public.space_role, 'admin'::public.space_role) then r.role
    when not exists (
      select 1 from public.spaces as s where s.id = p_space_id and s.archived_at is null
    ) then null
    else greatest(r.role, app.user_page_grant_role(p_page_id, (select auth.uid())))
  end
  from (select app.user_space_role(p_space_id, (select auth.uid())) as role) as r
$$;

-- Space admins (and super admins) share the live pages of their Space.
create or replace function app.can_share_page(p_page_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select app.is_space_admin(pg.space_id)
    from public.pages as pg
    where pg.id = p_page_id and pg.deleted_at is null
  ), false)
$$;

comment on function app.can_share_page(uuid) is
  'True when the current user may share the page (admin of its Space, page not trashed).';

-- Live pages the current user reaches through shares: the shared pages and all their subpages.
create or replace function app.my_shared_page_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with recursive tree as (
    select pg.id, 1 as depth
    from public.page_permissions as pp
    join public.pages as pg on pg.id = pp.page_id and pg.deleted_at is null
    join public.spaces as s on s.id = pg.space_id and s.archived_at is null
    join public.profiles as pr on pr.id = pp.user_id
      and pr.deactivated_at is null and pr.status = 'active'
    where pp.user_id = (select auth.uid())
    union all
    select child.id, t.depth + 1
    from public.pages as child
    join tree as t on child.parent_id = t.id
    where child.deleted_at is null and t.depth < 64
  )
  select distinct id from tree
$$;

comment on function app.my_shared_page_ids() is
  'Live pages (with subpages) shared with the current user, in active Spaces.';

-- Does the current user reach some live page of this (active) Space through a share?
create or replace function app.has_shared_page_in_space(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.page_permissions as pp
    join public.pages as pg on pg.id = pp.page_id and pg.deleted_at is null
    join public.spaces as s on s.id = pg.space_id and s.archived_at is null
    join public.profiles as pr on pr.id = pp.user_id
      and pr.deactivated_at is null and pr.status = 'active'
    where pp.user_id = (select auth.uid())
      and pg.space_id = p_space_id
  )
$$;

-- A session stays alive for someone whose only access is a page share.
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
        or exists (select 1 from public.page_permissions as pp where pp.user_id = p.id)
        or app.has_pending_invitation(p.email)
      )
  )
$$;

-- ---------------------------------------------------------------------------
-- Policies of existing tables
-- ---------------------------------------------------------------------------

-- The name/slug/icon of a Space is visible to whoever reaches one of its pages through a share
-- (page URLs and breadcrumbs carry the Space). Members, groups etc. still need can_view_space.
drop policy spaces_select on public.spaces;
create policy spaces_select on public.spaces
for select to authenticated
using (app.can_view_space(id) or app.has_shared_page_in_space(id));

-- An editor by share may update a shared page (title/icon — the guard below keeps the rest).
drop policy pages_update on public.pages;
create policy pages_update on public.pages
for update to authenticated
using (
  app.can_edit_space(space_id)
  or (deleted_at is null and app.page_row_role(space_id, id) = 'editor'::public.space_role)
)
with check (
  app.can_edit_space(space_id)
  or (deleted_at is null and app.page_row_role(space_id, id) = 'editor'::public.space_role)
);

-- Without edit rights on the Space, only title, icon and cover change: no move, trash or
-- ownership change. Fires first among the BEFORE UPDATE triggers (name order).
create or replace function app.guard_shared_page_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Nested IFs: only `authenticated` may call app.can_edit_space (kb_collab bumps last_edited_*).
  if current_user = 'authenticated' and not app.in_page_cascade() then
    if (new.space_id, new.parent_id, new.position, new.deleted_at, new.owner_id)
         is distinct from (old.space_id, old.parent_id, old.position, old.deleted_at, old.owner_id)
       and not coalesce(app.can_edit_space(old.space_id), false)
    then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger pages_0_guard_shared_edit
before update on public.pages
for each row execute function app.guard_shared_page_edit();

-- ---------------------------------------------------------------------------
-- RLS of page_permissions
-- ---------------------------------------------------------------------------

alter table public.page_permissions enable row level security;

create policy page_permissions_select on public.page_permissions
for select to authenticated
using (user_id = (select auth.uid()) or app.can_share_page(page_id));

create policy page_permissions_insert on public.page_permissions
for insert to authenticated
with check (app.can_share_page(page_id));

create policy page_permissions_update on public.page_permissions
for update to authenticated
using (app.can_share_page(page_id))
with check (app.can_share_page(page_id));

-- Space admins remove shares; anyone may drop their own.
create policy page_permissions_delete on public.page_permissions
for delete to authenticated
using (user_id = (select auth.uid()) or app.can_share_page(page_id));

revoke all on public.page_permissions from anon, authenticated, service_role;
grant select, delete on public.page_permissions to authenticated;
grant insert (page_id, user_id, role) on public.page_permissions to authenticated;
grant update (role) on public.page_permissions to authenticated;
grant select, insert, update, delete on public.page_permissions to service_role;

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

create or replace function app.audit_page_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.page_permissions := case when tg_op = 'DELETE' then old else new end;
  v_page public.pages%rowtype;
  v_email text;
begin
  select * into v_page from public.pages as pg where pg.id = v_row.page_id;
  -- The page itself is being purged: `page.purge` already says so.
  if v_page.id is null then
    return v_row;
  end if;
  select p.email::text into v_email from public.profiles as p where p.id = v_row.user_id;

  if tg_op = 'INSERT' then
    perform app.write_audit('page.share', 'page', v_page.id, v_page.space_id,
      jsonb_build_object('title', v_page.title, 'user_id', v_row.user_id, 'email', v_email,
                         'role', v_row.role));
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      perform app.write_audit('page.share_role_change', 'page', v_page.id, v_page.space_id,
        jsonb_build_object('title', v_page.title, 'user_id', v_row.user_id, 'email', v_email,
                           'from_role', old.role, 'to_role', new.role));
    end if;
  else
    perform app.write_audit('page.unshare', 'page', v_page.id, v_page.space_id,
      jsonb_build_object('title', v_page.title, 'user_id', v_row.user_id, 'email', v_email,
                         'role', v_row.role, 'self', v_row.user_id = app.actor_id()));
  end if;
  return v_row;
end;
$$;

create trigger page_permissions_audit
after insert or update or delete on public.page_permissions
for each row execute function app.audit_page_permissions();

-- ---------------------------------------------------------------------------
-- Invitations tied to a page
-- ---------------------------------------------------------------------------

alter table public.invitations
  add column page_id uuid references public.pages (id) on delete cascade;

comment on column public.invitations.page_id is
  'Set for a page share invitation: accepting grants a page share instead of Space membership. '
  'space_id is then the Space of the page when it was sent (who may manage the invitation).';

create index invitations_page_idx on public.invitations (page_id) where page_id is not null;

-- A page invitation belongs to the Space of its page (so its admins manage it, RLS on space_id).
create or replace function app.invitations_page_space()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space_id uuid;
begin
  if new.page_id is not null then
    select pg.space_id into v_space_id
    from public.pages as pg
    where pg.id = new.page_id and pg.deleted_at is null;
    if v_space_id is null then
      raise exception 'PAGE_NOT_FOUND' using errcode = 'P0002';
    end if;
    new.space_id := v_space_id;
  end if;
  return new;
end;
$$;

create trigger invitations_0_page_space
before insert on public.invitations
for each row execute function app.invitations_page_space();

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
  if (new.email, new.space_id, new.page_id, new.invited_by, new.created_at)
      is distinct from (old.email, old.space_id, old.page_id, old.invited_by, old.created_at) then
    raise exception 'INVITATION_IMMUTABLE' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Page invitations carry the page in the audit trail.
create or replace function app.audit_invitations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page jsonb := '{}'::jsonb;
begin
  if new.page_id is not null then
    select jsonb_build_object('page_id', pg.id, 'title', pg.title) into v_page
    from public.pages as pg where pg.id = new.page_id;
    v_page := coalesce(v_page, '{}'::jsonb);
  end if;

  -- token_hash is never copied into the audit trail.
  if tg_op = 'INSERT' then
    perform app.write_audit('invitation.create', 'invitation', new.id, new.space_id,
      jsonb_build_object('email', new.email, 'role', new.role, 'expires_at', new.expires_at) || v_page);
    return new;
  end if;

  if old.revoked_at is null and new.revoked_at is not null then
    perform app.write_audit('invitation.revoke', 'invitation', new.id, new.space_id,
      jsonb_build_object('email', new.email, 'role', new.role) || v_page);
  end if;
  if old.accepted_at is null and new.accepted_at is not null then
    perform app.write_audit('invitation.accept', 'invitation', new.id, new.space_id,
      jsonb_build_object('email', new.email, 'role', new.role, 'user_id', new.accepted_by) || v_page);
  end if;
  return new;
end;
$$;

-- Invite page preview, now with the page of a page invitation (a trashed page = not found).
drop function public.get_invitation(text);
create function public.get_invitation(p_token text)
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
  email_matches boolean,
  page_id uuid,
  page_short_id text,
  page_slug text,
  page_title text,
  page_icon text
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
    coalesce(lower(me.email::text) = lower(i.email::text), false),
    pg.id,
    pg.short_id,
    pg.slug,
    pg.title,
    pg.icon
  from public.invitations as i
  left join public.pages as pg on pg.id = i.page_id
  join public.spaces as s
    on s.id = coalesce(pg.space_id, i.space_id) and s.archived_at is null
  left join public.profiles as inviter on inviter.id = i.invited_by
  left join public.profiles as me on me.id = (select auth.uid())
  where (select auth.uid()) is not null
    and i.token_hash = app.invitation_token_hash(p_token)
    and (i.page_id is null or pg.deleted_at is null)
$$;

comment on function public.get_invitation(text) is
  'Preview of the invitation behind a raw token (invite page). Status: pending | accepted | revoked | expired. '
  'page_* is set for a page share invitation.';

revoke all on function public.get_invitation(text) from public, anon;
grant execute on function public.get_invitation(text) to authenticated;

-- Accepting a page invitation grants a page share (raised, never lowered) instead of membership.
drop function public.accept_invitation(text);
create function public.accept_invitation(p_token text)
returns table (
  space_id uuid,
  space_slug text,
  role public.space_role,
  page_id uuid,
  page_short_id text,
  page_slug text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles%rowtype;
  v_invitation public.invitations%rowtype;
  v_page public.pages%rowtype;
  v_space_id uuid;
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

  v_space_id := v_invitation.space_id;
  if v_invitation.page_id is not null then
    select pg.* into v_page from public.pages as pg where pg.id = v_invitation.page_id;
    v_space_id := case when v_page.deleted_at is null then v_page.space_id end;
  end if;

  select s.slug::text into v_slug
  from public.spaces as s
  where s.id = v_space_id and s.archived_at is null;

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

  if v_invitation.page_id is not null then
    insert into public.page_permissions as pp (page_id, user_id, role, granted_by)
    values (v_page.id, v_uid, v_invitation.role, v_invitation.invited_by)
    on conflict on constraint page_permissions_pkey do update
      set role = excluded.role
      where pp.role < excluded.role;

    select pp.role into v_role
    from public.page_permissions as pp
    where pp.page_id = v_page.id and pp.user_id = v_uid;
  else
    insert into public.space_members as m (space_id, user_id, role, added_by)
    values (v_invitation.space_id, v_uid, v_invitation.role, v_invitation.invited_by)
    on conflict on constraint space_members_pkey do update
      set role = excluded.role
      where m.role < excluded.role;

    select m.role into v_role
    from public.space_members as m
    where m.space_id = v_invitation.space_id and m.user_id = v_uid;
  end if;

  update public.invitations
  set accepted_at = now(), accepted_by = v_uid
  where id = v_invitation.id;

  return query select v_space_id, v_slug, v_role, v_page.id, v_page.short_id, v_page.slug;
end;
$$;

comment on function public.accept_invitation(text) is
  'Single-use acceptance of an invitation by the invited, signed-in user: Space membership, or a '
  'page share for a page invitation.';

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Search: shared pages are searchable by the people they are shared with
-- ---------------------------------------------------------------------------

create or replace function app.search_ranked(
  p_ts tsquery,
  p_exact tsquery,
  p_phrase tsquery,
  p_norm text,
  p_trgm boolean,
  p_space_ids uuid[],
  p_limit integer,
  p_offset integer
)
returns table (
  page_id uuid,
  space_id uuid,
  title text,
  last_edited_at timestamptz,
  score real
)
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select s.id
    from public.spaces as s
    where (p_space_ids is null or s.id = any (p_space_ids))
      and app.can_view_space(s.id)
  )
  select
    ps.page_id,
    ps.space_id,
    ps.title,
    ps.last_edited_at,
    (
      case when p_ts is not null then ts_rank_cd(ps.tsv, p_ts, 32) else 0 end
      + case when p_exact is not null then 0.5 * ts_rank_cd(ps.tsv_exact, p_exact, 32) else 0 end
      + case when p_phrase is not null and ps.tsv @@ p_phrase then 0.4 else 0 end
      + 0.3 * extensions.similarity(ps.title_norm, p_norm)
      + 0.05 * exp(-extract(epoch from now() - ps.last_edited_at) / 86400.0 / 180.0)
    )::real as score
  from public.page_search as ps
  where (
      ps.space_id = any (array(select v.id from visible as v))
      or (
        (p_space_ids is null or ps.space_id = any (p_space_ids))
        and ps.page_id = any (array(select app.my_shared_page_ids()))
      )
    )
    and not ps.is_deleted
    and ((p_ts is not null and ps.tsv @@ p_ts) or (p_trgm and ps.title_norm operator(extensions.%) p_norm))
  order by score desc, ps.page_id
  limit p_limit offset p_offset
$$;

comment on function app.search_ranked(tsquery, tsquery, tsquery, text, boolean, uuid[], integer, integer) is
  'Index-backed matching + ranking for public.search_pages() (docs/PLAN.md §4.4). Only Spaces the '
  'caller can view and pages shared with them.';

-- ---------------------------------------------------------------------------
-- Reads and writes for the screens
-- ---------------------------------------------------------------------------

-- Who a page is shared with: shares on the page itself and those inherited from its ancestors
-- (`inherited`, with the page they come from). Space admins only — guests are invisible to them
-- through `profiles_select`, so this is SECURITY DEFINER.
create or replace function public.list_page_shares(p_page_id uuid)
returns table (
  user_id uuid,
  email text,
  full_name text,
  avatar_url text,
  is_guest boolean,
  role public.space_role,
  source_page_id uuid,
  source_page_title text,
  inherited boolean,
  granted_by uuid,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not app.can_share_page(p_page_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return query
  with recursive chain as (
    select pg.id, pg.parent_id, pg.title, 0 as depth
    from public.pages as pg
    where pg.id = p_page_id
    union all
    select p.id, p.parent_id, p.title, c.depth + 1
    from public.pages as p
    join chain as c on p.id = c.parent_id
    where c.depth < 64
  )
  select
    pp.user_id,
    pr.email::text,
    pr.full_name,
    pr.avatar_url,
    pr.is_guest,
    pp.role,
    c.id,
    c.title,
    c.depth > 0,
    pp.granted_by,
    pp.created_at
  from chain as c
  join public.page_permissions as pp on pp.page_id = c.id
  join public.profiles as pr on pr.id = pp.user_id
  order by c.depth, lower(coalesce(pr.full_name, pr.email::text)), pp.user_id;
end;
$$;

comment on function public.list_page_shares(uuid) is
  'Shares of a page and of its ancestors (inherited), with the person. Space admins only.';

-- Shares a page with the account of `p_email`, or reports that there is none (kb-web then sends a
-- page invitation). Sets the role of an existing share on this page (up or down).
-- Errors: FORBIDDEN (not a Space admin / page trashed), VALIDATION_FAILED (role),
-- PAGE_SHARE_USER_INACTIVE (locked or rejected account).
create or replace function public.share_page(
  p_page_id uuid,
  p_email text,
  p_role public.space_role
)
returns table (
  status text,
  user_id uuid,
  role public.space_role,
  full_name text,
  locale text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile public.profiles%rowtype;
begin
  if not app.can_share_page(p_page_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('viewer'::public.space_role, 'editor'::public.space_role) then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  select * into v_profile
  from public.profiles as p
  where lower(p.email::text) = lower(btrim(coalesce(p_email, '')));

  if v_profile.id is null then
    return query select 'no_account'::text, null::uuid, p_role, null::text, null::text;
    return;
  end if;
  if v_profile.deactivated_at is not null or v_profile.status = 'rejected' then
    raise exception 'PAGE_SHARE_USER_INACTIVE' using errcode = 'P0001';
  end if;

  insert into public.page_permissions as pp (page_id, user_id, role, granted_by)
  values (p_page_id, v_profile.id, p_role, (select auth.uid()))
  on conflict on constraint page_permissions_pkey do update
    set role = excluded.role
    where pp.role is distinct from excluded.role;

  return query select 'granted'::text, v_profile.id, p_role, v_profile.full_name, v_profile.locale;
end;
$$;

comment on function public.share_page(uuid, text, public.space_role) is
  'Space admins: share a page with the account of an email (status granted) or report no_account.';

-- Pages shared directly with the current user (live pages, active Spaces), newest share first.
create or replace function public.list_shared_with_me()
returns table (
  page_id uuid,
  short_id text,
  slug text,
  title text,
  icon text,
  space_id uuid,
  space_slug text,
  space_name text,
  space_icon text,
  role public.space_role,
  shared_at timestamptz,
  has_children boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    pg.id,
    pg.short_id,
    pg.slug,
    pg.title,
    pg.icon,
    s.id,
    s.slug::text,
    s.name,
    s.icon,
    pp.role,
    pp.created_at,
    exists (select 1 from public.pages as c where c.parent_id = pg.id and c.deleted_at is null)
  from public.page_permissions as pp
  join public.pages as pg on pg.id = pp.page_id and pg.deleted_at is null
  join public.spaces as s on s.id = pg.space_id and s.archived_at is null
  join public.profiles as pr on pr.id = pp.user_id
    and pr.deactivated_at is null and pr.status = 'active'
  where pp.user_id = (select auth.uid())
  order by pp.created_at desc, pg.id
$$;

comment on function public.list_shared_with_me() is
  'Live pages shared directly with the caller, with their Space, newest first.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function app.set_page_permission_granter() from public;
revoke all on function app.user_page_grant_role(uuid, uuid) from public;
revoke all on function app.can_share_page(uuid) from public;
revoke all on function app.my_shared_page_ids() from public;
revoke all on function app.has_shared_page_in_space(uuid) from public;
revoke all on function app.guard_shared_page_edit() from public;
revoke all on function app.audit_page_permissions() from public;
revoke all on function app.invitations_page_space() from public;
revoke all on function public.list_page_shares(uuid) from public, anon;
revoke all on function public.share_page(uuid, text, public.space_role) from public, anon;
revoke all on function public.list_shared_with_me() from public, anon;

grant execute on function app.user_page_grant_role(uuid, uuid) to service_role;
grant execute on function app.can_share_page(uuid) to authenticated, service_role;
grant execute on function app.my_shared_page_ids() to authenticated, service_role;
grant execute on function app.has_shared_page_in_space(uuid) to authenticated, service_role;
grant execute on function public.list_page_shares(uuid) to authenticated;
grant execute on function public.share_page(uuid, text, public.space_role) to authenticated;
grant execute on function public.list_shared_with_me() to authenticated;
