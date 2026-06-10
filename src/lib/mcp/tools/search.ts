import { defineTool } from "mcp-tanstack-start";
import { z } from "zod";

export const searchTool = defineTool({
  name: "search_swedish_ai",
  description:
    "Semantic search across the indexed AI-relevant content published by RISE (Research Institutes of Sweden) and AI Sweden. Returns ranked passages with source URLs. Covers Swedish and English material. Use this to ground answers about Swedish AI research, projects, policy, ecosystem initiatives, AI labs, sector adoption, and language models.",
  parameters: z.object({
    query: z.string().min(2).max(500).describe("Natural-language search query"),
    source: z.enum(["rise", "ai_sweden"]).optional().describe("Restrict to one source"),
    lang: z.enum(["en", "sv"]).optional().describe("Restrict by language"),
    limit: z.number().int().min(1).max(25).default(10),
  }),
  execute: async ({ query, source, lang, limit }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { embedQuery } = await import("@/lib/embeddings.server");

    let filterSource: string | null = null;
    if (source) {
      const { data } = await supabaseAdmin.from("sources").select("id").eq("slug", source).single();
      filterSource = data?.id ?? null;
    }

    const vec = await embedQuery(query);
    const { data, error } = await supabaseAdmin.rpc("match_chunks", {
      query_embedding: vec as unknown as string,
      match_count: limit,
      filter_source: filterSource,
      filter_lang: lang ?? null,
    });
    if (error) throw new Error(error.message);

    const results = (data ?? []).map((r: {
      url: string; title: string | null; lang: string | null; source_slug: string;
      source_name: string; snippet: string; similarity: number; fetched_at: string | null;
    }) => ({
      url: r.url,
      title: r.title,
      source: r.source_slug,
      sourceName: r.source_name,
      lang: r.lang,
      score: Number(r.similarity.toFixed(4)),
      snippet: r.snippet,
      fetchedAt: r.fetched_at,
    }));

    return JSON.stringify({ query, count: results.length, results }, null, 2);
  },
});
