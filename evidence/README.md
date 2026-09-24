# Publication freshness repair, 2026-09-24

Baseline commit: eeb846162de0e06ef2747c0c48f9ccd32087bfb6.
Prepared release: v202609241430.

Confirmed defects: list_latest selected an unordered subset before sorting; date extraction missed publisher headline dates and accepted unrelated time elements. The fix ranks the union of two ordered top-k partitions, equivalent to COALESCE(published_at, sitemap_lastmod), with stable URL ties and existing filters. It retains the existing output contract, including explicitly labelled sitemap fallbacks.

Before-change production snapshot: 1,623 AI Sweden and 720 RISE embedded documents, 612 hidden offsite redirects, no pending or failed rows. News: 584 AI Sweden (582 missing publication dates), 15 RISE. Header-based preparation resolves all 599 news dates. The before/after values and source-header hashes are retained in the private local audit snapshot; the update must guard against concurrent changes.

AI Sweden: all 2,137 eligible sitemap URLs matched stored records. Zero missing and zero stale relative to live sitemap lastmod; 598 matched entries are intentionally parked offsite redirects. This checks the existing configured scope, not all possible pages/PDF links on the internet. See source-parity-20260924.json.

RISE: sitemap requests from this verifier were blocked (HTTP 403 and browser human-verification page). No challenge was bypassed. Scheduled production refresh completed successfully at 04:15 UTC, but that does not independently prove full RISE coverage. A full RISE parity check remains open.

Local validation: TypeScript, production build, focused date/ranking regression tests, and pagination audit. Official verifiable-mcp v0.2.1 positive/negative vectors: all 9 passed. Live protocol/catalog and signature checks must be recorded after deployment.

No Lovable AI builder used. No change to scraping scope, document text, chunks, embeddings, or offsite-redirect policy.
