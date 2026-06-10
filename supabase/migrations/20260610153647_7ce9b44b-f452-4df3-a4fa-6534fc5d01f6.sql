
-- Block all client access to rate_limits (service_role only)
create policy "rate_limits no client access" on public.rate_limits for all using (false) with check (false);

-- Ensure match_chunks has fixed search_path
create or replace function public.match_chunks(
  query_embedding vector(1536),
  match_count int default 10,
  filter_source uuid default null,
  filter_lang text default null
)
returns table (
  chunk_id uuid, document_id uuid, url text, title text, lang text,
  source_slug text, source_name text, snippet text, similarity float, fetched_at timestamptz
)
language sql stable set search_path = public
as $$
  select c.id, d.id, d.url, d.title, d.lang, s.slug, s.name,
         substring(c.text from 1 for 600),
         1 - (c.embedding <=> query_embedding),
         d.fetched_at
  from public.chunks c
  join public.documents d on d.id = c.document_id
  join public.sources s on s.id = d.source_id
  where d.status = 'embedded'
    and (filter_source is null or d.source_id = filter_source)
    and (filter_lang is null or d.lang = filter_lang)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
