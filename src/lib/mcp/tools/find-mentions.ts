import { defineTool } from "mcp-tanstack-start";
import { z } from "zod";

// "Everything that mentions X" primitive. Stemmed tsquery (Swedish + English)
// plus exact ILIKE fallback. Response includes the raw ILIKE document total
// so callers can reconcile with direct SQL.

type Row = {
  document_id: string; url: string; title: string | null; lang: string | null;
  source_slug: string; source_name: string; page_type: string;
  snippet: string; rank: number; match_mode: "exact" | "stemmed";
  fetched_at: string | null;
};

export const findMentionsTool = defineTool({
  name: "find_mentions",
  description:
    "Return documents that mention a specific term — exact substring or stemmed variants. Honest 'everything that mentions X' primitive: lexical only, no embeddings. Useful for proper nouns, organization names, project names, and recall checks. Returns one row per document with best snippet, plus a `total` that mirrors a direct `count(DISTINCT id) WHERE raw_markdown ILIKE '%term%'` query for reconciliation. Filters: `source`, `lang`, `page_type` (event | news | project | page), `limit` (1–100, default 25).",
  parameters: z.object({
    term: z.string().min(1).max(200).describe("Term or short phrase to find mentions of"),
    source: z.enum(["rise", "ai_sweden"]).optional(),
    lang: z.enum(["en", "sv"]).optional(),
    page_type: z.enum(["event", "news", "project", "page"]).optional(),
    limit: z.number().int().min(1).max(100).default(25),
  }),
  execute: async ({ term, source, lang, page_type, limit }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // If the caller passes a URL as the term, canonicalize it so it matches
    // the stored canonical form.
    if (/^https?:\/\//i.test(term)) {
      const { canonicalizeUrl } = await import("@/lib/url-canonical.server");
      term = canonicalizeUrl(term);
    }

    let filterSource: string | null = null;
    if (source) {
      const { data } = await supabaseAdmin.from("sources").select("id").eq("slug", source).single();
      filterSource = data?.id ?? null;
    }

    const args: {
      query_text: string; match_count: number;
      filter_source?: string; filter_lang?: string; filter_page_type?: string;
    } = { query_text: term, match_count: limit };
    if (filterSource) args.filter_source = filterSource;
    if (lang) args.filter_lang = lang;
    if (page_type) args.filter_page_type = page_type;

    const totalArgs: {
      query_text: string;
      filter_source?: string; filter_lang?: string; filter_page_type?: string;
    } = { query_text: term };
    if (filterSource) totalArgs.filter_source = filterSource;
    if (lang) totalArgs.filter_lang = lang;
    if (page_type) totalArgs.filter_page_type = page_type;

    const [hitsRes, totalRes] = await Promise.all([
      supabaseAdmin.rpc("find_mentions_chunks", args),
      supabaseAdmin.rpc("find_mentions_total", totalArgs),
    ]);
    if (hitsRes.error) throw new Error(hitsRes.error.message);
    if (totalRes.error) throw new Error(totalRes.error.message);

    const rows = (hitsRes.data ?? []) as Row[];
    const total = Number(totalRes.data ?? 0);

    const results = rows.map((r) => ({
      url: r.url,
      title: r.title,
      source: r.source_slug,
      sourceName: r.source_name,
      lang: r.lang,
      pageType: r.page_type,
      matchMode: r.match_mode,
      rank: Number(r.rank.toFixed(4)),
      snippet: r.snippet,
      fetchedAt: r.fetched_at,
    }));

    return JSON.stringify({
      term,
      total,
      totalNote: "Exact-substring document count (ILIKE) matching the same filters. Reconciles with raw SQL.",
      returned: results.length,
      results,
    }, null, 2);
  },
});
