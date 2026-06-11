import { defineTool } from "mcp-tanstack-start";
import { z } from "zod";

export const findSimilarTool = defineTool({
  name: "find_similar",
  description:
    "Given a URL already present in the index, return semantically similar documents. Uses the seed document's centroid embedding (average of all its chunks) so navigation chrome doesn't dominate matches. Useful for 'more like this' flows after the user picks a hit from search_swedish_ai or list_latest.",
  parameters: z.object({
    url: z.string().url().describe("A URL previously returned by search_swedish_ai, list_latest, or list_sources"),
    limit: z.number().int().min(1).max(25).default(10),
    source: z.enum(["rise", "ai_sweden"]).optional().describe("Restrict similar results to one source"),
    lang: z.enum(["en", "sv"]).optional().describe("Restrict similar results by language"),
  }),
  execute: async ({ url, limit, source, lang }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: doc } = await supabaseAdmin
      .from("documents")
      .select("id")
      .eq("url", url)
      .eq("status", "embedded")
      .eq("hidden", false)
      .maybeSingle();
    if (!doc) return JSON.stringify({ error: "URL not found in index", url });

    let filterSourceId: string | null = null;
    if (source) {
      const { data } = await supabaseAdmin.from("sources").select("id").eq("slug", source).single();
      filterSourceId = data?.id ?? null;
    }

    const rpcArgs: {
      seed_document_id: string;
      match_count: number;
      filter_source?: string;
      filter_lang?: string;
    } = {
      seed_document_id: doc.id,
      match_count: limit,
    };
    if (filterSourceId) rpcArgs.filter_source = filterSourceId;
    if (lang) rpcArgs.filter_lang = lang;

    const { data, error } = await supabaseAdmin.rpc("match_similar_documents", rpcArgs);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Array<{
      document_id: string; url: string; title: string | null; lang: string | null;
      source_slug: string; source_name: string; snippet: string;
      similarity: number; fetched_at: string | null;
    }>;

    // RPC predates page_type — look it up in one query.
    const urls = rows.map((r) => r.url);
    const pageTypeByUrl = new Map<string, string>();
    if (urls.length) {
      const { data: pts } = await supabaseAdmin
        .from("documents")
        .select("url, page_type")
        .in("url", urls);
      for (const p of (pts ?? []) as Array<{ url: string; page_type: string }>) {
        pageTypeByUrl.set(p.url, p.page_type);
      }
    }

    const results = rows.map((r) => ({
      url: r.url,
      title: r.title,
      source: r.source_slug,
      sourceName: r.source_name,
      lang: r.lang,
      pageType: pageTypeByUrl.get(r.url) ?? null,
      score: Number(r.similarity.toFixed(4)),
      snippet: r.snippet,
      fetchedAt: r.fetched_at,
    }));

    return JSON.stringify({ seedUrl: url, count: results.length, results }, null, 2);
  },
});
