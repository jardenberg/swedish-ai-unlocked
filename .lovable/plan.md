# Fix: paginate documents fetch in the diff partition

## Root cause

Supabase's PostgREST returns at most 1,000 rows per `.select()` by default. `mapSource`, `previewBulkOp`, and `refreshSitemap` all do:

```ts
const { data: existingRows } = await supabaseAdmin
  .from("documents")
  .select("id, url, status, sitemap_lastmod, fetched_at")
  .eq("source_id", source.id);
```

For ai_sweden (2,065 docs) this silently returns only the first 1,000. The other ~1,065 are invisible to the diff and get classified as brand-new inserts. SQL confirms ai_sweden has the exact "new" URLs (e.g. `https://www.ai.se/en/about-cookies-our-website`) already stored in canonical form — they just weren't in the slice the JS client received.

The recently added `canonicalizeUrl`-both-sides logic is still correct defense-in-depth and should stay; it just wasn't the bug.

## Fix

Add a small helper in `src/lib/ingest.functions.ts`:

```ts
async function fetchAllDocuments(sb, sourceId) {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("documents")
      .select("id, url, status, sitemap_lastmod, fetched_at")
      .eq("source_id", sourceId)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}
```

Replace the three current `existingRows` fetches with `await fetchAllDocuments(supabaseAdmin, source.id)`. No other logic changes — `buildCanonicalExistingMap` and partition stay identical.

## Verification

After deploy, re-run the ai_sweden preview:

- Acceptance: `willInsert ≤ ~150` (likely far fewer), `unchanged ≈ 2,000+`, `willResetEmbedded = 0`.
- Re-run rise preview to confirm it still shows `0/0/0`.
- The 20-URL sample in the dialog should now show URLs that are genuinely not in `documents` (or be empty).

## Files touched

- `src/lib/ingest.functions.ts` (one helper + three call-site replacements)
- `src/lib/build-version.ts` (bump)
