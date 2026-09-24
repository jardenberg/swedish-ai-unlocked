// Use the existing public MCP wire: identical retrieval, limits and provenance.
export async function readConnector<T>(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/api/mcp", {
    method: "POST",
    signal,
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Mcp-Method": "tools/call",
      "Mcp-Name": name,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  if (response.status === 429)
    throw new Error(
      "You have reached the shared request limit. Please try again in a few minutes.",
    );
  if (!response.ok) throw new Error("The research service is unavailable. Please try again.");
  const text = await response.text();
  const frames = text
    .split(/\r?\n\r?\n/)
    .map((block) =>
      block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n"),
    )
    .filter(Boolean);
  const wire = frames.length
    ? frames.map((f) => JSON.parse(f)).find((f) => f.id === 1 && (f.result || f.error))
    : JSON.parse(text);
  if (!wire || wire.error || wire.result?.isError)
    throw new Error("That request could not be completed. Please try again or narrow your search.");
  const value = wire.result.structuredContent ?? JSON.parse(wire.result.content[0].text);
  if (value.error)
    throw new Error(
      value.error === "Document not found"
        ? "This document is not in the searchable collection. Try searching for its title."
        : "This document could not be loaded.",
    );
  return value as T;
}
