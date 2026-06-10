import { defineTool } from "mcp-tanstack-start";
import { z } from "zod";

export const getDocumentTool = defineTool({
  name: "get_document",
  description:
    "Fetch the full cleaned markdown content of a single indexed document by URL. Use after search_swedish_ai to get full context for the most relevant hit.",
  parameters: z.object({
    url: z.string().url(),
  }),
  execute: async ({ url }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("documents")
      .select("url, title, lang, content_type, raw_markdown, fetched_at, sources(slug, name)")
      .eq("url", url)
      .eq("status", "embedded")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return JSON.stringify({ error: "Document not found", url });

    // Cap response at ~80 KB
    const MAX = 80_000;
    const md = data.raw_markdown ?? "";
    const truncated = md.length > MAX;
    return JSON.stringify({
      url: data.url,
      title: data.title,
      lang: data.lang,
      contentType: data.content_type,
      source: (data.sources as { slug?: string } | null)?.slug,
      sourceName: (data.sources as { name?: string } | null)?.name,
      fetchedAt: data.fetched_at,
      content: truncated ? md.slice(0, MAX) + "\n\n[... truncated, full length: " + md.length + " chars]" : md,
      truncated,
    }, null, 2);
  },
});
