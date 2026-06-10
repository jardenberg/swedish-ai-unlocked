import { createClient } from "@supabase/supabase-js";
import { chunkMarkdown } from "/dev-server/src/lib/chunking.server.ts";
import { cleanMarkdown } from "/dev-server/src/lib/markdown-clean.server.ts";
import { embedTexts } from "/dev-server/src/lib/embeddings.server.ts";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const SINCE_HOURS = 24;
const since = new Date(Date.now() - SINCE_HOURS * 3600_000).toISOString();
let cursor = "00000000-0000-0000-0000-000000000000";
let processed = 0, failed = 0, scanned = 0;
const BATCH = 100;

while (true) {
  const { data: docs, error } = await sb
    .from("documents")
    .select("id, raw_markdown")
    .gt("updated_at", since)
    .eq("status", "embedded")
    .not("raw_markdown", "is", null)
    .gt("id", cursor)
    .order("id", { ascending: true })
    .limit(BATCH);
  if (error) { console.error("query err", error); break; }
  if (!docs?.length) break;
  for (const doc of docs) {
    try {
      const cleaned = cleanMarkdown(doc.raw_markdown ?? "");
      const chunks = chunkMarkdown(cleaned);
      if (!chunks.length) { console.log(`skip ${doc.id.slice(0,8)} no chunks`); continue; }
      const all: number[][] = [];
      for (let i = 0; i < chunks.length; i += 20) {
        const vecs = await embedTexts(chunks.slice(i, i + 20).map((c) => c.text));
        all.push(...vecs);
      }
      await sb.from("chunks").delete().eq("document_id", doc.id);
      await sb.from("chunks").insert(chunks.map((c, i) => ({
        document_id: doc.id, ord: c.ord, text: c.text, token_count: c.tokenCount,
        embedding: all[i] as unknown as string,
      })));
      processed++;
    } catch (e) {
      console.error("reclean fail", doc.id.slice(0,8), (e as Error).message);
      failed++;
    }
  }
  scanned += docs.length;
  cursor = docs[docs.length - 1].id;
  console.log(`progress: scanned=${scanned} processed=${processed} failed=${failed}`);
  if (docs.length < BATCH) break;
}
console.log(`DONE reclean scanned=${scanned} processed=${processed} failed=${failed}`);
