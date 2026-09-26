-- Google sign-in gate (GoTrue "before user created" hook) and profile bootstrap.
--
-- Two independent decisions, both derived from tables already owned by T1.1:
--   * app.before_user_created_hook: may this email create an `auth.users` row at all?
--     Allowed when the email/domain is in `access_allowlist`, or a pending invitation exists.
--   * app.handle_new_user: once the row exists, create the matching `public.profiles` row.
--     `is_guest` is derived the same way the hook decided (not on the allowlist ⇒ came in
--     through an invitation ⇒ guest). `is_super_admin` is granted once, on first insert, to
--     emails listed in `app_settings.bootstrap_admin_emails` (populated at runtime from the
--     `BOOTSTRAP_SUPER_ADMIN_EMAILS` env var by the web server — see apps/web/src/server/auth).

create or replace function app.before_user_created_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email extensions.citext := (event -> 'user' ->> 'email')::extensions.citext;
  v_domain extensions.citext;
begin
  if v_email is null then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'AUTH_NOT_ALLOWED'));
  end if;

  v_domain := split_part(v_email::text, '@', 2)::extensions.citext;

  if exists (
       select 1 from public.access_allowlist
       where (kind = 'email' and value = v_email)
          or (kind = 'domain' and value = v_domain)
     )
     or exists (
       select 1 from public.invitations
       where email = v_email
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

comment on function app.before_user_created_hook(jsonb) is
  'GoTrue "before user created" hook (config.toml auth.hook.before_user_created). '
  'Rejects sign-up for emails outside access_allowlist with no pending invitation.';

revoke all on function app.before_user_created_hook(jsonb) from public;
grant usage on schema app to supabase_auth_admin;
grant execute on function app.before_user_created_hook(jsonb) to supabase_auth_admin;

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain extensions.citext := split_part(new.email::text, '@', 2)::extensions.citext;
  v_is_guest boolean;
  v_is_super_admin boolean;
  v_full_name text;
  v_avatar_url text;
begin
  v_is_guest := not exists (
    select 1 from public.access_allowlist
    where (kind = 'email' and value = new.email::extensions.citext)
       or (kind = 'domain' and value = v_domain)
  );

  v_is_super_admin := exists (
    select 1
    from public.app_settings, unnest(bootstrap_admin_emails) as bootstrap(email)
    where app_settings.id = 1
      and bootstrap.email = new.email::extensions.citext
  );

  v_full_name := coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name');
  v_avatar_url := coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture');

  insert into public.profiles (id, email, full_name, avatar_url, is_guest, is_super_admin)
  values (new.id, new.email, v_full_name, v_avatar_url, v_is_guest, v_is_super_admin)
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function app.handle_new_user() is
  'Creates the profiles row right after Supabase Auth inserts into auth.users. '
  'Fires once per user (auth.users.id never changes), so it never overwrites an existing profile.';

create trigger auth_users_create_profile
after insert on auth.users
for each row execute function app.handle_new_user();

-- app.has_active_access: re-checked on every request by the middleware (see
-- apps/web/src/lib/supabase/middleware.ts), because `before_user_created_hook` only runs once, at
-- sign-up. If an admin later removes the caller's email/domain from `access_allowlist`, this must
-- start returning false so the middleware can sign the session out — unless the caller kept access
-- another way: an accepted Space invitation (a `space_members` row) or super admin. A pending,
-- not-yet-accepted invitation does not count; only membership does.
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
        or exists (
          select 1
          from public.access_allowlist as a
          where (a.kind = 'email' and a.value = p.email)
             or (a.kind = 'domain' and a.value = split_part(p.email::text, '@', 2)::extensions.citext)
        )
        or exists (
          select 1 from public.space_members as m where m.user_id = p.id
        )
      )
  )
$$;

comment on function app.has_active_access() is
  'Session-level access re-check (T1.2a). True when the signed-in caller may keep using their '
  'session right now: not deactivated, and still allowlisted, a super admin, or an active member '
  'of at least one Space. Called by the middleware on every request as the caller (not '
  'service_role), so it only ever answers for `auth.uid()` itself.';

revoke all on function app.has_active_access() from public;
grant execute on function app.has_active_access() to authenticated;
