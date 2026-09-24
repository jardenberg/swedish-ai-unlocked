import { test } from "node:test";
import assert from "node:assert/strict";
import { readConnector } from "../src/lib/human-client.ts";
test("reads JSON and SSE MCP responses; exposes failures rather than false results", async () => {
  const original = globalThis.fetch;
  try {
    const payload = { sources: [{ name: "RISE" }] };
    for (const stream of [false, true]) {
      globalThis.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        assert.equal(body.params.name, "list_sources");
        assert.equal(options.credentials, "omit");
        const frame = JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { structuredContent: payload },
        });
        return new Response(stream ? `event: message\r\ndata: ${frame}\r\n\r\n` : frame);
      };
      assert.deepEqual(await readConnector("list_sources", {}), payload);
    }
    globalThis.fetch = async () => new Response("", { status: 429 });
    await assert.rejects(readConnector("list_sources", {}), /request limit/);
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ id: 1, result: { isError: true } }));
    await assert.rejects(readConnector("search_swedish_ai", {}), /could not be completed/);
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ id: 1, result: { structuredContent: { error: "Document not found" } } }),
      );
    await assert.rejects(readConnector("get_document", {}), /not in the searchable collection/);
  } finally {
    globalThis.fetch = original;
  }
});
