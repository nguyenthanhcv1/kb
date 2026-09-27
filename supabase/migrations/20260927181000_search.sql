-- Accent-insensitive Vietnamese search index (docs/PLAN.md §3.2 `page_search`, §4.2, §4.3, task T5.1).
--
--   * `app.vn_unaccent(text)`: IMMUTABLE wrapper around `unaccent` (NFC, đ → d, lowercase) for
--     expression indexes and the trigram title match.
--   * Text search configuration `public.vi_unaccent`: `simple` (no stemming, no stop words —
--     Vietnamese is monosyllabic) behind the `unaccent` filter dictionary, so "nghi phep" matches
--     "nghỉ phép" and `ts_headline` still highlights the original accented words.
--   * `page_search`: derived, 1–1 with `pages`. Rows are written only by triggers on `pages`
--     (title, trash, Space move, last edit) and `page_documents` (derived text), then backfilled.
--   * RLS: live pages whose Space the user can view. The check goes through
--     `app.page_row_role()` so V2 page permissions change one function, not this policy.
--   * The search RPC (`search_pages`) and `/api/search` come in T5.2.

-- ---------------------------------------------------------------------------
-- Normalisation
-- ---------------------------------------------------------------------------

create or replace function app.vn_unaccent(p_text text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary,
                                   translate(normalize(p_text, NFC), 'đĐ', 'dD')))
$$;

comment on function app.vn_unaccent(text) is
  'NFC + remove Vietnamese diacritics (đ → d) + lowercase. IMMUTABLE, usable in indexes.';

create text search configuration public.vi_unaccent (copy = simple);
alter text search configuration public.vi_unaccent
  alter mapping for hword, hword_part, word with extensions.unaccent, simple;

comment on text search configuration public.vi_unaccent is
  'simple + unaccent: accent-insensitive, no stemming. Normalise input to NFC first.';

-- Weighted document vector of a page: title A, headings B, body and tables C (§4.3).
-- Body text is cut at 500 000 characters to stay under the 1 MB tsvector limit.
create or replace function app.page_search_tsv(
  p_config regconfig,
  p_title text,
  p_headings text,
  p_content text,
  p_table text
)
returns tsvector
language sql
immutable
parallel safe
set search_path = ''
as $$
  select setweight(to_tsvector(p_config, normalize(coalesce(p_title, ''), NFC)), 'A')
      || setweight(to_tsvector(p_config, normalize(coalesce(p_headings, ''), NFC)), 'B')
      || setweight(to_tsvector(p_config, normalize(left(coalesce(p_content, ''), 500000), NFC)), 'C')
      || setweight(to_tsvector(p_config, normalize(left(coalesce(p_table, ''), 500000), NFC)), 'C')
$$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.page_search (
  page_id uuid primary key references public.pages (id) on delete cascade,
  space_id uuid not null references public.spaces (id) on delete cascade,
  is_deleted boolean not null default false,
  title text not null default '',
  title_norm text not null default '',
  -- `vi_unaccent`, weighted: title A, headings B, content + tables C.
  tsv tsvector not null default ''::tsvector,
  -- `simple`, accents kept (title + headings + content): ranks exact spelling higher (T5.2).
  tsv_exact tsvector not null default ''::tsvector,
  last_edited_at timestamptz not null default now()
);

comment on table public.page_search is
  'Derived search index, 1–1 with pages. Maintained by triggers on pages and page_documents.';
comment on column public.page_search.title_norm is 'app.vn_unaccent(title), trigram-indexed.';

create index page_search_tsv_idx on public.page_search using gin (tsv);
create index page_search_tsv_exact_idx on public.page_search using gin (tsv_exact);
create index page_search_title_norm_trgm_idx on public.page_search
  using gin (title_norm extensions.gin_trgm_ops);
create index page_search_space_id_idx on public.page_search (space_id);

-- ---------------------------------------------------------------------------
-- Maintenance
-- ---------------------------------------------------------------------------

-- Recompute the row of one page from pages + page_documents (upsert).
create or replace function app.refresh_page_search(p_page_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.page_search as ps
    (page_id, space_id, is_deleted, title, title_norm, tsv, tsv_exact, last_edited_at)
  select
    p.id,
    p.space_id,
    p.deleted_at is not null,
    p.title,
    app.vn_unaccent(p.title),
    app.page_search_tsv('public.vi_unaccent'::regconfig, p.title, d.headings_text, d.content_text, d.table_text),
    app.page_search_tsv('pg_catalog.simple'::regconfig, p.title, d.headings_text, d.content_text, null),
    p.last_edited_at
  from public.pages as p
  join public.page_documents as d on d.page_id = p.id
  where p.id = p_page_id
  on conflict (page_id) do update set
    space_id = excluded.space_id,
    is_deleted = excluded.is_deleted,
    title = excluded.title,
    title_norm = excluded.title_norm,
    tsv = excluded.tsv,
    tsv_exact = excluded.tsv_exact,
    last_edited_at = excluded.last_edited_at
$$;

comment on function app.refresh_page_search(uuid) is
  'Upserts page_search for one page. Called by triggers; safe to call again (idempotent).';

create or replace function app.page_search_on_pages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.refresh_page_search(new.id);
  return new;
end;
$$;

create or replace function app.page_search_on_documents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.refresh_page_search(new.page_id);
  return new;
end;
$$;

-- A new page gets its row when pages_after_write inserts the empty page_documents row.
create trigger pages_page_search
after update of title, deleted_at, space_id, last_edited_at on public.pages
for each row execute function app.page_search_on_pages();

create trigger page_documents_page_search
after insert or update of content_text, headings_text, table_text on public.page_documents
for each row execute function app.page_search_on_documents();

-- Backfill pages created before this migration.
select app.refresh_page_search(id) from public.pages;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.page_search enable row level security;

create policy page_search_select on public.page_search
for select to authenticated
using (not is_deleted and app.page_row_role(space_id, page_id) is not null);

-- No INSERT/UPDATE/DELETE policy or grant: rows are written only by the triggers above.
revoke all on public.page_search from anon, authenticated;
grant select on public.page_search to authenticated;

revoke all on function app.vn_unaccent(text) from public;
revoke all on function app.page_search_tsv(regconfig, text, text, text, text) from public;
revoke all on function app.refresh_page_search(uuid) from public;
revoke all on function app.page_search_on_pages() from public;
revoke all on function app.page_search_on_documents() from public;

grant execute on function app.vn_unaccent(text) to authenticated, service_role;
grant execute on function app.page_search_tsv(regconfig, text, text, text, text) to authenticated, service_role;
grant execute on function app.refresh_page_search(uuid) to service_role;
