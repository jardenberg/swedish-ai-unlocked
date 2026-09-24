# Changelog

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
