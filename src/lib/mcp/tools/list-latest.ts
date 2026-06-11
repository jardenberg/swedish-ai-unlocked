import { defineTool } from "mcp-tanstack-start";
import { z } from "zod";

export const listLatestTool = defineTool({
  name: "list_latest",
  description:
    "List the most recently published documents. Without arguments, returns the newest items across both RISE and AI Sweden. Pass `source` to restrict to one. Lightweight — returns URL, title, source, language, page type and dates but no snippets. Ordered by actual publish date (from page metadata or PDF file path) when available, falling back to sitemap last-modified. Filters: `source`, `lang`, `page_type` (event | news | project | page), `limit` (1–50, default 20).",
  parameters: z.object({
    source: z.enum(["rise", "ai_sweden"]).optional().describe("Restrict to one source"),
    lang: z.enum(["en", "sv"]).optional().describe("Restrict by language"),
    page_type: z.enum(["event", "news", "project", "page"]).optional()
      .describe("Restrict by URL-derived page type"),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  execute: async ({ source, lang, page_type, limit }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let filterSourceId: string | null = null;
    if (source) {
      const { data } = await supabaseAdmin.from("sources").select("id").eq("slug", source).single();
      filterSourceId = data?.id ?? null;
    }

    let q = supabaseAdmin
      .from("documents")
      .select(
        "url, title, lang, page_type, fetched_at, sitemap_lastmod, published_at, published_at_source, sources(slug, name)",
      )
      .eq("status", "embedded")
      .eq("hidden", false)
      .limit(Math.min(limit * 4, 200));
    if (filterSourceId) q = q.eq("source_id", filterSourceId);
    if (lang) q = q.eq("lang", lang);
    if (page_type) q = q.eq("page_type", page_type);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const ranked = (data ?? [])
      .map((d) => {
        const effective = d.published_at ?? d.sitemap_lastmod ?? null;
        return { d, effective };
      })
      .sort((a, b) => {
        const av = a.effective ? new Date(a.effective).getTime() : 0;
        const bv = b.effective ? new Date(b.effective).getTime() : 0;
        return bv - av;
      })
      .slice(0, limit);

    const results = ranked.map(({ d, effective }) => ({
      url: d.url,
      title: d.title,
      source: (d.sources as { slug?: string } | null)?.slug,
      sourceName: (d.sources as { name?: string } | null)?.name,
      lang: d.lang,
      pageType: d.page_type,
      publishedAt: effective,
      publishedAtSource:
        d.published_at != null
          ? (d.published_at_source ?? "unknown")
          : d.sitemap_lastmod
            ? "sitemap"
            : null,
      fetchedAt: d.fetched_at,
      sitemapLastmod: d.sitemap_lastmod,
    }));

    return JSON.stringify({ count: results.length, results }, null, 2);
  },
});
