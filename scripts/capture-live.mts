import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
const endpoint = "https://rise-ai-sweden.jardenberg.org/api/mcp";
const calls = [
  [
    "initialize",
    {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "freshness-verifier", version: "1" },
    },
  ],
  ["tools/list", {}],
  [
    "tools/call",
    {
      name: "list_latest",
      arguments: { source: "ai_sweden", lang: "sv", page_type: "news", limit: 10 },
    },
  ],
];
const evidence = { checkedAt: new Date().toISOString(), responses: [] };
for (const [method, params] of calls) {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Mcp-Method": method,
      ...(params.name ? { "Mcp-Name": params.name } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await r.text();
  const data = JSON.parse(
    text.split("\n").some((x) => x.startsWith("data:"))
      ? text
          .split("\n")
          .find((x) => x.startsWith("data:"))
          .slice(5)
      : text,
  );
  evidence.responses.push({ method, status: r.status, data });
  if (method === "tools/list") {
    const t = data.result.tools;
    evidence.catalogHash = createHash("sha256")
      .update(canonicalize(t.sort((a, b) => a.name.localeCompare(b.name))))
      .digest("hex");
    console.log({
      tools: t.map((x) => x.name),
      cursor: data.result.nextCursor,
      hash: evidence.catalogHash,
    });
  }
}
writeFileSync(process.argv[2], JSON.stringify(evidence, null, 2) + "\n");
