import { test } from "node:test";
import assert from "node:assert/strict";
import { readConnector } from "../src/lib/human-client.ts";
test("reads JSON/SSE, uses unique IDs for concurrent reads, and rejects wrong shapes and errors", async () => {
  const original = globalThis.fetch;
  const seen = new Set();
  const response = (result, options, stream = false) => {
    const body = JSON.parse(options.body);
    assert(!seen.has(body.id));
    seen.add(body.id);
    assert.equal(options.credentials, "omit");
    const frame = JSON.stringify({ jsonrpc: "2.0", id: body.id, result });
    return new Response(stream ? `event: message\r\ndata: ${frame}\r\n\r\n` : frame);
  };
  try {
    globalThis.fetch = async (_url, options) => {
      const name = JSON.parse(options.body).params.name;
      return response(
        { structuredContent: name === "list_sources" ? { sources: [] } : { results: [] } },
        options,
        true,
      );
    };
    const [sources, latest] = await Promise.all([
      readConnector("list_sources", {}),
      readConnector("list_latest", {}),
    ]);
    assert.deepEqual(sources, { sources: [] });
    assert.deepEqual(latest, { results: [] });
    assert.equal(seen.size, 2);
    globalThis.fetch = async (_u, o) => response({ structuredContent: { sources: [] } }, o);
    assert.deepEqual(await readConnector("list_sources", {}), { sources: [] });
    await assert.rejects(readConnector("list_latest", {}), /unexpected response/);
    globalThis.fetch = async () => new Response("", { status: 429 });
    await assert.rejects(readConnector("list_sources", {}), /request limit/);
    globalThis.fetch = async (_u, o) => response({ isError: true }, o);
    await assert.rejects(readConnector("search_swedish_ai", {}), /could not be completed/);
    globalThis.fetch = async (_u, o) =>
      response({ structuredContent: { error: "Document not found" } }, o);
    await assert.rejects(readConnector("get_document", {}), /not in the searchable collection/);
  } finally {
    globalThis.fetch = original;
  }
});
