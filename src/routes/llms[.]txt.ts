import { createFileRoute } from "@tanstack/react-router";
import { MCP_ENDPOINT, MCP_NAME, SITE_URL, CONTACT_EMAIL } from "@/lib/build-version";

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: async () => {
        let sources: Array<{
          slug: string;
          name: string;
          documents: number;
          en: number;
          sv: number;
          lastUpdated: string | null;
        }> = [];

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: rows } = await supabaseAdmin
            .from("sources")
            .select("id, slug, name");
          for (const s of rows ?? []) {
            const base = supabaseAdmin
              .from("documents")
              .select("*", { count: "exact", head: true })
              .eq("status", "embedded")
              .eq("hidden", false)
              .eq("source_id", s.id);
            const [{ count: total }, { count: en }, { count: sv }, latest] = await Promise.all([
              base,
              supabaseAdmin
                .from("documents")
                .select("*", { count: "exact", head: true })
                .eq("status", "embedded")
                .eq("hidden", false)
                .eq("source_id", s.id)
                .eq("lang", "en"),
              supabaseAdmin
                .from("documents")
                .select("*", { count: "exact", head: true })
                .eq("status", "embedded")
                .eq("hidden", false)
                .eq("source_id", s.id)
                .eq("lang", "sv"),
              supabaseAdmin
                .from("documents")
                .select("fetched_at")
                .eq("status", "embedded")
                .eq("hidden", false)
                .eq("source_id", s.id)
                .order("fetched_at", { ascending: false, nullsFirst: false })
                .limit(1)
                .maybeSingle(),
            ]);
            sources.push({
              slug: s.slug,
              name: s.name,
              documents: total ?? 0,
              en: en ?? 0,
              sv: sv ?? 0,
              lastUpdated: latest.data?.fetched_at ?? null,
            });
          }
        } catch {
          sources = [];
        }

        const sourceLines = sources.length
          ? sources
              .map(
                (s) =>
                  `- **${s.name}** (\`${s.slug}\`) — ${s.documents} docs (en: ${s.en}, sv: ${s.sv})` +
                  (s.lastUpdated ? `, last updated ${s.lastUpdated}` : ""),
              )
              .join("\n")
          : "- (live counts temporarily unavailable; see list_sources tool)";

        const md = `# RISE & AI Sweden Public MCP

> A public, no-auth MCP server indexing AI-relevant publications from RISE and AI Sweden, Sweden's two government-funded AI organizations. Provided in good faith to support the agentic AI ecosystem.

Run by Joakim Jardenberg (${CONTACT_EMAIL}) and Lovable.

## MCP endpoint

- URL: ${MCP_ENDPOINT}
- Transport: streamable-http
- Auth: none
- Suggested client name: \`${MCP_NAME}\`

## Tools

- \`search_swedish_ai\` — Semantic search across RISE and AI Sweden publications (sv/en). Filters: \`source\`, \`lang\`, \`limit\` (1–25).
- \`list_latest\` — Newest indexed documents; lightweight metadata only. Filters: \`source\`, \`lang\`, \`limit\` (1–50).
- \`find_similar\` — Given an indexed URL, return semantically nearest documents.
- \`get_document\` — Full cleaned markdown for a single indexed URL.
- \`list_sources\` — Sources covered, document counts, language breakdown, last-updated.

## Rate limit

60 requests / 5 minutes per IP.

## Sources

${sourceLines}

## Links

- Landing page: ${SITE_URL}/
- MCP Server Card: ${SITE_URL}/.well-known/mcp/server-card.json
- Agent skills index: ${SITE_URL}/.well-known/agent-skills/index.json
- Sitemap: ${SITE_URL}/sitemap.xml

## Citation

Every result returned by the MCP includes the original publisher URL on ri.se or ai.se. Agents should cite and link those, not this MCP server.
`;

        return new Response(md, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=600",
          },
        });
      },
    },
  },
});
