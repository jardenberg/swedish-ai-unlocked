Six-part fix bundle. Order matters: #2 + #4 + #5 first (data quality), then #1 + #3 (ranking), then #6 (automation guardrail).

## 1. `list_latest` sorts by crawl time, not publish date

**Schema** (`supabase--migration`):
- `documents.published_at timestamptz` (nullable)
- `documents.published_at_source text` — one of `'meta'`, `'visible_date'`, `'pdf_path'`, `'pdf_metadata'`, `'sitemap'`, `null`
- Index: `(COALESCE(published_at, sitemap_lastmod) DESC NULLS LAST)`

**Extraction**:
- HTML (in `firecrawl.server.ts` or a new `extractPublishedAt` helper): parse `<meta property="article:published_time">` from rawHtml. Fallback to visible date regex (Swedish/English: `YYYY-MM-DD`, `DD month YYYY`, `Publicerad`).
- PDF (in `pdf-extract.server.ts`): regex `/sites/default/files/(\d{4})-(\d{2})/` on URL → first-of-month date. If absent, read PDF `CreationDate` metadata via unpdf.
- Persist both `published_at` and `published_at_source` on each ingest write.

**MCP**:
- `list-latest.ts`: `ORDER BY COALESCE(published_at, sitemap_lastmod) DESC NULLS LAST`.
- Include `publishedAt` and `publishedAtSource` in JSON response.

**Backfill**: one-off server function `backfillPublishedDates()` callable from admin Documents page (button "Backfill publish dates") that runs over all docs and fills the new fields from existing `raw_markdown` / URL.

## 2. Menu-tree boilerplate regression (cleaner)

Extend `markdown-clean.server.ts`:
- Drop runs of `- [text](url "text")` lines containing `Expand/contract` / `Expandera/krympa`.
- Drop the `Search`/`Sök` + `Menu`/`Meny` + `Close menu`/`Stäng meny` blocks (link-only lines, any order, within a contiguous chunk).
- Drop the `[Hem](... "Hem")` breadcrumb line.
- Add unit-style fixture test in a small script that runs before re-clean.

**Re-process**: server function `recleanAndReembed(filter: { since?: ts })` that:
1. Selects docs where `updated_at > '2026-06-10 21:00Z'` (the retry batch).
2. Re-runs cleaner on `raw_markdown`.
3. Re-chunks + re-embeds (reuse existing pipeline functions).
4. Admin button: "Re-clean & re-embed retried docs".

## 3. `find_similar` matches navigation

Rework `mcp/tools/find-similar.ts`:
- Compute the **document centroid**: `AVG(embedding)` across the seed doc's chunks (single SQL aggregate; pgvector supports `avg(vector)` via `vector_avg`). If centroid path is awkward, fall back to longest chunk by `length(text)`.
- Query `match_chunks` with the centroid embedding.
- Add `WHERE d.id != seed_document_id` so the seed doc never appears in its own similar list.
- New SQL function `match_documents_by_centroid(seed_doc uuid, match_count int, ...)` returning one row per document (already deduped via existing `match_chunks` pattern).

## 4. Corrupt PDF row

In `pdf-extract.server.ts`:
- After unpdf extraction, run sanity check: if extracted text contains any of `["Stäng meny", "Skip to main content", "Sök på webbplatsen", "RISE Research Institutes"]` AND total text < 5000 chars → reject with error `"PDF extraction returned site HTML (likely redirect)"`.
- Force `Accept: application/pdf` and check response `Content-Type` starts with `application/pdf` before parsing; if `text/html`, fail fast with descriptive error.
- Targeted re-ingest: admin retry on the one bad row will pick up the fix.

## 5. Junk-PDF curation

**Schema** (`supabase--migration`):
- `documents.hidden boolean NOT NULL DEFAULT false`
- Index `(hidden) WHERE hidden = true`

**Discovery**: in PDF URL collection (firecrawl map step), add exclude regex: `/(template|terms-and-conditions|appendix)[-_./]/i`.

**MCP**: every tool (`search`, `list-latest`, `find-similar`, `get-document`, `list-sources`) adds `AND hidden = false` (or excludes hidden docs from counts).

**Admin UI** (`admin/documents.tsx`): "Hide" / "Unhide" toggle button per row; filter chip "Show hidden". Server fns `setDocumentHidden(id, hidden)` and `bulkHideByPattern(pattern)` (admin-only).

## 6. Post-ingest smoke tests

New file `src/lib/ingest-smoke.server.ts` with 5 checks:
1. `search_swedish_ai("secure AI in healthcare", limit=5)` → 5 distinct `document_id`s
2. `search_swedish_ai("kommuner artificiell intelligens", lang="sv")` → ≥1 sv result
3. `search_swedish_ai("State of Swedish AI")` → top 10 includes the magazine URL pattern
4. `list_latest(limit=10)` → no result has `published_at < 2024-01-01`
5. `find_similar(<climate-change-article-url>)` → no result with `score > 0.95`

Server fn `runSmokeTests()` returns `{ pass, fail, results: [...] }`, called automatically at the end of `batch-ingest.mts` and `retryAllFailed`. Pass/fail summary written to `ingest_runs.notes`. Admin UI: "Last smoke test" badge on Runs page.

---

## Technical notes

- **Migrations**: two migrations — one for `published_at` + `published_at_source`, one for `hidden`. Both must include GRANTs (existing `documents` already has them, but ALTER TABLE doesn't need re-GRANT; verify).
- **`match_chunks`**: extend to filter `hidden = false` (modify the existing SQL function) and accept a centroid embedding for #3 via a new sibling function `match_documents_by_centroid`.
- **Cleaner**: write tests as a `.mts` script under repo root, run via `bun run` not test runner (no vitest config in this template).
- **No edge functions**: all logic stays in `createServerFn` + the existing `batch-ingest.mts` orchestrator.
- **Order of work**: migrations first (one batch, both files), then cleaner + PDF sanity, then publish-date extraction, then find_similar centroid, then hidden toggle UI, finally smoke tests.

Estimated touch list:
- `supabase/migrations/*` — 2 new files
- `src/lib/markdown-clean.server.ts`
- `src/lib/pdf-extract.server.ts`
- `src/lib/firecrawl.server.ts` (or new `published-date.server.ts`)
- `src/lib/ingest.functions.ts` (backfill, reclean, hide, smoke)
- `src/lib/ingest-smoke.server.ts` (new)
- `src/lib/mcp/tools/{search,list-latest,find-similar,get-document,list-sources}.ts`
- `src/routes/_authenticated/admin/documents.tsx` (hide toggle, backfill/reclean buttons)
- `src/routes/_authenticated/admin/runs.tsx` (smoke badge)
- `batch-ingest.mts` (smoke at end)