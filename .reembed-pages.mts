import { createClient } from "@supabase/supabase-js";
import { cleanMarkdown } from "./src/lib/markdown-clean.server";
import { chunkMarkdown } from "./src/lib/chunking.server";
import { embedTexts } from "./src/lib/embeddings.server";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data: docs } = await sb
  .from("documents")
  .select("*")
  .eq("status", "scraped")
  .in("url", [
    "https://www.ai.se/en/ai-labs/ai-security/updates-ai-security",
    "https://www.ai.se/sv/ai-labs/ai-security/uppdateringar-om-ai-security",
  ]);
console.log("re-embedding", docs?.length);

for (const doc of docs ?? []) {
  const cleaned = cleanMarkdown(doc.raw_markdown ?? "");
  const chunks = chunkMarkdown(cleaned);
  const all: number[][] = [];
  for (let i = 0; i < chunks.length; i += 20) {
    const vecs = await embedTexts(chunks.slice(i, i + 20).map((c) => c.text));
    all.push(...vecs);
  }
  const rows = chunks.map((c, i) => ({
    ord: c.ord, text: c.text, token_count: c.tokenCount,
    embedding: `[${all[i]!.join(",")}]`, lang: doc.lang ?? null,
  }));
  const { error } = await sb.rpc("replace_chunks", { p_document_id: doc.id, p_rows: rows });
  if (error) { console.error(doc.url, error.message); continue; }
  await sb.from("documents").update({ status: "embedded", error: null, filter_miss: false }).eq("id", doc.id);
  console.log("  embedded", doc.url, "chunks:", chunks.length);
}
console.log("done");
