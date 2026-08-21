import { createFileRoute } from "@tanstack/react-router";
import { MCP_SIGNING_PUBLIC_JWK, MCP_SIGNING_KEY_URL, MCP_SIGNING_KID } from "@/lib/mcp/public-key";

const body = JSON.stringify(
  {
    spec: "org.jardenberg.verifiable-mcp/0.2",
    name: "rise-ai-sweden",
    title: "RISE & AI Sweden Public MCP",
    documentation: "https://rise-ai-sweden.jardenberg.org/",
    server_card: "https://rise-ai-sweden.jardenberg.org/.well-known/mcp/server-card.json",
    endpoint: "https://rise-ai-sweden.jardenberg.org/api/mcp",
    transport: "streamable-http",
    authentication: { type: "none" },
    signing: {
      alg: "EdDSA",
      kid: MCP_SIGNING_KID,
      previous_kids: [],
      canonicalization: "RFC 8785 (JCS)",
      signed_scopes: [
        'tools/call _meta["org.jardenberg.verifiable-mcp"] — wrapper { iat, payload, provenance }',
        "tools/call result.signature — structuredContent (v0.1, deprecated, removed in v0.3)",
      ],
      payload_digest: "sha256 over the RFC 8785 canonical payload",
      content_binding: "content[0].text is the RFC 8785 canonical serialization of the payload",
      key_url: MCP_SIGNING_KEY_URL,
    },
    jwks: { keys: [MCP_SIGNING_PUBLIC_JWK] },
  },
  null,
  2,
);

export const Route = createFileRoute("/.well-known/mcp.json")({
  server: {
    handlers: {
      GET: async () =>
        new Response(body, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*",
          },
        }),
    },
  },
});
