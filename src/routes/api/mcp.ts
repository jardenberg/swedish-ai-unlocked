import { createFileRoute } from "@tanstack/react-router";
import { createMcpServer } from "mcp-tanstack-start";

import { getDocumentTool } from "@/lib/mcp/tools/get-document";
import { listSourcesTool } from "@/lib/mcp/tools/list-sources";
import { listLatestTool } from "@/lib/mcp/tools/list-latest";
import { findSimilarTool } from "@/lib/mcp/tools/find-similar";
import { searchTool } from "@/lib/mcp/tools/search";
import { findMentionsTool } from "@/lib/mcp/tools/find-mentions";
import { serverInfoTool } from "@/lib/mcp/tools/server-info";
import { checkRateLimit, getClientIp } from "@/lib/mcp/rate-limit.server";

const mcp = createMcpServer({
  name: "swedish-ai-librarian",
  version: "0.3.0",
  instructions:
    "Tools for searching AI-relevant content published by Sweden's two government-funded AI organizations: RISE (Research Institutes of Sweden, ri.se) and AI Sweden (ai.se). Covers research projects, reports, blog posts, sector initiatives, AI labs, language models, and adoption stories in both English and Swedish. Use search_swedish_ai (hybrid semantic + lexical) for topical queries; find_mentions for proper-noun / recall-style 'everything that mentions X' lookups; list_latest for a 'what's new' view; find_similar for more-like-this; get_document for full text; list_sources for scope and freshness; server_info for server identity, spec and dataset statistics. Most tools accept a page_type filter (event | news | project | page).",
  tools: [searchTool, findMentionsTool, listLatestTool, findSimilarTool, getDocumentTool, listSourcesTool, serverInfoTool],
});

const methodNotAllowed = () =>
  new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    }),
    { status: 405, headers: { "Content-Type": "application/json", Allow: "POST, OPTIONS" } },
  );

const rateLimited = () =>
  new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Rate limit exceeded. 60 requests / 5 minutes per IP." },
      id: null,
    }),
    { status: 429, headers: { "Content-Type": "application/json" } },
  );

const TOOL_NAMES = new Set(
  [searchTool, findMentionsTool, listLatestTool, findSimilarTool, getDocumentTool, listSourcesTool, serverInfoTool].map(
    (t) => t.name,
  ),
);

/**
 * Unknown tool → JSON-RPC error frame (signed at error.data), matching the
 * sibling reference servers. Genuine tool-level failures still use isError.
 */
function unknownToolFrame(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const m = body as { method?: string; id?: unknown; params?: { name?: unknown } };
  if (m.method !== "tools/call") return null;
  const name = m.params?.name;
  if (typeof name !== "string" || TOOL_NAMES.has(name)) return null;
  return {
    jsonrpc: "2.0",
    id: m.id ?? null,
    error: { code: -32602, message: `Unknown tool: ${name}` },
  };
}

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = getClientIp(request);
        const limit = await checkRateLimit(ip);
        if (!limit.ok) return rateLimited();

        // Read the body once so we can both forward it and inspect the method.
        const bodyText = await request.text();
        let parsedBody: unknown = null;
        try {
          parsedBody = JSON.parse(bodyText);
        } catch {
          parsedBody = null;
        }

        const { signMcpResponse } = await import("@/lib/mcp/sign-response.server");

        const unknown = unknownToolFrame(parsedBody);
        if (unknown) {
          const errRes = new Response(JSON.stringify(unknown), {
            status: 200,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
          const signedErr = await signMcpResponse(parsedBody, errRes);
          signedErr.headers.set("X-RateLimit-Remaining", String(limit.remaining));
          return signedErr;
        }

        const forwarded = new Request(request.url, {
          method: "POST",
          headers: request.headers,
          body: bodyText,
        });

        const raw = await mcp.handleRequest(forwarded);
        const response = await signMcpResponse(parsedBody, raw);
        response.headers.set("X-RateLimit-Remaining", String(limit.remaining));
        response.headers.set("Cache-Control", "no-store");
        return response;
      },

      GET: async () => methodNotAllowed(),
      DELETE: async () => methodNotAllowed(),
    },
  },
});
