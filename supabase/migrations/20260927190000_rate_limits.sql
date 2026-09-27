-- Rate limits enforced in the database (task T7.2, docs/runbooks/security.md).
--
-- Counters live in Postgres, not in kb-web memory: they hold across web instances and restarts,
-- and a limit guards the table itself, whatever code path writes to it. Fixed windows per
-- (bucket, user): `app.consume_rate_limit()` counts one hit and raises `RATE_LIMITED` once the
-- caller is over the limit. The table sits in schema `app` (not exposed by PostgREST) with no
-- grant to any client role; only SECURITY DEFINER functions touch it.
--
-- Limits applied here: invitations (send + resend) per admin. Search (T5.2) calls
-- `app.consume_rate_limit('search', …)` from its RPC.

create table app.rate_limit_hits (
  bucket text not null check (bucket ~ '^[a-z]+(_[a-z]+)*(\.[a-z]+(_[a-z]+)*)*$'),
  subject uuid not null,
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (bucket, subject, window_start)
);

comment on table app.rate_limit_hits is
  'Fixed-window rate limit counters per (bucket, user). Written only by app.consume_rate_limit().';

create index rate_limit_hits_window_idx on app.rate_limit_hits (window_start);

-- Not reachable through PostgREST, but keep RLS on (AGENTS.md §4) — no policy = no client access.
alter table app.rate_limit_hits enable row level security;
revoke all on app.rate_limit_hits from public, anon, authenticated, service_role;

-- Counts one hit of the current actor (auth.uid(), else app.actor_id) in `p_bucket` and raises
-- RATE_LIMITED (errcode P0001, HINT = seconds until the window resets) above `p_limit` hits per
-- `p_window`. No actor (migrations, superuser maintenance) = not limited.
create or replace function app.consume_rate_limit(p_bucket text, p_limit integer, p_window interval)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_subject uuid := app.actor_id();
  v_window_seconds double precision := extract(epoch from p_window);
  v_start timestamptz;
  v_hits integer;
begin
  if v_subject is null then
    return;
  end if;
  if p_limit < 1 or v_window_seconds <= 0 then
    raise exception 'invalid rate limit % / %', p_limit, p_window using errcode = '22023';
  end if;

  v_start := to_timestamp(floor(extract(epoch from now()) / v_window_seconds) * v_window_seconds);

  -- Self-cleaning (no scheduled job): finished windows of this caller and bucket go away.
  delete from app.rate_limit_hits
  where bucket = p_bucket and subject = v_subject and window_start < v_start;

  insert into app.rate_limit_hits as h (bucket, subject, window_start, hits)
  values (p_bucket, v_subject, v_start, 1)
  on conflict (bucket, subject, window_start) do update set hits = h.hits + 1
  returning h.hits into v_hits;

  if v_hits > p_limit then
    raise exception 'RATE_LIMITED'
      using errcode = 'P0001',
            hint = ceil(extract(epoch from (v_start + p_window - now())))::text;
  end if;
end;
$$;

comment on function app.consume_rate_limit(text, integer, interval) is
  'Counts one hit of the current actor in a bucket; raises RATE_LIMITED (P0001) above p_limit per p_window.';

revoke all on function app.consume_rate_limit(text, integer, interval) from public;
-- Server code and future RPCs may use it for their own buckets; the subject is always the caller.
grant execute on function app.consume_rate_limit(text, integer, interval) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Invitations: at most 30 sent or re-sent per admin and hour (each send is an email).
-- ---------------------------------------------------------------------------

create or replace function app.rate_limit_invitations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.token_hash is distinct from old.token_hash then
    perform app.consume_rate_limit('invitation.send', 30, interval '1 hour');
  end if;
  return new;
end;
$$;

revoke all on function app.rate_limit_invitations() from public;

create trigger invitations_rate_limit
before insert or update of token_hash on public.invitations
for each row execute function app.rate_limit_invitations();
