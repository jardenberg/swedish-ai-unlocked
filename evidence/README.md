# Publication freshness repair, 2026-09-24

Baseline commit: eeb846162de0e06ef2747c0c48f9ccd32087bfb6.
Initial release: v202609241430 (published and verified). Final release: v202609241445.

Confirmed defects: list_latest selected an unordered subset before sorting; date extraction missed publisher headline dates and accepted unrelated time elements. The fix ranks the union of two ordered top-k partitions, equivalent to COALESCE(published_at, sitemap_lastmod), with stable URL ties and existing filters. It retains the existing output contract, including explicitly labelled sitemap fallbacks.

Before-change production snapshot: 1,623 AI Sweden and 720 RISE embedded documents, 612 hidden offsite redirects, no pending or failed rows. News: 584 AI Sweden (582 missing publication dates), 15 RISE. Header-based preparation resolves all 599 news dates. The before/after values and source-header hashes are retained in the private local audit snapshot; the update must guard against concurrent changes.

AI Sweden: all 2,137 eligible sitemap URLs matched stored records. Zero missing and zero stale relative to live sitemap lastmod; 598 matched entries are intentionally parked offsite redirects. This checks the existing configured scope, not all possible pages/PDF links on the internet. See source-parity-20260924.json.

RISE: sitemap requests from this verifier were blocked (HTTP 403 and browser human-verification page). No challenge was bypassed. Scheduled production refresh completed successfully at 04:15 UTC, but that does not independently prove full RISE coverage. The server network also returned an HTTP-200 human-verification HTML page. A full RISE parity check remains open. Sitemap parsing now fails explicitly on these responses, and scheduled refresh reports a failed/blocked source and HTTP 503 instead of a false successful empty refresh.

Local validation: TypeScript, production build, focused date/ranking regression tests, and pagination audit. Official verifiable-mcp v0.2.1 positive/negative vectors: all 9 passed. The live v202609241430 release passed signature, payload and text-digest checks. Its unchanged seven-tool catalog SHA-256 is 3a82f072e071f7e1f16753917db0b369d6ba5ad027a1efc47f5d8fa1f3e065cc. It negotiates MCP 2025-03-26 in the verification probe; this release does not introduce a newer protocol claim. The current Codex host exposes six of those tools; server_info is visible in raw production discovery. All 599 news dates were updated in one guarded transaction checking the prior fields and source-header hashes; production has zero missing news publication dates. Final release verification is recorded separately.

No Lovable AI builder used. No change to scraping scope, document text, chunks, embeddings, or offsite-redirect policy.
