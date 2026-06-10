## Scope

Five issues from QA round 2, ordered as you specified. #1 and #2 are pre-publication blockers; #3-#5 ride the same release.

---

### 1. Per-document dedup in `match_chunks` (blocker)

Migration that replaces `public.match_chunks` so it returns the **best chunk per document** up to `match_count`:

```sql
CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding vector, match_count int DEFAULT 10,
  filter_source uuid DEFAULT NULL, filter_lang text DEFAULT NULL
) RETURNS TABLE (...) LANGUAGE sql STABLE SET search_path=public AS $$
  WITH ranked AS (
    SELECT c.id AS chunk_id, c.document_id, c.text,
           1 - (c.embedding <=> query_embedding) AS similarity,
           ROW_NUMBER() OVER (
             PARTITION BY c.document_id
             ORDER BY c.embedding <=> query_embedding
           ) AS rn
    FROM public.chunks c
    JOIN public.documents d ON d.id = c.document_id
    WHERE d.status='embedded'
      AND (filter_source IS NULL OR d.source_id = filter_source)
      AND (filter_lang  IS NULL OR d.lang     = filter_lang)
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count * 10                 -- candidate pool
  )
  SELECT r.chunk_id, r.document_id, d.url, d.title, d.lang,
         s.slug, s.name, substring(r.text from 1 for 600),
         r.similarity, d.fetched_at
  FROM ranked r
  JOIN public.documents d ON d.id = r.document_id
  JOIN public.sources   s ON s.id = d.source_id
  WHERE r.rn = 1
  ORDER BY r.similarity DESC
  LIMIT match_count;
$$;
```

Signature/return shape unchanged — no client code change required. Candidate pool = `match_count * 10` so we still surface `match_count` distinct docs after dedup.

---

### 2. Boilerplate cleaner — fix for real

Confirmed against live `raw_markdown`: snippets begin with markdown-link forms the current regexes don't catch:

- `[Skip to main content](https://...#main-content)`
- `[Hoppa till huvudinnehåll](https://...#main-content)`
- `[Jump directly to content](https://...#main-content)`
- `[![Home](.../ai-sweden-logo_0.png)](https://...)` and `[![Hem](...)](...)`
- `Select your languageensv`
- empty fenced code blocks (` ``` \n``` `)
- RISE breadcrumb runs (`- [Artificial intelligence](...) /` repeated)

Update `src/lib/markdown-clean.server.ts`:
- Add link-wrapped variants of "skip to / jump to / hoppa till" to `HEADER_NOISE_LINES`.
- Add `Select your language…` and `Välj språk…` patterns.
- Add a "standalone image-link line" rule: `^\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\)\s*$` — drop it during the leading-trim pass.
- Drop empty/whitespace-only fenced code blocks.
- For RISE: drop leading lines matching breadcrumb pattern (`^\s*-\s*\[[^\]]+\]\([^)]+\)\s*/\s*$`).

After deploy, run a one-shot script that resets `embedded → scraped` for all docs (so the next embed pass re-cleans + re-embeds), then drains via `batch-ingest.mts`. Add a single log line per doc so we can verify the re-embed pass actually completes this time (last round it didn't).

Validation: pick 5 random `raw_markdown` rows, run `cleanMarkdown` against them, assert the cleaned output starts with a real H1 — not a link or "Select your language".

---

### 3. PDF titles

Update `src/lib/pdf-extract.server.ts` to also return `title`:

1. `pdf.getMetadata()` → `info.Title` (trim, ignore empty/garbage like `untitled`).
2. Fallback: first non-empty line of extracted text that looks like a heading (length 10-200, not all-caps boilerplate).
3. Last resort: `decodeURIComponent(filename)`, strip `.pdf`, replace `_`/`-` with spaces, trim trailing `_0` Drupal suffix.

Use this in `scrapeBatch` PDF branch and in `batch-ingest.mts` instead of the current filename-only fallback.

### 4. PDF language detection

Add `detectLangFromText(text)` to `src/lib/firecrawl.server.ts` (or new helper): simple Swedish-marker check — count occurrences of Swedish stopwords (`och`, `att`, `är`, `för`, `på`, `med`, `som`, `det`, `inte`, `även`, `enligt`) and Swedish-only characters (`å`, `ä`, `ö`) per 1000 chars; if above threshold → `sv`, else `en`. Call this on extracted PDF text in `scrapeBatch` and `batch-ingest.mts`, overriding the URL-based default.

### 5. Manual PDF upload in admin UI

- **Storage**: new private bucket `manual-pdfs` (create via storage tool). RLS — admin-only write, no public read; server fetches via service role when extracting.
- **Server fn** `uploadManualPdf` (`src/lib/ingest.functions.ts`):
  - Input (Zod): `canonicalUrl` (https, max 1000), `title` (1-500), `sourceSlug` (`rise|ai_sweden`), `lang` (`en|sv`), `fileBase64` (max ~50 MB decoded), `mimeType` (must be `application/pdf`).
  - Verify admin role, canonicalize the URL, dedupe against existing `documents.url`.
  - Upload bytes to `manual-pdfs/<source>/<uuid>.pdf` via `supabaseAdmin.storage`.
  - Upsert `documents` row: `content_type='pdf'`, `status='pending'`, `title`, `lang`, plus storage path stashed (see below).
- **Schema tweak**: add nullable `storage_path text` to `documents` so `extractPdf` knows to read from Storage instead of fetching `url`. Migration adds column only — keeps GRANTs intact.
- **Extractor**: `extractPdf` accepts `{ url, storagePath? }`. When `storagePath` present, download from bucket; otherwise fetch URL. `documents.url` stays as the public canonical landing page so citations point to the publisher.
- **Admin UI**: new route `src/routes/_authenticated/admin/upload.tsx` — drag-drop or file input, the four metadata fields, submit handler reads the file as base64 and calls `uploadManualPdf`. Add a nav link in `admin.tsx`.

---

### Technical details (geek section)

| File | Change |
|---|---|
| `supabase/migrations/<ts>_match_chunks_dedup.sql` | Replace RPC with ROW_NUMBER dedup version. |
| `supabase/migrations/<ts>_documents_storage_path.sql` | `ALTER TABLE public.documents ADD COLUMN storage_path text;` |
| `src/lib/markdown-clean.server.ts` | Extend `HEADER_NOISE_LINES`, add image-link and fenced-empty rules. |
| `src/lib/pdf-extract.server.ts` | Return `{ text, pages, method, title }`; use `getMetadata()`. |
| `src/lib/firecrawl.server.ts` | Add `detectLangFromText`. |
| `src/lib/ingest.functions.ts` | `scrapeBatch` PDF branch uses new title+lang; add `uploadManualPdf`. |
| `batch-ingest.mts` | Mirror scrapeBatch changes; add post-deploy `embedded → scraped` reset helper. |
| `src/routes/_authenticated/admin/upload.tsx` (new) | Upload form. |
| `src/routes/_authenticated/admin.tsx` | Add "Upload PDF" nav link. |
| Storage | Create `manual-pdfs` private bucket + RLS. |

### Deploy order

1. Migration #1 (RPC dedup) — instant win, no re-ingest needed.
2. Cleaner fixes + migration #2 (storage_path column).
3. Reset `embedded → scraped` and drain — re-embeds with clean text + correct PDF titles/lang.
4. Upload UI goes live alongside.

### Out of scope

- RISE corpus expansion to 2k-2.5k pages (deferred per your earlier note).
- Custom domain swap (deferred).