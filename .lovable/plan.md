## Maintenance run

Execute the three pending maintenance jobs in order, directly against the database / via the existing server functions, and report results.

### Steps

1. **Inspect the 1 failed doc** — record URL + error so we can decide whether to retry, hide, or leave it.
2. **Backfill publish dates** — call `backfillPublishedDates({ limit: 2000 })`. Loop with increasing offset if needed until `scanned < limit`. Verify `documents.published_at` non-null count rises.
3. **Re-clean & re-embed (recent)** — call `recleanAndReembed({ sinceHours: 24, limit: 200 })`. If more than 200 docs were touched in the last 24h, loop until `processed === 0`. Poll `ingest_runs` for progress so we know workers are alive.
4. **Run smoke tests** — call `runIngestSmokeTests()` and log the report to `ingest_runs.notes` (already wired). Print pass/fail per check.
5. **Spot-check `list_latest`** — SQL: top 10 by `COALESCE(published_at, sitemap_lastmod) DESC` to confirm no pre-2024 entries surface.
6. **Final summary** — counts, smoke result, any docs still failed or suspicious.

### Execution notes

- Invoke server fns via `stack_modern--invoke-server-function` (auth-protected; needs an authenticated session — fall back to direct SQL / `psql` driving the same helpers if invoke fails without a session token).
- If invoke is blocked, run the equivalent work directly: backfill via a one-off node script reading `published-date.server.ts`, re-clean via `psql` UPDATE + a node script that calls `cleanMarkdown` + `embedTexts` for the affected docs.
- Long jobs: chunk into ≤200-doc batches, sleep 2s between batches, never block a single tool call >10 min.
- After each batch, `SELECT count(*) FROM documents WHERE …` to confirm progress; log to chat only on batch completion or anomaly.

### Done criteria

- `documents.published_at` populated for every doc where extraction can find one (source recorded in `published_at_source`).
- Last 24h of docs re-cleaned + re-embedded (status back to `embedded`, no new `failed`).
- Smoke report: 5/5 pass, or a clear note on which check failed and why.
- `list_latest` top 10 contains no pre-2024 items.
