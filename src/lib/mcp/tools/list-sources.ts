import { defineTool } from "mcp-tanstack-start";
import { z } from "zod";

export const listSourcesTool = defineTool({
  name: "list_sources",
  description:
    "List the data sources covered by this MCP server (RISE and AI Sweden) with document counts, language breakdown, and last-updated timestamp per source. Useful for an agent to discover scope and freshness before querying.",
  parameters: z.object({}),
  execute: async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sources } = await supabaseAdmin
      .from("sources")
      .select("id, slug, name, root_url");

    const out: Array<Record<string, unknown>> = [];
    for (const s of sources ?? []) {
      const { count: total } = await supabaseAdmin
        .from("documents")
        .select("*", { count: "exact", head: true })
        .eq("status", "embedded")
        .eq("source_id", s.id);

      const { count: enCount } = await supabaseAdmin
        .from("documents")
        .select("*", { count: "exact", head: true })
        .eq("status", "embedded")
        .eq("source_id", s.id)
        .eq("lang", "en");

      const { count: svCount } = await supabaseAdmin
        .from("documents")
        .select("*", { count: "exact", head: true })
        .eq("status", "embedded")
        .eq("source_id", s.id)
        .eq("lang", "sv");

      const { data: latest } = await supabaseAdmin
        .from("documents")
        .select("fetched_at")
        .eq("status", "embedded")
        .eq("source_id", s.id)
        .order("fetched_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      out.push({
        slug: s.slug,
        name: s.name,
        rootUrl: s.root_url,
        documents: total ?? 0,
        languages: { en: enCount ?? 0, sv: svCount ?? 0 },
        lastUpdated: latest?.fetched_at ?? null,
      });
    }
    return JSON.stringify({ sources: out }, null, 2);
  },
});
