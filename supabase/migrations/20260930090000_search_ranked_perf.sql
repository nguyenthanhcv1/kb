-- Search performance fix (T5.4). Benchmark on 20 000 pages showed ~1.9 s per query (docs/adr/0006):
-- under RLS the planner may not push the non-leakproof `@@` / `%` operators below the policy
-- qual `app.page_row_role()`, so it seq-scanned page_search and ran that function (~90 us) on
-- every row, never touching the GIN indexes.
--
-- `app.search_ranked()` (SECURITY DEFINER) does the matching and ranking with the indexes. It is
-- not a permission bypass: it only reads Spaces for which `app.can_view_space()` is true for the
-- caller (the same rule as the policies of `spaces` and `page_search`) and never deleted pages, and
-- it is the only thing granted to `authenticated`. `public.search_pages()` stays SECURITY INVOKER:
-- titles, snippets and match_in still come through RLS (`page_search`, `page_documents`).

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
  where ps.space_id = any (array(select v.id from visible as v))
    and not ps.is_deleted
    and ((p_ts is not null and ps.tsv @@ p_ts) or (p_trgm and ps.title_norm operator(extensions.%) p_norm))
  order by score desc, ps.page_id
  limit p_limit offset p_offset
$$;

comment on function app.search_ranked(tsquery, tsquery, tsquery, text, boolean, uuid[], integer, integer) is
  'Index-backed matching + ranking for public.search_pages() (docs/PLAN.md §4.4). Only Spaces the caller can view.';

revoke all on function app.search_ranked(tsquery, tsquery, tsquery, text, boolean, uuid[], integer, integer) from public, anon;
grant execute on function app.search_ranked(tsquery, tsquery, tsquery, text, boolean, uuid[], integer, integer) to authenticated;

create or replace function public.search_pages(
  q text,
  space_ids uuid[] default null,
  "limit" integer default 20,
  "offset" integer default 0
)
returns table (
  page_id uuid,
  space_id uuid,
  title text,
  snippet text,
  match_in text,
  score real,
  last_edited_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_q text := left(btrim(normalize(coalesce(q, ''), NFC)), 200);
  v_limit integer := least(greatest(coalesce("limit", 20), 1), 50);
  v_offset integer := greatest(coalesce("offset", 0), 0);
  v_norm text;
  v_base tsquery;
  v_text text;
  v_ts tsquery;
  v_has_ts boolean;
  v_exact tsquery;
  v_phrase tsquery;
  v_has_phrase boolean;
  v_trgm boolean;
begin
  if v_q = '' then
    return;
  end if;

  perform app.consume_rate_limit('search', 60, interval '1 minute');

  v_norm := app.vn_unaccent(v_q);
  v_base := websearch_to_tsquery('public.vi_unaccent'::regconfig, v_q);
  v_has_ts := numnode(v_base) > 0;
  -- The typo-tolerant title match would bypass "-word" and "phrase" operators: only for plain queries.
  v_trgm := v_q !~ '(^|\s)-\S' and v_q !~ '"';

  -- Prefix match on the last word while the user is typing (not after a closing quote, not "-word").
  v_ts := v_base;
  if v_has_ts and v_q !~ '"\s*$' then
    v_text := regexp_replace(v_base::text, '(^|[^!''])(''[^'']+'')$', '\1\2:*');
    v_ts := v_text::tsquery;
  end if;

  -- Typed with accents → reward the exact spelling (tsv_exact keeps accents).
  if lower(v_q) <> v_norm then
    v_exact := websearch_to_tsquery('pg_catalog.simple'::regconfig, v_q);
    if numnode(v_exact) = 0 then
      v_exact := null;
    end if;
  end if;

  v_phrase := phraseto_tsquery('public.vi_unaccent'::regconfig, v_q);
  v_has_phrase := numnode(v_phrase) > 0;

  return query
  with ranked as (
    select r.page_id, r.space_id, r.title, r.last_edited_at, r.score
    from app.search_ranked(
      case when v_has_ts then v_ts end,
      v_exact,
      case when v_has_phrase then v_phrase end,
      v_norm,
      v_trgm,
      space_ids,
      v_limit,
      v_offset
    ) as r
  )
  select
    m.page_id,
    m.space_id,
    m.title,
    case
      when v_has_ts then ts_headline(
        'public.vi_unaccent'::regconfig,
        left(case when m.match_in = 'table' then m.table_text else m.content_text end, 100000),
        v_ts,
        'MaxFragments=2, MinWords=5, MaxWords=20, StartSel=<mark>, StopSel=</mark>')
      else left(m.content_text, 160)
    end as snippet,
    m.match_in,
    m.score,
    m.last_edited_at
  from (
    select
      r.page_id,
      r.space_id,
      r.title,
      r.score,
      r.last_edited_at,
      coalesce(d.content_text, '') as content_text,
      coalesce(d.table_text, '') as table_text,
      case
        when ((v_has_ts and to_tsvector('public.vi_unaccent'::regconfig, r.title) @@ v_ts)
              or (v_trgm and app.vn_unaccent(r.title) operator(extensions.%) v_norm)) then 'title'
        when v_has_ts and to_tsvector('public.vi_unaccent'::regconfig, coalesce(d.headings_text, '')) @@ v_ts then 'heading'
        when v_has_ts and to_tsvector('public.vi_unaccent'::regconfig, left(coalesce(d.content_text, ''), 500000)) @@ v_ts then 'body'
        when v_has_ts and to_tsvector('public.vi_unaccent'::regconfig, left(coalesce(d.table_text, ''), 500000)) @@ v_ts then 'table'
        else 'body'
      end as match_in
    from ranked as r
    join public.page_documents as d on d.page_id = r.page_id
  ) as m
  order by m.score desc, m.page_id;
end;
$$;

comment on function public.search_pages(text, uuid[], integer, integer) is
  'Accent-insensitive page search (§4.4). INVOKER: RLS limits results to viewable, live pages. '
  'Rate limited (RATE_LIMITED). match_in = title | heading | body | table; snippet contains <mark>.';

revoke all on function public.search_pages(text, uuid[], integer, integer) from public, anon;
grant execute on function public.search_pages(text, uuid[], integer, integer) to authenticated;
