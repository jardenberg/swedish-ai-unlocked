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

  // Retry on 429/5xx with exponential backoff (1s, 2s, 4s).
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
    });
    if (res.ok) {
      const json = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
      return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    }
    const body = await res.text();
    lastErr = `Embeddings failed ${res.status}: ${body.slice(0, 300)}`;
    // Don't retry on auth / bad-request
    if (res.status !== 429 && res.status < 500) break;
    if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
  }
  throw new Error(lastErr);
}

export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embedTexts([text]);
  return v;
}
