import { buildProvenance } from "./provenance.server";
import { signStructuredContent } from "./signing.server";

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: unknown;
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
    signature?: unknown;
    isError?: boolean;
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

/**
 * Additive trust layer: for a tools/call result whose text content is a JSON
 * object, attach `provenance` to the payload, expose it as `structuredContent`,
 * and attach a compact EdDSA JWS as a sibling `signature` object.
 *
 * Never throws — on any problem the original message is returned untouched.
 */
async function augmentMessage(msg: JsonRpcMessage): Promise<JsonRpcMessage> {
  try {
    const result = msg.result;
    if (!result || !Array.isArray(result.content)) return msg;
    const first = result.content.find((c) => c?.type === "text" && typeof c.text === "string");
    if (!first?.text) return msg;

    let payload: unknown;
    try {
      payload = JSON.parse(first.text);
    } catch {
      return msg;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return msg;

    const base = payload as Record<string, unknown>;
    const provenance = await buildProvenance(base);
    const structuredContent = { ...base, provenance };

    // Keep the human-readable text arm byte-identical in shape (2-space JSON),
    // now including the additive provenance block.
    first.text = JSON.stringify(structuredContent, null, 2);
    result.structuredContent = structuredContent;

    const signature = await signStructuredContent(structuredContent);
    if (signature) result.signature = signature;
    return msg;
  } catch {
    return msg;
  }
}

function isToolsCall(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const arr = Array.isArray(body) ? body : [body];
  return arr.some(
    (m) => m && typeof m === "object" && (m as { method?: string }).method === "tools/call",
  );
}

/**
 * Post-process an MCP response, signing tools/call results.
 * Handles both JSON and SSE (text/event-stream) transport shapes.
 */
export async function signMcpResponse(
  requestBody: unknown,
  response: Response,
): Promise<Response> {
  try {
    if (!isToolsCall(requestBody)) return response;
    if (!response.body || response.status !== 200) return response;

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
