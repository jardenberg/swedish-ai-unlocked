import { createFileRoute } from "@tanstack/react-router";
import { createMcpServer } from "mcp-tanstack-start";

import { getDocumentTool } from "@/lib/mcp/tools/get-document";
import { listSourcesTool } from "@/lib/mcp/tools/list-sources";
import { searchTool } from "@/lib/mcp/tools/search";
import { checkRateLimit, getClientIp } from "@/lib/mcp/rate-limit.server";

const mcp = createMcpServer({
  name: "swedish-ai-librarian",
  version: "0.1.0",
  instructions:
    "Tools for searching AI-relevant content published by Sweden's two government-funded AI organizations: RISE (Research Institutes of Sweden, ri.se) and AI Sweden (ai.se). Covers research projects, reports, blog posts, sector initiatives, AI labs, language models, and adoption stories in both English and Swedish. Start with search_swedish_ai to find passages; follow up with get_document for full text. Use list_sources to discover scope.",
  tools: [searchTool, getDocumentTool, listSourcesTool],
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

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = getClientIp(request);
        const limit = await checkRateLimit(ip);
        if (!limit.ok) return rateLimited();
        const response = await mcp.handleRequest(request);
        response.headers.set("X-RateLimit-Remaining", String(limit.remaining));
        response.headers.set("Cache-Control", "no-store");
        return response;
      },
      GET: async () => methodNotAllowed(),
      DELETE: async () => methodNotAllowed(),
    },
  },
});
