-- ──────────────────────────────────────────────────────────────────
-- 1. Extensions
-- ──────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ──────────────────────────────────────────────────────────────────
-- 2. IMMUTABLE helpers for generated columns.
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chunk_tsv(_lang text, _text text)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT CASE WHEN _lang = 'sv'
              THEN to_tsvector('pg_catalog.swedish'::regconfig, coalesce(_text, ''))
              ELSE to_tsvector('pg_catalog.english'::regconfig, coalesce(_text, ''))
         END;
$$;

CREATE OR REPLACE FUNCTION public.derive_page_type(_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT CASE
    WHEN _url ~ '/events?/'                                                                THEN 'event'
    WHEN _url ~ '/(news|nyheter)/'                                                          THEN 'news'
    WHEN _url ~ '/(project|projekt|sector-initiatives-projects|sektorsinitiativ-projekt)/' THEN 'project'
    ELSE 'page'
  END;
$$;

-- ──────────────────────────────────────────────────────────────────
-- 3. chunks.lang — denormalized from documents.lang.
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.chunks
  ADD COLUMN IF NOT EXISTS lang text;

UPDATE public.chunks c
SET    lang = d.lang
FROM   public.documents d
WHERE  c.document_id = d.id
  AND  c.lang IS DISTINCT FROM d.lang;

CREATE OR REPLACE FUNCTION public.sync_chunks_lang_from_doc()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.lang IS DISTINCT FROM OLD.lang THEN
    UPDATE public.chunks SET lang = NEW.lang WHERE document_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documents_sync_chunks_lang ON public.documents;
CREATE TRIGGER documents_sync_chunks_lang
AFTER UPDATE OF lang ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.sync_chunks_lang_from_doc();

-- ──────────────────────────────────────────────────────────────────
-- 4. chunks.tsv (STORED generated) + indexes
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.chunks
  ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (public.chunk_tsv(lang, text)) STORED;

CREATE INDEX IF NOT EXISTS chunks_tsv_idx
  ON public.chunks USING gin (tsv);

CREATE INDEX IF NOT EXISTS chunks_text_trgm_idx
  ON public.chunks USING gin (text gin_trgm_ops);

-- ──────────────────────────────────────────────────────────────────
-- 5. documents.page_type
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS page_type text
  GENERATED ALWAYS AS (public.derive_page_type(url)) STORED;

CREATE INDEX IF NOT EXISTS documents_page_type_idx
  ON public.documents (page_type);

-- ──────────────────────────────────────────────────────────────────
-- 6. match_chunks — add page_type filter
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding vector,
  match_count integer DEFAULT 10,
  filter_source uuid DEFAULT NULL::uuid,
  filter_lang text DEFAULT NULL::text,
  filter_page_type text DEFAULT NULL::text
)
RETURNS TABLE(
  chunk_id uuid, document_id uuid, url text, title text, lang text,
  source_slug text, source_name text, page_type text,
  snippet text, similarity double precision, fetched_at timestamptz
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
      AND d.hidden = false
      AND (filter_source    IS NULL OR d.source_id = filter_source)
      AND (filter_lang      IS NULL OR d.lang      = filter_lang)
      AND (filter_page_type IS NULL OR d.page_type = filter_page_type)
    ORDER BY c.embedding <=> query_embedding
    LIMIT GREATEST(match_count * 10, 50)
  )
  SELECT
    r.chunk_id, r.document_id, d.url, d.title, d.lang,
    s.slug, s.name, d.page_type,
    substring(r.chunk_text from 1 for 600),
    r.similarity, d.fetched_at
  FROM ranked r
  JOIN public.documents d ON d.id = r.document_id
  JOIN public.sources   s ON s.id = d.source_id
  WHERE r.rn = 1
  ORDER BY r.similarity DESC
  LIMIT match_count;
$$;

-- ──────────────────────────────────────────────────────────────────
-- 7. lexical_match_chunks — lexical arm of hybrid search
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lexical_match_chunks(
  query_text text,
  match_count integer DEFAULT 10,
  filter_source uuid DEFAULT NULL::uuid,
  filter_lang text DEFAULT NULL::text,
  filter_page_type text DEFAULT NULL::text
)
RETURNS TABLE(
  chunk_id uuid, document_id uuid, url text, title text, lang text,
  source_slug text, source_name text, page_type text,
  snippet text, rank double precision, fetched_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH q AS (
    SELECT
      websearch_to_tsquery('pg_catalog.simple',  query_text) AS tq_simple,
      websearch_to_tsquery('pg_catalog.english', query_text) AS tq_en,
      websearch_to_tsquery('pg_catalog.swedish', query_text) AS tq_sv,
      query_text AS qtxt
  ),
  ranked AS (
    SELECT
      c.id AS chunk_id,
      c.document_id,
      c.text AS chunk_text,
      GREATEST(
        ts_rank(c.tsv,
          CASE WHEN c.lang = 'sv' THEN q.tq_sv ELSE q.tq_en END),
        ts_rank(c.tsv, q.tq_simple),
        CASE WHEN length(q.qtxt) < 40
             THEN similarity(c.text, q.qtxt)
             ELSE 0 END
      )::double precision AS rk,
      ROW_NUMBER() OVER (
        PARTITION BY c.document_id
        ORDER BY GREATEST(
          ts_rank(c.tsv,
            CASE WHEN c.lang = 'sv' THEN q.tq_sv ELSE q.tq_en END),
          ts_rank(c.tsv, q.tq_simple),
          CASE WHEN length(q.qtxt) < 40
               THEN similarity(c.text, q.qtxt)
               ELSE 0 END
        ) DESC
      ) AS rn
    FROM public.chunks c
    JOIN public.documents d ON d.id = c.document_id
    CROSS JOIN q
    WHERE d.status = 'embedded'
      AND d.hidden = false
      AND (filter_source    IS NULL OR d.source_id = filter_source)
      AND (filter_lang      IS NULL OR d.lang      = filter_lang)
      AND (filter_page_type IS NULL OR d.page_type = filter_page_type)
      AND (
        c.tsv  @@ q.tq_simple
        OR c.tsv @@ q.tq_en
        OR c.tsv @@ q.tq_sv
        OR (length(q.qtxt) < 40 AND c.text ILIKE '%' || q.qtxt || '%')
      )
  )
  SELECT
    r.chunk_id, r.document_id, d.url, d.title, d.lang,
    s.slug, s.name, d.page_type,
    substring(r.chunk_text from 1 for 600),
    r.rk, d.fetched_at
  FROM ranked r
  JOIN public.documents d ON d.id = r.document_id
  JOIN public.sources   s ON s.id = d.source_id
  WHERE r.rn = 1
  ORDER BY r.rk DESC
  LIMIT match_count;
$$;

-- ──────────────────────────────────────────────────────────────────
-- 8. find_mentions_chunks — "everything that mentions X"
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.find_mentions_chunks(
  query_text text,
  match_count integer DEFAULT 25,
  filter_source uuid DEFAULT NULL::uuid,
  filter_lang text DEFAULT NULL::text,
  filter_page_type text DEFAULT NULL::text
)
RETURNS TABLE(
  document_id uuid, url text, title text, lang text,
  source_slug text, source_name text, page_type text,
  snippet text, rank double precision, match_mode text,
  fetched_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH q AS (
    SELECT
      websearch_to_tsquery('pg_catalog.simple',  query_text) AS tq_simple,
      websearch_to_tsquery('pg_catalog.english', query_text) AS tq_en,
      websearch_to_tsquery('pg_catalog.swedish', query_text) AS tq_sv,
      query_text AS qtxt
  ),
  hits AS (
    SELECT
      c.id AS chunk_id,
      c.document_id,
      c.text AS chunk_text,
      GREATEST(
        ts_rank(c.tsv,
          CASE WHEN c.lang = 'sv' THEN q.tq_sv ELSE q.tq_en END),
        ts_rank(c.tsv, q.tq_simple)
      )::double precision AS rk,
      CASE
        WHEN c.text ILIKE '%' || q.qtxt || '%' THEN 'exact'
        ELSE 'stemmed'
      END AS mode,
      ROW_NUMBER() OVER (
        PARTITION BY c.document_id
        ORDER BY
          (c.text ILIKE '%' || q.qtxt || '%') DESC,
          GREATEST(
            ts_rank(c.tsv,
              CASE WHEN c.lang = 'sv' THEN q.tq_sv ELSE q.tq_en END),
            ts_rank(c.tsv, q.tq_simple)
          ) DESC
      ) AS rn
    FROM public.chunks c
    JOIN public.documents d ON d.id = c.document_id
    CROSS JOIN q
    WHERE d.status = 'embedded'
      AND d.hidden = false
      AND (filter_source    IS NULL OR d.source_id = filter_source)
      AND (filter_lang      IS NULL OR d.lang      = filter_lang)
      AND (filter_page_type IS NULL OR d.page_type = filter_page_type)
      AND (
        c.tsv  @@ q.tq_simple
        OR c.tsv @@ q.tq_en
        OR c.tsv @@ q.tq_sv
        OR c.text ILIKE '%' || q.qtxt || '%'
      )
  )
  SELECT
    h.document_id, d.url, d.title, d.lang,
    s.slug, s.name, d.page_type,
    substring(h.chunk_text from 1 for 600),
    h.rk, h.mode, d.fetched_at
  FROM hits h
  JOIN public.documents d ON d.id = h.document_id
  JOIN public.sources   s ON s.id = d.source_id
  WHERE h.rn = 1
  ORDER BY (h.mode = 'exact') DESC, h.rk DESC
  LIMIT match_count;
$$;

-- ──────────────────────────────────────────────────────────────────
-- 9. find_mentions_total — exact-substring document count for parity
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.find_mentions_total(
  query_text text,
  filter_source uuid DEFAULT NULL::uuid,
  filter_lang text DEFAULT NULL::text,
  filter_page_type text DEFAULT NULL::text
)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT count(*)::bigint
  FROM public.documents d
  WHERE d.status = 'embedded'
    AND d.hidden = false
    AND (filter_source    IS NULL OR d.source_id = filter_source)
    AND (filter_lang      IS NULL OR d.lang      = filter_lang)
    AND (filter_page_type IS NULL OR d.page_type = filter_page_type)
    AND d.raw_markdown ILIKE '%' || query_text || '%';
$$;