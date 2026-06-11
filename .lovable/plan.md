# Fix: ai_sweden phantom-insert bug + preview transparency

## Root cause

`mapSource`, `previewBulkOp`, and `refreshSitemap` all build the "existing URLs" lookup directly from `documents.url` without re-canonicalizing. Incoming sitemap URLs go through `canonicalizeUrl(...)`, so any stored row whose URL is in a slightly different shape — bare-host `ai.se`, trailing slash, mixed case — fails the lookup and is classified as a brand-new insert. For ai_sweden this inflates "new" by ~1,065 even though SQL confirms 2,065 canonical-www rows already exist.

The insert path is unaffected because it canonicalizes before insert; only the diff partition is broken.

## Changes

### 1. `src/lib/ingest.functions.ts` — canonicalize both sides of every diff

In all three functions that build a URL→row map from `documents` (`mapSource`, `previewBulkOp`, `refreshSitemap`):

- Build the lookup with `canonicalizeUrl(r.url)` as the key, not the raw `r.url`.
- If two stored rows collapse to the same canonical key (legacy duplicates), keep the embedded one; otherwise keep the most recently fetched. Log a one-line warning with the duplicate count so we can clean those rows up later, but don't block the op.
- No other logic changes — the insert/refresh/unchanged partitioning stays as-is.

### 2. `mapSource` — return a sample of would-insert URLs

- Extend the returned `preview` (and the `BulkGuardError` payload) with `willInsertSample: string[]` — the first 20 entries of `toInsert.map(r => r.url)`, sorted.
- Same field added to `previewBulkOp`'s return shape so the dialog always has it.

### 3. `src/routes/_authenticated/admin/index.tsx` — show the sample

- Below the existing stats grid in the AlertDialog, add a collapsible `<details>` block: "Sample of new URLs (first 20 of N)" with a monospace `<ul>` of the URLs.
- Only render when `_op === "map"` and `willInsert > 0`. Each URL is a plain external `<a>` so we can spot-check in one click.

### 4. No schema, no migration, no behavior change beyond the diff fix

Guard math, force flow, and atomic re-embed are untouched.

## Verification

After implementation, re-run the ai_sweden preview from the admin panel:

- Acceptance: `willInsert ≤ ~150`, `unchanged ≥ ~1,900`, `willResetEmbedded = 0`.
- Acceptance: the new "Sample of new URLs" disclosure lists URLs that genuinely aren't in `documents` (spot-check 3 against SQL).
- Re-run the rise preview to confirm it still shows `0/0/0` (no regression).
- If both pass, the safety floor holds and we can proceed to Phase C.

## Files touched

- `src/lib/ingest.functions.ts` (3 partition sites + return shape)
- `src/routes/_authenticated/admin/index.tsx` (dialog disclosure)
- `src/lib/build-version.ts` (bump)
