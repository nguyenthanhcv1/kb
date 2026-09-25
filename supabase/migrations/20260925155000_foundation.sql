create schema if not exists extensions;

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pgtap with schema extensions;

create schema if not exists app;

revoke all on schema app from public;
grant usage on schema app to anon, authenticated, service_role;

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;

comment on function app.touch_updated_at() is
  'Sets updated_at to the current statement timestamp before a row update.';
