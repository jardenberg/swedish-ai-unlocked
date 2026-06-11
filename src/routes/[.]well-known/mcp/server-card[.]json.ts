import { createFileRoute } from "@tanstack/react-router";
import {
  VERSION,
  MCP_ENDPOINT,
  MCP_NAME,
  SITE_URL,
  CONTACT_EMAIL,
} from "@/lib/build-version";

const card = {
  $schemaNote:
    "Tracks MCP SEP-1649 server-card draft (revision 2025-05). Update field names as the spec lands.",
  serverInfo: {
    name: MCP_NAME,
    title: "RISE & AI Sweden Public MCP",
    version: VERSION,
  },
  transport: {
    type: "streamable-http",
    endpoint: MCP_ENDPOINT,
  },
  authentication: {
    type: "none",
    note: "Public, no auth, no API key. Rate limited to 60 requests / 5 minutes per IP.",
  },
  capabilities: {
    tools: [
      { name: "search_swedish_ai", description: "Semantic search across RISE and AI Sweden publications (Swedish and English)." },
      { name: "list_latest", description: "Newest indexed documents across both sources; lightweight metadata only." },
      { name: "find_similar", description: "Given an indexed URL, return semantically nearest other documents." },
      { name: "get_document", description: "Full cleaned markdown for a single indexed URL." },
      { name: "list_sources", description: "Sources covered, document counts, language breakdown, last-updated." },
    ],
  },
  documentation: SITE_URL + "/",
  contact: { email: CONTACT_EMAIL },
};

const body = JSON.stringify(card, null, 2);

const methodNotAllowed = () =>
  new Response("Method Not Allowed", {
    status: 405,
    headers: { "Content-Type": "text/plain", Allow: "GET" },
  });

export const Route = createFileRoute("/.well-known/mcp/server-card.json")({
  server: {
    handlers: {
      GET: async () =>
        new Response(body, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        }),
      POST: methodNotAllowed,
      DELETE: methodNotAllowed,
    },
  },
});
