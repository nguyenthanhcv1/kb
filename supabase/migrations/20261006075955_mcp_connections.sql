-- MCP connector: AI assistants (Claude, ChatGPT, …) read and edit the knowledge base for a user.
--
-- kb-web serves an MCP endpoint (`/api/mcp`) protected by OAuth 2.1 (authorization code + PKCE,
-- dynamic client registration) and by personal access tokens. Every tool call runs with a
-- short-lived Supabase JWT of the user, so RLS decides exactly as in the app; content changes
-- still go through kb-collab. These tables only hold who may connect:
--   * mcp_clients      — OAuth clients registered by the assistants (RFC 7591), public clients.
--   * mcp_connections  — one grant of a user to a client (or a personal token): scope, revocation.
--   * mcp_tokens       — sha256 of authorization codes, access and refresh tokens of a connection.
--
-- Raw tokens are never stored. Tokens are verified by kb-web with service_role (before a user
-- session exists — the reason service_role is needed here); users list and revoke their own
-- connections through RLS. Connecting and revoking are audited (`mcp.connect`, `mcp.revoke`).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.mcp_clients (
  id uuid primary key default gen_random_uuid(),
  client_name text not null check (char_length(client_name) between 1 and 200),
  redirect_uris text[] not null
    check (cardinality(redirect_uris) between 1 and 10),
  created_at timestamptz not null default now(),
  -- First time a user approved this client; registrations nobody ever approved are purged.
  last_authorized_at timestamptz
);

comment on table public.mcp_clients is
  'OAuth clients of the MCP connector (dynamic client registration, public clients with PKCE).';

create index mcp_clients_unused_idx on public.mcp_clients (created_at)
  where last_authorized_at is null;

create table public.mcp_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- null = personal access token created in Settings.
  client_id uuid references public.mcp_clients (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  scope text not null check (scope in ('read', 'write')),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  -- Personal tokens only; OAuth connections live as long as their refresh token is renewed.
  expires_at timestamptz,
  revoked_at timestamptz
);

comment on table public.mcp_connections is
  'A user''s grant to an AI assistant (OAuth client) or a personal access token of the MCP connector.';

create index mcp_connections_user_idx on public.mcp_connections (user_id, created_at desc);
create index mcp_connections_client_idx on public.mcp_connections (client_id);

create table public.mcp_tokens (
  -- sha256 (hex) of the raw token; see hashToken() in apps/web/src/server/mcp/tokens.ts.
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  connection_id uuid not null references public.mcp_connections (id) on delete cascade,
  kind text not null check (kind in ('code', 'access', 'refresh')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- Codes and refresh tokens are single-use (refresh tokens rotate).
  used_at timestamptz,
  -- Authorization codes: PKCE S256 challenge and the redirect URI they were issued for.
  code_challenge text,
  redirect_uri text,
  check (kind <> 'code' or (code_challenge is not null and redirect_uri is not null))
);

comment on table public.mcp_tokens is
  'Hashed OAuth codes / access / refresh tokens of MCP connections. Only kb-web (service_role).';

create index mcp_tokens_connection_idx on public.mcp_tokens (connection_id);
create index mcp_tokens_expires_idx on public.mcp_tokens (expires_at);

-- ---------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------

alter table public.mcp_clients enable row level security;
alter table public.mcp_connections enable row level security;
alter table public.mcp_tokens enable row level security;

revoke all on public.mcp_clients, public.mcp_connections, public.mcp_tokens
  from anon, authenticated;
grant all on public.mcp_clients, public.mcp_connections, public.mcp_tokens to service_role;

-- Clients: what an assistant registered is not secret but not the users' business either.
create policy mcp_clients_select_super_admin on public.mcp_clients
for select to authenticated
using (app.is_super_admin());
grant select on public.mcp_clients to authenticated;

-- Connections: everyone sees and revokes their own (Settings › AI assistants).
create policy mcp_connections_select_own on public.mcp_connections
for select to authenticated
using (user_id = (select auth.uid()));

create policy mcp_connections_revoke_own on public.mcp_connections
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

grant select on public.mcp_connections to authenticated;
grant update (revoked_at) on public.mcp_connections to authenticated;

-- Tokens: never readable by clients (explicit deny; service_role bypasses RLS).
create policy mcp_tokens_no_client_access on public.mcp_tokens
for all to authenticated
using (false)
with check (false);

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

-- A revoked connection stays revoked, and only `revoked_at` / `last_used_at` / `scope` change
-- after creation (scope: an assistant re-authorized with a different scope).
create or replace function app.guard_mcp_connection()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'MCP_CONNECTION_REVOKED' using errcode = '23514';
  end if;
  if (new.user_id, new.client_id, new.created_at)
      is distinct from (old.user_id, old.client_id, old.created_at) then
    raise exception 'MCP_CONNECTION_IMMUTABLE' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger mcp_connections_guard
before update on public.mcp_connections
for each row execute function app.guard_mcp_connection();

-- At most 50 active connections per user (personal tokens and assistants together).
create or replace function app.limit_mcp_connections()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*)
    from public.mcp_connections as c
    where c.user_id = new.user_id
      and c.revoked_at is null
      and (c.expires_at is null or c.expires_at > now())
  ) >= 50 then
    raise exception 'MCP_CONNECTION_LIMIT' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger mcp_connections_limit
before insert on public.mcp_connections
for each row execute function app.limit_mcp_connections();

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

-- kb-web writes connections with service_role on behalf of the user, so the actor falls back to
-- the connection's user when there is no JWT user.
create or replace function app.audit_mcp_connections()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'mcp.connect';
  elsif old.revoked_at is null and new.revoked_at is not null then
    v_action := 'mcp.revoke';
  elsif new.scope is distinct from old.scope then
    v_action := 'mcp.update';
  else
    return new;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, space_id, metadata, request_id)
  values (
    coalesce(app.actor_id(), new.user_id), v_action, 'mcp_connection', new.id, null,
    jsonb_build_object(
      'user_id', new.user_id,
      'name', new.name,
      'scope', new.scope,
      'client_id', new.client_id,
      'personal_token', new.client_id is null
    ),
    app.request_id()
  );
  return new;
end;
$$;

create trigger mcp_connections_audit
after insert or update on public.mcp_connections
for each row execute function app.audit_mcp_connections();

-- ---------------------------------------------------------------------------
-- Page role for server code
-- ---------------------------------------------------------------------------

-- kb-collab's replace API trusts kb-web, so the connector checks edit rights first. PostgREST
-- only exposes `public`: this wrapper answers app.page_role() for the caller (auth.uid()) only.
create or replace function public.my_page_role(p_page_id uuid)
returns public.space_role
language sql
stable
security invoker
set search_path = ''
as $$
  select app.page_role(p_page_id)
$$;

comment on function public.my_page_role(uuid) is
  'Role of the current user on a page (null = no access); PostgREST entry point of app.page_role().';

revoke all on function public.my_page_role(uuid) from public, anon;
grant execute on function public.my_page_role(uuid) to authenticated, service_role;
