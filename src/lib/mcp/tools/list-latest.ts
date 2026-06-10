import { defineTool } from "mcp-tanstack-start";
import { z } from "zod";

export const listLatestTool = defineTool({
  name: "list_latest",
  description:
    "List the most recently fetched documents. Without arguments, returns the newest items across both RISE and AI Sweden. Pass `source` to restrict to one. Lightweight — returns URL, title, source, language and date but no snippets. Use this as a cheap 'what's new' entry point before reaching for search_swedish_ai.",
  parameters: z.object({
    source: z.enum(["rise", "ai_sweden"]).optional().describe("Restrict to one source"),
    lang: z.enum(["en", "sv"]).optional().describe("Restrict by language"),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  execute: async ({ source, lang, limit }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let filterSourceId: string | null = null;
    if (source) {
      const { data } = await supabaseAdmin.from("sources").select("id").eq("slug", source).single();
      filterSourceId = data?.id ?? null;
    }

    let q = supabaseAdmin
      .from("documents")
      .select("url, title, lang, fetched_at, sitemap_lastmod, sources(slug, name)")
      .eq("status", "embedded")
      .order("fetched_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (filterSourceId) q = q.eq("source_id", filterSourceId);
    if (lang) q = q.eq("lang", lang);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const results = (data ?? []).map((d) => ({
      url: d.url,
      title: d.title,
      source: (d.sources as { slug?: string } | null)?.slug,
      sourceName: (d.sources as { name?: string } | null)?.name,
      lang: d.lang,
      fetchedAt: d.fetched_at,
      sitemapLastmod: d.sitemap_lastmod,
    }));

    return JSON.stringify({ count: results.length, results }, null, 2);
  },
});
