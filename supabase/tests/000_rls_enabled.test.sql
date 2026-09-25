begin;

select plan(1);

select is_empty(
  $$
    select schemaname || '.' || tablename
    from pg_catalog.pg_tables
    where schemaname = 'public'
      and not rowsecurity
    order by tablename
  $$,
  'every table in the public schema has row level security enabled'
);

select * from finish();

rollback;
