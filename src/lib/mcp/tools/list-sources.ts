import { defineTool } from "mcp-tanstack-start";
import { z } from "zod";

export const listSourcesTool = defineTool({
  name: "list_sources",
  description:
    "List the data sources covered by this MCP server (RISE and AI Sweden) along with document counts per source. Useful for an agent to discover scope before querying.",
  parameters: z.object({}),
  execute: async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sources } = await supabaseAdmin.from("sources").select("slug, name, root_url");
    const out: Array<Record<string, unknown>> = [];
    for (const s of sources ?? []) {
      const { count: total } = await supabaseAdmin
        .from("documents")
        .select("*", { count: "exact", head: true })
        .eq("status", "embedded")
        .eq("source_id", (await supabaseAdmin.from("sources").select("id").eq("slug", s.slug).single()).data?.id ?? "");
      out.push({ slug: s.slug, name: s.name, rootUrl: s.root_url, documents: total ?? 0 });
    }
    return JSON.stringify({ sources: out }, null, 2);
  },
});
