import { defineTool } from "mcp-tanstack-start";
import { z } from "zod";

// Hybrid search: vector (semantic) arm + lexical (tsvector / trigram) arm,
// merged with Reciprocal Rank Fusion (k=60). The lexical arm gets a 2x
// weight when the query is short (≤2 tokens) — that's where bare proper
// nouns ("Helsingborg") live and pure vector search structurally fails.
//
// Per-document dedup is preserved by the underlying RPCs (one row per
// document) and again at the fusion step.

type VecRow = {
  chunk_id: string; document_id: string; url: string; title: string | null; lang: string | null;
  source_slug: string; source_name: string; page_type: string;
  snippet: string; similarity: number; fetched_at: string | null;
};
type LexRow = {
  chunk_id: string; document_id: string; url: string; title: string | null; lang: string | null;
  source_slug: string; source_name: string; page_type: string;
  snippet: string; rank: number; fetched_at: string | null;
};

const RRF_K = 60;

export const searchTool = defineTool({
  name: "search_swedish_ai",
  description:
    "Hybrid (semantic + lexical) search across the indexed AI-relevant content published by RISE (Research Institutes of Sweden) and AI Sweden. Returns ranked passages with source URLs. Covers Swedish and English material. Vector search handles topical queries; a lexical arm (tsvector with Swedish/English stemming, plus trigram fallback) handles proper nouns and short keyword queries. Filters: `source`, `lang`, `page_type` (event | news | project | page), `limit` (1–50, default 20).",
  parameters: z.object({
    query: z.string().min(2).max(500).describe("Natural-language search query"),
    source: z.enum(["rise", "ai_sweden"]).optional().describe("Restrict to one source"),
    lang: z.enum(["en", "sv"]).optional().describe("Restrict by language"),
    page_type: z.enum(["event", "news", "project", "page"]).optional()
      .describe("Restrict by URL-derived page type"),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  execute: async ({ query, source, lang, page_type, limit }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { embedQuery } = await import("@/lib/embeddings.server");

    let filterSource: string | null = null;
    if (source) {
      const { data } = await supabaseAdmin.from("sources").select("id").eq("slug", source).single();
      filterSource = data?.id ?? null;
    }

    // Pull deeper arms so RRF has material to fuse.
    const armDepth = Math.max(limit * 3, 30);

    type BaseArgs = {
      match_count: number;
      filter_source?: string;
      filter_lang?: string;
      filter_page_type?: string;
    };
    const baseArgs: BaseArgs = { match_count: armDepth };
    if (filterSource) baseArgs.filter_source = filterSource;
    if (lang) baseArgs.filter_lang = lang;
    if (page_type) baseArgs.filter_page_type = page_type;

    // Vector arm
    const vec = await embedQuery(query);
    const vecArgs = { ...baseArgs, query_embedding: vec as unknown as string };
    const vecResP = supabaseAdmin.rpc("match_chunks", vecArgs);

    // Lexical arm
    const lexArgs = { ...baseArgs, query_text: query };
    const lexResP = supabaseAdmin.rpc("lexical_match_chunks", lexArgs);

    const [vecRes, lexRes] = await Promise.all([vecResP, lexResP]);
    if (vecRes.error) throw new Error(`vector: ${vecRes.error.message}`);
    if (lexRes.error) throw new Error(`lexical: ${lexRes.error.message}`);

    const vecRows = (vecRes.data ?? []) as VecRow[];
    const lexRows = (lexRes.data ?? []) as LexRow[];

    // RRF merge keyed by document_id.
    // Short / proper-noun queries (≤2 tokens) weight lexical 2x.
    const tokenCount = query.trim().split(/\s+/).filter(Boolean).length;
    const lexWeight = tokenCount <= 2 ? 2 : 1;
    const vecWeight = 1;

    type Merged = {
      doc: VecRow | LexRow;
      score: number;
      armScores: { vector?: number; lexical?: number };
    };
    const byDoc = new Map<string, Merged>();

    vecRows.forEach((r, i) => {
      const contrib = vecWeight / (RRF_K + i + 1);
      const cur = byDoc.get(r.document_id);
      if (cur) {
        cur.score += contrib;
        cur.armScores.vector = r.similarity;
      } else {
        byDoc.set(r.document_id, {
          doc: r,
          score: contrib,
          armScores: { vector: r.similarity },
        });
      }
    });

    lexRows.forEach((r, i) => {
      const contrib = lexWeight / (RRF_K + i + 1);
      const cur = byDoc.get(r.document_id);
      if (cur) {
        cur.score += contrib;
        cur.armScores.lexical = r.rank;
        // Prefer lexical snippet/row if vector didn't already have a snippet
        if (!cur.doc.snippet && r.snippet) cur.doc.snippet = r.snippet;
      } else {
        byDoc.set(r.document_id, {
          doc: r,
          score: contrib,
          armScores: { lexical: r.rank },
        });
      }
    });

    const merged = [...byDoc.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ doc, score, armScores }) => ({
        url: doc.url,
        title: doc.title,
        source: doc.source_slug,
        sourceName: doc.source_name,
        lang: doc.lang,
        pageType: doc.page_type,
        score: Number(score.toFixed(4)),
        arms: {
          vector: armScores.vector != null ? Number(armScores.vector.toFixed(4)) : null,
          lexical: armScores.lexical != null ? Number(armScores.lexical.toFixed(4)) : null,
        },
        snippet: doc.snippet,
        fetchedAt: doc.fetched_at,
      }));

    return JSON.stringify({
      query,
      count: merged.length,
      hybrid: { rrfK: RRF_K, weights: { vector: vecWeight, lexical: lexWeight }, tokenCount },
      results: merged,
    }, null, 2);
  },
});
