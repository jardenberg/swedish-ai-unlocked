# Plan: A → B → C, with D throughout

Sequence is the safety order. A and B ship together and get verified against the live corpus with the zero-touch remap proof. C is then built on top of the new run metadata. D fixes are slotted into whichever phase touches the relevant surface.

---

## A. Root-cause fix: non-destructive re-map

The current `mapSource` builds rows with `status: 'pending'` for every URL it sees and `upsert(..., { ignoreDuplicates: false })`, which overwrites `status`, `sitemap_lastmod`, `lang`, and `content_type` on every existing row. That is what nuked the corpus.

Replace the blind upsert with a diff against existing rows:

1. Read existing `{ id, url, status, sitemap_lastmod, fetched_at }` for every URL in the map set (chunked `IN` queries).
2. Partition the incoming URLs:
   - **New** → insert with `status='pending'`.
   - **Existing, no lastmod change** (or both null) → skip entirely. Do not touch the row.
   - **Existing, lastmod newer than `fetched_at`** (or row in `failed`/`pending`) → update `sitemap_lastmod` and set `status='pending'`. This is the legitimate refresh path.
3. Report `{ inserted, refreshed, unchanged, sitemapOnly, mapOnly }` and write the deltas into `ingest_runs.notes`.

**Atomic re-embed (no search gap).** Today re-scraping an embedded doc deletes its chunks before the new embed lands, so the doc disappears from search mid-cycle. Fix in the embed path:

- Embed into a staging set keyed by `document_id` + a `generation` int (or insert new chunks with `generation = old + 1`, then in one transaction delete the old generation and flip the doc's current generation pointer).
- Simpler implementation: build the new chunk rows in memory, then in a single transaction `DELETE FROM chunks WHERE document_id = $1` + `INSERT` the new ones + `UPDATE documents SET status='embedded'`. Old chunks remain searchable until the swap commits.
- Scrape no longer deletes chunks; only embed does, and only inside that transaction.

---

## B. Guardrails on destructive operations

**B1 — Backend hard guard (RPC level, can't be clicked through).**

New server fn `previewBulkOp({ op, sourceSlug })` returns:

```text
{ op, source, willInsert, willRefresh, willResetEmbedded,
  embeddedBefore, embeddedAfterEstimate, estCredits, estDurationMin }
```

Every bulk fn (`mapSource`, `refreshSitemap`, `scrapeBatch` drain, future re-clean) accepts `{ force?: boolean }` and:

- Computes the same impact preview at call time.
- If `willResetEmbedded / embeddedBefore > 0.10` and `force !== true`, throws `BulkGuardError` with the preview attached. UI surfaces it; raw POST also gets blocked.

**B2 — Pre-flight UI.** Every bulk button calls `previewBulkOp` first and opens an AlertDialog showing the numbers verbatim ("add 1,057 new pending · reset 1,283 embedded · ~2h corpus downtime · ~2,340 credits"). Confirm dispatches with `force: true` only if the preview included a guard hit and the operator typed/clicked through.

**B3 — Post-op delta report.** Every bulk fn writes to `ingest_runs.notes` (JSON):

```text
{ embeddedBefore, embeddedAfter, delta, creditsUsed, durationMs, op, force }
```

---

## A+B verification (report stop)

Before C:
- Run `Map URLs` on each source with no upstream changes. Expect `inserted=0, refreshed=0, unchanged=ALL`. SQL before/after on `count(*) filter (status='embedded')` must be identical.
- Simulate `>10%` drop (test fixture or dry-run flag) → confirm `BulkGuardError` without `force`, allowed with `force`.
- Full smoke green; lexical canary green; Helsingborg event still findable with `page_type='event'`.
- Report back with the proof, then proceed.

---

## C. Admin rebuild for observability

New layout under `/_authenticated/admin`:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Corpus Health (sticky)                                               │
│  rise: 1,283 searchable (▲ +12 / 24h)   ai_sweden: 257 (▼ -8)        │
│  total chunks 18,402   failed 1   hidden 3                           │
│  Smoke: ● green  12 min ago        Build v202606112120               │
│  [⚠ corpus degraded: 41 docs below 24h peak — run #8af2]             │
├──────────────────────────────────────────────────────────────────────┤
│ Tabs: [Pipeline] [Timeline] [Smoke] [Search Console] [Documents]     │
└──────────────────────────────────────────────────────────────────────┘
```

**C1 Corpus health header** — server fn `getCorpusHealth()` returns per-source live embedded count, 24h delta vs. a `corpus_snapshots` table (new, daily cron-friendly + on every bulk op end), 24h high-water mark, failed/hidden, last smoke result, build version. Yellow banner when `embedded < highWater24h`.

**C2 Pipeline view** — per source: pending → scraped → embedded → failed as a horizontal flow with counts plus docs/min over the last 10 min (from `ingest_runs` deltas) and ETA. The drain progress line stays, but persisted per-source in a small `drain_progress` map so it survives navigation.

**C3 Operations timeline** — `ingest_runs` reverse-chron feed: op, trigger (user vs cron), duration, docs touched, embedded delta (red when negative), credits, notes JSON expandable.

**C4 Smoke panel** — "Run smoke now" button; per-check pass/fail with measured value vs threshold; last 20 runs as a sparkline per check.

**C5 Search Console tab** — form fields for `search_swedish_ai` / `find_mentions` / `find_similar` with all parameters; calls go through the same MCP-layer code (not duplicated SQL); raw JSON pane with copy button.

**C6 Document drill-down** — row click in documents table → side sheet: status, page_type, lang, all date fields with sources (sitemap_lastmod, fetched_at, published_at), chunk count, cleaned markdown preview, per-doc op history (filtered `ingest_runs` join via a `document_ops` audit table or by document_id in notes), retry/hide actions.

**C7 Credits** — sum `credits_used` from `ingest_runs` for current run, today, current month; if Firecrawl exposes balance via API, fetch and show — otherwise omit cleanly.

---

## D. Housekeeping (slotted in)

1. Identify the 1 failed `ai_sweden` doc from the events drain (`SELECT url, error FROM documents WHERE source='ai_sweden' AND status='failed'`), retry once; if it fails again, hide and note. (During A+B.)
2. Confirm landing-page stats are server-rendered (no `0 documents` flash). If a client-only fetch is hiding behind a loader, move to a public server fn called from the loader. (During C.)
3. Update `llms.txt` corpus counts (docs, chunks, events included) and bump `build-version.ts`. (At the end.)

---

## Acceptance (verified before declaring done)

1. Re-running `Map URLs` on either source with no upstream changes touches zero embedded docs (SQL before/after).
2. Simulated >10% embedded drop blocked without `force: true`, allowed with it.
3. Every bulk button shows the pre-flight summary dialog.
4. Smoke fully green: lexical canary + Helsingborg event findable with `page_type='event'`.
5. Admin corpus health header numbers match direct SQL exactly.

---

## Technical notes

- **Schema additions** (one migration): `corpus_snapshots(id, source_id, embedded_count, chunks_count, captured_at)`; optional `document_ops(id, document_id, op, ingest_run_id, delta, at)` if the timeline join from `ingest_runs.notes` proves too clunky. `ingest_runs.notes` already exists — use JSONB writes.
- **No new RLS surface**: admin-only fns gated by `assertAdmin` + `requireSupabaseAuth`; tables `service_role` only.
- **`previewBulkOp`** is read-only and reused by the actual fn at execution time (single source of truth for the guard math).
- **Atomic re-embed transaction** uses `supabaseAdmin.rpc('replace_chunks', { p_doc, p_rows })` — new SQL function that runs `DELETE` + bulk `INSERT` + `UPDATE documents` in one statement block.
- **Drain** stays in the UI but every iteration now goes through the guarded fn; the per-iteration preview is collapsed into a single up-front preview ("drain will touch ~N docs").
- **Search Console** calls the existing MCP tool execute functions directly server-side to avoid drift.
