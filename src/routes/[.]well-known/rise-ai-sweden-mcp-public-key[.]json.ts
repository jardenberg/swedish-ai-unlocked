import { createFileRoute } from "@tanstack/react-router";
import { MCP_SIGNING_PUBLIC_JWK } from "@/lib/mcp/public-key";

const body = JSON.stringify(
  {
    ...MCP_SIGNING_PUBLIC_JWK,
    spec: "org.jardenberg/verifiable-mcp",
    spec_version: "0.2",
    typ: "verifiable-mcp+jws",
    signed: 'tools/call _meta["org.jardenberg/verifiable-mcp"] wrapper { iat, payload, payload_digest, content_digest, provenance }',
    canonicalization: "RFC 8785 (JCS)",
    jws: "compact",
    server: "https://rise-ai-sweden.jardenberg.org/api/mcp",
  },
  null,
  2,
);

export const Route = createFileRoute("/.well-known/rise-ai-sweden-mcp-public-key.json")({
  server: {
    handlers: {
      GET: async () =>
        new Response(body, {
          headers: {
            "Content-Type": "application/jwk+json; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*",
          },
        }),
    },
  },
});
