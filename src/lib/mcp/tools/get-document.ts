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
      .select(
        "url, title, lang, page_type, content_type, raw_markdown, fetched_at, published_at, published_at_source, bytes_replaced_at, extraction_method, sources(slug, name)",
      )
      .eq("url", url)
      .eq("status", "embedded")
      .eq("hidden", false)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return JSON.stringify({ error: "Document not found", url });

    const MAX = 80_000;
    const md = data.raw_markdown ?? "";
    const truncated = md.length > MAX;
    const replacedAt = (data as { bytes_replaced_at?: string | null }).bytes_replaced_at ?? null;
    const extractionMethod =
      (data as { extraction_method?: string | null }).extraction_method ?? null;
    const noteParts: string[] = [];
    if (replacedAt) {
      noteParts.push(
        `Stored copy manually replaced on ${replacedAt.slice(0, 10)}; the canonical source remains the publisher URL.`,
      );
    }
    if (extractionMethod === "firecrawl") {
      noteParts.push(
        "Text was extracted via Firecrawl OCR (in-process parser was bypassed for this file).",
      );
    }
    const contentNote = noteParts.length ? noteParts.join(" ") : null;
    return JSON.stringify({
      url: data.url,
      title: data.title,
      lang: data.lang,
      pageType: data.page_type,
      contentType: data.content_type,
      source: (data.sources as { slug?: string } | null)?.slug,
      sourceName: (data.sources as { name?: string } | null)?.name,
      publishedAt: data.published_at,
      publishedAtSource: data.published_at_source,
      fetchedAt: data.fetched_at,
      bytesReplacedAt: replacedAt,
      extractionMethod,
      contentNote,
      content: truncated ? md.slice(0, MAX) + "\n\n[... truncated, full length: " + md.length + " chars]" : md,
      truncated,
    }, null, 2);
  },
});


