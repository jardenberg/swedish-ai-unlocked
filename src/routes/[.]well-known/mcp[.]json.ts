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
        'tools/call _meta["org.jardenberg.verifiable-mcp"] — wrapper { iat, payload, payload_digest, content_digest, provenance }',
        "JSON-RPC errors — wrapper payload is { id, error }",
        "tools/call result.signature — structuredContent (v0.1, deprecated, removed in v0.3)",
      ],
      envelope_fields: ["spec", "alg", "kid", "signed", "jws"],
      envelope_note:
        "No security-bearing values outside the JWS; verifiers trust only values recovered from the verified wrapper.",
      payload_digest: "sha256 over the RFC 8785 canonical payload (inside the signed wrapper)",
      content_binding:
        "content_digest (inside the signed wrapper) = sha256 over the exact served bytes of content[0].text",
      key_url: MCP_SIGNING_KEY_URL,
      card_path_note:
        "This /.well-known/mcp.json path follows SEP-1649, which is not yet frozen upstream; the path may change. The dedicated key file is also served.",
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
