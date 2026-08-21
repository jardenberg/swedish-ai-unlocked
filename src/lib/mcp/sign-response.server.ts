import { buildProvenance, buildLegacyProvenance } from "./provenance.server";
import {
  canonicalJson,
  signStructuredContent,
  signWrapper,
  SPEC_NAMESPACE,
} from "./signing.server";


type JsonRpcMessage = {
  jsonrpc?: string;
  id?: unknown;
  error?: unknown;
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
    signature?: unknown;
    _meta?: Record<string, unknown>;
    isError?: boolean;
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

/**
 * v0.2 trust envelope (additive, dual-emitting v0.1).
 *
 * - Signs a wrapper `{ iat, payload, payload_digest, content_digest, provenance }`
 *   — RFC 8785 (JCS) canonical. Both digests live INSIDE the signature.
 * - Envelope lives at `result._meta["org.jardenberg.verifiable-mcp"]` and holds
 *   only `{ spec, alg, kid, signed, jws }` — nothing security-bearing outside.
 * - Content binding is by digest: `content_digest` is SHA-256 over the exact
 *   served bytes of `content[0].text` (which remains canonical JSON here).
 * - Deprecated v0.1 `result.signature` and the in-payload provenance mirror on
 *   `structuredContent` are kept unchanged until v0.3.
 *
 * Never throws — on any problem the original message is returned untouched.
 */
async function augmentResult(msg: JsonRpcMessage): Promise<JsonRpcMessage> {
  try {
    const result = msg.result;
    if (!result || !Array.isArray(result.content)) return msg;
    const first = result.content.find((c) => c?.type === "text" && typeof c.text === "string");
    if (!first?.text) return msg;

    let payload: unknown;
    try {
      payload = JSON.parse(first.text);
    } catch {
      payload = null;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      // Tool-level error (isError) or non-JSON text: signed like any tools/call
      // result, wrapper payload = { isError: true, message: <text arm> }.
      if (result.isError && typeof first.text === "string") {
        const errObj = { isError: true, message: first.text };
        const prov = await buildProvenance(errObj);
        const signedErr = await signWrapper(errObj, prov, first.text);
        if (signedErr) {
          result._meta = { ...(result._meta ?? {}), [SPEC_NAMESPACE]: signedErr.meta };
        }
      }
      return msg;
    }

    const base = payload as Record<string, unknown>;
    const provenance = await buildProvenance(base);

    // Text arm: canonical payload bytes (content binding is by digest).
    first.text = canonicalJson(base);

    // v0.1 (deprecated): structuredContent keeps the provenance mirror.
    const structuredContent = { ...base, provenance: await buildLegacyProvenance(base) };
    result.structuredContent = structuredContent;
    const legacy = await signStructuredContent(structuredContent);
    if (legacy) result.signature = legacy;

    // v0.2: signed wrapper in namespaced _meta.
    const signed = await signWrapper(base, provenance, first.text);
    if (signed) {
      result._meta = { ...(result._meta ?? {}), [SPEC_NAMESPACE]: signed.meta };
    }

    return msg;
  } catch {
    return msg;
  }
}

/** ITEM 6 — signed JSON-RPC errors: wrapper payload = { id, error }. */
async function augmentError(msg: JsonRpcMessage): Promise<JsonRpcMessage> {
  try {
    const error = msg.error;
    if (!error || typeof error !== "object") return msg;
    const errPayload = { id: msg.id ?? null, error };
    const provenance = await buildProvenance(errPayload);
    const signed = await signWrapper(errPayload, provenance);
    if (signed) {
      const existing = (msg._meta as Record<string, unknown> | undefined) ?? {};
      msg._meta = { ...existing, [SPEC_NAMESPACE]: signed.meta };
    }
    return msg;
  } catch {
    return msg;
  }
}


async function augmentMessage(msg: JsonRpcMessage): Promise<JsonRpcMessage> {
  if (msg && typeof msg === "object" && msg.error) return augmentError(msg);
  return augmentResult(msg);
}

function isToolsCall(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const arr = Array.isArray(body) ? body : [body];
  return arr.some(
    (m) => m && typeof m === "object" && (m as { method?: string }).method === "tools/call",
  );
}

/**
 * Post-process an MCP response, signing tools/call results and errors.
 * Handles both JSON and SSE (text/event-stream) transport shapes.
 */
export async function signMcpResponse(
  requestBody: unknown,
  response: Response,
): Promise<Response> {
  try {
    if (!isToolsCall(requestBody)) return response;
    if (!response.body) return response;

    const contentType = response.headers.get("Content-Type") ?? "";
    const raw = await response.text();
    const headers = new Headers(response.headers);

    if (contentType.includes("text/event-stream")) {
      const lines = raw.split("\n");
      const out: string[] = [];
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const jsonText = line.slice(6);
          try {
            const msg = (await augmentMessage(JSON.parse(jsonText))) as unknown;
            out.push("data: " + JSON.stringify(msg));
            continue;
          } catch {
            // fall through to passthrough
          }
        }
        out.push(line);
      }
      return new Response(out.join("\n"), { status: response.status, headers });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return new Response(raw, { status: response.status, headers });
    }
    const augmented = Array.isArray(parsed)
      ? await Promise.all(parsed.map((m) => augmentMessage(m as JsonRpcMessage)))
      : await augmentMessage(parsed as JsonRpcMessage);
    return new Response(JSON.stringify(augmented), { status: response.status, headers });
  } catch {
    return response;
  }
}
