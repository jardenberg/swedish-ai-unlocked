import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types";

export async function fetchLatestDocuments(
  sb: SupabaseClient<Database>,
  filters: { sourceId?: string; lang?: string; pageType?: string; limit: number },
) {
  // Two disjoint, ordered top-k sets implement COALESCE ordering without a
  // migration, an unbounded query, or truncation before ranking. No row outside
  // either top-k can enter the combined top-k. URL makes ties deterministic.
  const query = (hasPublication: boolean) => {
    let q = sb
      .from("documents")
      .select(
        "url, title, lang, page_type, fetched_at, sitemap_lastmod, published_at, published_at_source, sources(slug, name)",
      )
      .eq("status", "embedded")
      .eq("hidden", false)
      .limit(filters.limit);
    if (filters.sourceId) q = q.eq("source_id", filters.sourceId);
    if (filters.lang) q = q.eq("lang", filters.lang);
    if (filters.pageType) q = q.eq("page_type", filters.pageType);
    return (hasPublication ? q.not("published_at", "is", null) : q.is("published_at", null))
      .order(hasPublication ? "published_at" : "sitemap_lastmod", {
        ascending: false,
        nullsFirst: false,
      })
      .order("url", { ascending: true });
  };
  const batches = await Promise.all([query(true), query(false)]);
  for (const batch of batches) if (batch.error) throw new Error(batch.error.message);
  return batches
    .flatMap((b) => b.data ?? [])
    .map((d) => ({ d, effective: d.published_at ?? d.sitemap_lastmod ?? null }))
    .sort((a, b) => {
      const delta =
        (b.effective ? Date.parse(b.effective) : -Infinity) -
        (a.effective ? Date.parse(a.effective) : -Infinity);
      return (
        (Number.isNaN(delta) ? 0 : delta) || (a.d.url < b.d.url ? -1 : a.d.url > b.d.url ? 1 : 0)
      );
    })
    .slice(0, filters.limit);
}
