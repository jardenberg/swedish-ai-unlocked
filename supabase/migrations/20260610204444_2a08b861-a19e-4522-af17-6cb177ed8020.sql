
-- 1. Per-document dedup in match_chunks
CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding vector,
  match_count int DEFAULT 10,
  filter_source uuid DEFAULT NULL,
  filter_lang text DEFAULT NULL
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  url text,
  title text,
  lang text,
  source_slug text,
  source_name text,
  snippet text,
  similarity double precision,
  fetched_at timestamp with time zone
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH ranked AS (
    SELECT
      c.id AS chunk_id,
      c.document_id,
      c.text AS chunk_text,
      1 - (c.embedding <=> query_embedding) AS similarity,
      ROW_NUMBER() OVER (
        PARTITION BY c.document_id
        ORDER BY c.embedding <=> query_embedding
      ) AS rn
    FROM public.chunks c
    JOIN public.documents d ON d.id = c.document_id
    WHERE d.status = 'embedded'
      AND (filter_source IS NULL OR d.source_id = filter_source)
      AND (filter_lang IS NULL OR d.lang = filter_lang)
    ORDER BY c.embedding <=> query_embedding
    LIMIT GREATEST(match_count * 10, 50)
  )
  SELECT
    r.chunk_id,
    r.document_id,
    d.url,
    d.title,
    d.lang,
    s.slug,
    s.name,
    substring(r.chunk_text from 1 for 600),
    r.similarity,
    d.fetched_at
  FROM ranked r
  JOIN public.documents d ON d.id = r.document_id
  JOIN public.sources s ON s.id = d.source_id
  WHERE r.rn = 1
  ORDER BY r.similarity DESC
  LIMIT match_count;
$$;

-- 2. Storage path for admin-uploaded PDFs
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS storage_path text;
