// Lovable AI Gateway embeddings (OpenAI-compatible /v1/embeddings).
// We use openai/text-embedding-3-small (1536 dims) — multilingual, HNSW-indexable,
// and cheap. Matches vector(1536) column in DB.

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/embeddings";
export const EMBED_MODEL = "openai/text-embedding-3-small";
export const EMBED_DIMS = 1536;

export async function embedTexts(inputs: string[]): Promise<number[][]> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY not set");
  if (inputs.length === 0) return [];

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Embeddings failed ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
  // Ensure correct order
  const sorted = json.data.sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embedTexts([text]);
  return v;
}
