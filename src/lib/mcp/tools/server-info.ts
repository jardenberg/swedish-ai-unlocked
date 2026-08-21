import { defineTool } from "mcp-tanstack-start";
import { z } from "zod";
import { SPEC_ID, SPEC_VERSION } from "../signing.server";
import { SERVER_OPERATOR, SERVER_HOST, LEGAL_BASIS } from "../provenance.server";
import { VERSION } from "@/lib/build-version";

export const serverInfoTool = defineTool({
  name: "server_info",
  description:
    "Identity and scope of this MCP server: name, origin, verifiable-response spec id, build version, dataset statistics (documents per source, total chunks) and last-updated timestamp. Call this first to learn what the server is and how fresh its corpus is.",
  parameters: z.object({}),
  execute: async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: sources } = await supabaseAdmin.from("sources").select("id, slug, name, root_url");

    const perSource: Array<Record<string, unknown>> = [];
    let totalDocuments = 0;
    let lastUpdated: string | null = null;

    for (const s of sources ?? []) {
      const { count } = await supabaseAdmin
        .from("documents")
        .select("*", { count: "exact", head: true })
        .eq("status", "embedded")
        .eq("hidden", false)
        .eq("source_id", s.id);

      const { data: latest } = await supabaseAdmin
        .from("documents")
        .select("fetched_at")
        .eq("status", "embedded")
        .eq("hidden", false)
        .eq("source_id", s.id)
        .order("fetched_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      totalDocuments += count ?? 0;
      const ts = (latest?.fetched_at as string | null) ?? null;
      if (ts && (!lastUpdated || ts > lastUpdated)) lastUpdated = ts;

      perSource.push({
        source: s.slug,
        name: s.name,
        rootUrl: s.root_url,
        documents: count ?? 0,
        lastUpdated: ts,
      });
    }

    const { count: chunkCount } = await supabaseAdmin
      .from("chunks")
      .select("*", { count: "exact", head: true });

    return JSON.stringify(
      {
        name: "rise-ai-sweden",
        title: "RISE & AI Sweden Public MCP",
        server: SERVER_HOST,
        origin: `https://${SERVER_HOST}`,
        endpoint: `https://${SERVER_HOST}/api/mcp`,
        serverOperator: SERVER_OPERATOR,
        version: VERSION,
        spec: SPEC_ID,
        specVersion: SPEC_VERSION,
        serverCard: `https://${SERVER_HOST}/.well-known/mcp.json`,
        authentication: "none",
        rateLimit: "60 requests / 5 minutes per IP",
        legalBasis: LEGAL_BASIS,
        stats: {
          documents: totalDocuments,
          chunks: chunkCount ?? 0,
          sources: perSource,
        },
        lastUpdated,
      },
      null,
      2,
    );
  },
});
