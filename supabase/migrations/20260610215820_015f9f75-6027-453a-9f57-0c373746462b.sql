-- 1. Add publish-date and hidden columns to documents
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_at_source text,
  ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_documents_publish_order
  ON public.documents ((COALESCE(published_at, sitemap_lastmod)) DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_documents_hidden
  ON public.documents (hidden) WHERE hidden = true;

-- 2. Update match_chunks to filter out hidden documents
CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding vector,
  match_count integer DEFAULT 10,
  filter_source uuid DEFAULT NULL::uuid,
  filter_lang text DEFAULT NULL::text
)
RETURNS TABLE(
  chunk_id uuid, document_id uuid, url text, title text, lang text,
  source_slug text, source_name text, snippet text, similarity double precision,
  fetched_at timestamp with time zone
)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
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
      AND d.hidden = false
      AND (filter_source IS NULL OR d.source_id = filter_source)
      AND (filter_lang IS NULL OR d.lang = filter_lang)
    ORDER BY c.embedding <=> query_embedding
    LIMIT GREATEST(match_count * 10, 50)
  )
  SELECT
    r.chunk_id, r.document_id, d.url, d.title, d.lang,
    s.slug, s.name,
    substring(r.chunk_text from 1 for 600),
    r.similarity, d.fetched_at
  FROM ranked r
  JOIN public.documents d ON d.id = r.document_id
  JOIN public.sources s ON s.id = d.source_id
  WHERE r.rn = 1
  ORDER BY r.similarity DESC
  LIMIT match_count;
$function$;

-- 3. New function: similar documents by seed-document centroid
CREATE OR REPLACE FUNCTION public.match_similar_documents(
  seed_document_id uuid,
  match_count integer DEFAULT 10,
  filter_source uuid DEFAULT NULL::uuid,
  filter_lang text DEFAULT NULL::text
)
RETURNS TABLE(
  document_id uuid, url text, title text, lang text,
  source_slug text, source_name text, snippet text, similarity double precision,
  fetched_at timestamp with time zone
)
LANGUAGE plpgsql STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  centroid vector;
BEGIN
  -- Compute the document's centroid embedding
  SELECT AVG(embedding)::vector INTO centroid
  FROM public.chunks
  WHERE chunks.document_id = seed_document_id
    AND embedding IS NOT NULL;

  IF centroid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT
      c.document_id,
      c.text AS chunk_text,
      1 - (c.embedding <=> centroid) AS similarity,
      ROW_NUMBER() OVER (
        PARTITION BY c.document_id
        ORDER BY c.embedding <=> centroid
      ) AS rn
    FROM public.chunks c
    JOIN public.documents d ON d.id = c.document_id
    WHERE d.status = 'embedded'
      AND d.hidden = false
      AND d.id <> seed_document_id
      AND (filter_source IS NULL OR d.source_id = filter_source)
      AND (filter_lang IS NULL OR d.lang = filter_lang)
    ORDER BY c.embedding <=> centroid
    LIMIT GREATEST(match_count * 10, 50)
  )
  SELECT
    r.document_id, d.url, d.title, d.lang,
    s.slug, s.name,
    substring(r.chunk_text from 1 for 600),
    r.similarity, d.fetched_at
  FROM ranked r
  JOIN public.documents d ON d.id = r.document_id
  JOIN public.sources s ON s.id = d.source_id
  WHERE r.rn = 1
  ORDER BY r.similarity DESC
  LIMIT match_count;
END;
$function$;