# Changelog

## v202609241640 — 2026-09-24

### Fixed
- Give every browser request a unique identifier so concurrent MCP reads cannot collide. Validate response shapes and provide recoverable errors for unexpected replies.

### Changed
- Distinguish news publication dates from project/event source dates, which may refer to upcoming work.
- Keep headings in result excerpts from interfering with the page's accessible heading structure.


## v202609241635 — 2026-09-24

### Fixed
- Permit browser reads from the canonical site's exact origin so /human can use the existing MCP endpoint. Other browser origins remain restricted; origin-less MCP clients continue to work.


## v202609241630 — 2026-09-24

### Added
- `/human`: a public research browser with search, mentions, latest publications, publisher/language/type filters, readable documents, related publications, and source/service status.
- Shareable search and document URLs, copy-link controls, loading states, retry and empty-state recovery, and clear labels for inferred dates and truncated content.
- Navigation between the MCP setup page and the research browser. The root remains focused on connecting AI assistants.

### Implementation
- The browser calls the existing public MCP endpoint, preserving its retrieval logic, validation and shared request limit. No new backend access or write capability.
- Publisher Markdown is rendered without raw HTML; images remain links to the source. No AI summaries are generated.


## v202609241600 — 2026-09-24

### Changed
- Setup begins with a copyable prompt that requests installation or app-specific guidance and verifies a real read through the connector.
- Manual instructions now link to current official Claude, ChatGPT, Codex and Cursor guidance, with clearly labelled configuration examples.
- Removed the misleading universal JSON configuration and corrected the documented tool count to seven.


## v202609241445 — 2026-09-24

### Fixed
- Sitemap refresh rejects HTML verification pages, empty results, and incomplete sitemap-index traversal instead of reporting a successful empty refresh. Existing corpus records are preserved on failure.


## v202609241430 — 2026-09-24

### Fixed
- Latest results now rank all eligible documents before applying the requested limit, including new records beyond the first database page.
- Swedish and English news publication dates are extracted from the article header. Unrelated time elements are no longer accepted as publication evidence.
- Publication-date backfill repairs existing incorrect dates and paginates without skipping records.
- Ingestion smoke checks use the same ranking implementation as the public tool.

### Added
- Regression tests for source date formats, invalid dates, misleading related content, and global latest ordering.
- Read-only source inventory reconciliation and guarded date-backfill preparation scripts.
- Software build version in MCP discovery, consistent with the visible site version.

Earlier releases predate this changelog. Their history is available in Git; no historical release details have been reconstructed here.
