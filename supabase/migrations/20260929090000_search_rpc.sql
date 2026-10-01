-- Full-text search RPC (docs/PLAN.md §4.4, task T5.2).
--
--   public.search_pages(q, space_ids, limit, offset)  — SECURITY INVOKER, so RLS on `page_search`
--   and `page_documents` decides which pages can appear (live pages of Spaces the caller can view).
--
-- Matching: websearch syntax on `vi_unaccent` (accent-insensitive, "phrase", -exclude, or) with a
-- prefix match on the last word, OR a trigram match on the normalised title (typos).
-- Ranking: weighted ts_rank_cd + bonus for exact accents + bonus for the exact phrase + title
-- similarity + a slight recency boost. Snippets (`ts_headline`) and `match_in` are computed only
-- for the returned page of results. Calls are rate limited to 60 per minute and user.

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
    select
      ps.page_id,
      ps.space_id,
      ps.title,
      ps.last_edited_at,
      (
        case when v_has_ts then ts_rank_cd(ps.tsv, v_ts, 32) else 0 end
        + case when v_exact is not null then 0.5 * ts_rank_cd(ps.tsv_exact, v_exact, 32) else 0 end
        + case when v_has_phrase and ps.tsv @@ v_phrase then 0.4 else 0 end
        + 0.3 * extensions.similarity(ps.title_norm, v_norm)
        + 0.05 * exp(-extract(epoch from now() - ps.last_edited_at) / 86400.0 / 180.0)
      )::real as score
    from public.page_search as ps
    where (space_ids is null or ps.space_id = any (space_ids))
      and ((v_has_ts and ps.tsv @@ v_ts) or (v_trgm and ps.title_norm operator(extensions.%) v_norm))
    order by score desc, ps.page_id
    limit v_limit offset v_offset
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
