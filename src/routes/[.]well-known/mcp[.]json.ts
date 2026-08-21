import { createFileRoute } from "@tanstack/react-router";
import { MCP_SIGNING_PUBLIC_JWK, MCP_SIGNING_KEY_URL, MCP_SIGNING_KID } from "@/lib/mcp/public-key";

const body = JSON.stringify(
  {
    spec: "org.jardenberg/verifiable-mcp",
    spec_version: "0.2.1",
    name: "rise-ai-sweden",
    title: "RISE & AI Sweden Public MCP",
    documentation: "https://rise-ai-sweden.jardenberg.org/",
    server_card: "https://rise-ai-sweden.jardenberg.org/.well-known/mcp/server-card.json",
    endpoint: "https://rise-ai-sweden.jardenberg.org/api/mcp",
    transport: "streamable-http",
    authentication: { type: "none" },
    signing: {
      spec: "org.jardenberg/verifiable-mcp",
      spec_version: "0.2.1",
      alg: "EdDSA",
      typ: "verifiable-mcp+jws",
      kid: MCP_SIGNING_KID,
      previous_kids: [],
      canonicalization: "RFC 8785 (JCS)",
      meta_key: "org.jardenberg/verifiable-mcp",
      signed_scopes: [
        'tools/call result._meta["org.jardenberg/verifiable-mcp"] — wrapper { iat, payload, payload_digest, content_digest, provenance }',
        'unknown tool — JSON-RPC error frame, envelope at error.data',
      'JSON-RPC errors — envelope at error.data["org.jardenberg/verifiable-mcp"]; wrapper payload is { id, error } with the envelope removed',
        'tool-level isError results — wrapper payload is { isError: true, message }',
        "tools/call result.signature + result.provenance — deprecated v0.1 siblings at the TOP LEVEL of result, never inside structuredContent (removed in v0.3)",
      ],
      envelope_fields: ["spec", "alg", "kid", "signed", "jws"],
      envelope_note:
        "No security-bearing values outside the JWS; verifiers trust only values recovered from the verified wrapper.",
      payload_digest: "sha256 over the RFC 8785 canonical payload (inside the signed wrapper)",
      content_binding:
        "content_digest (inside the signed wrapper) = sha256 over the exact served bytes of content[0].text",
      key_url: MCP_SIGNING_KEY_URL,
      card_path_note:
        "This /.well-known/mcp.json path follows SEP-2127, which superseded SEP-1649 and settled the path. The dedicated key file is also served.",
      jwks: { keys: [MCP_SIGNING_PUBLIC_JWK] },
    },
    jwks: { keys: [MCP_SIGNING_PUBLIC_JWK] },
  },
  null,
  2,
);

const respond = () =>
  new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });

export const Route = createFileRoute("/.well-known/mcp.json")({
  server: {
    handlers: {
      GET: async () => respond(),
      HEAD: async () => new Response(null, { status: 200, headers: respond().headers }),
    },
  },
});
