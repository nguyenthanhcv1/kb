-- T2.5: publish `pages` changes so the sidebar tree updates live. Supabase Realtime evaluates
-- the table's RLS policies per subscriber, so users only receive pages they can view.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pages'
  ) then
    alter publication supabase_realtime add table public.pages;
  end if;
end
$$;
