import { defineTool } from "mcp-tanstack-start";
import { z } from "zod";

export const findSimilarTool = defineTool({
  name: "find_similar",
  description:
    "Given a URL already present in the index, return semantically similar documents. Reuses an existing embedding so it's cheap and doesn't call the embedding model. Useful for 'more like this' flows after the user picks a hit from search_swedish_ai or list_latest.",
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
      .maybeSingle();
    if (!doc) return JSON.stringify({ error: "URL not found in index", url });

    // Use the first chunk's embedding as the document representative.
    const { data: chunk } = await supabaseAdmin
      .from("chunks")
      .select("embedding")
      .eq("document_id", doc.id)
      .not("embedding", "is", null)
      .order("ord", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!chunk?.embedding) return JSON.stringify({ error: "No embedding available for this URL", url });

    let filterSourceId: string | null = null;
    if (source) {
      const { data } = await supabaseAdmin.from("sources").select("id").eq("slug", source).single();
      filterSourceId = data?.id ?? null;
    }

    // Pull extra to leave room for de-duping the seed document itself.
    const rpcArgs: {
      query_embedding: string;
      match_count: number;
      filter_source?: string;
      filter_lang?: string;
    } = {
      query_embedding: chunk.embedding as unknown as string,
      match_count: limit + 5,
    };
    if (filterSourceId) rpcArgs.filter_source = filterSourceId;
    if (lang) rpcArgs.filter_lang = lang;

    const { data, error } = await supabaseAdmin.rpc("match_chunks", rpcArgs);
    if (error) throw new Error(error.message);

    const seen = new Set<string>();
    const results: Array<Record<string, unknown>> = [];
    for (const r of data ?? []) {
      if (r.url === url) continue;
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      results.push({
        url: r.url,
        title: r.title,
        source: r.source_slug,
        sourceName: r.source_name,
        lang: r.lang,
        score: Number(r.similarity.toFixed(4)),
        snippet: r.snippet,
        fetchedAt: r.fetched_at,
      });
      if (results.length >= limit) break;
    }

    return JSON.stringify({ seedUrl: url, count: results.length, results }, null, 2);
  },
});
