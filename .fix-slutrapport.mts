import { createClient } from "@supabase/supabase-js";
import { extractPdf } from "./src/lib/pdf-extract.server.ts";
import { detectLangFromText } from "./src/lib/firecrawl.server.ts";
import { chunkMarkdown } from "./src/lib/chunking.server.ts";
import { cleanMarkdown } from "./src/lib/markdown-clean.server.ts";
import { embedTexts } from "./src/lib/embeddings.server.ts";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const ID = "d60f68b2-ca38-4bab-a6ba-9c3be01f49c4";

const { data: doc, error } = await sb.from("documents").select("*").eq("id", ID).single();
if (error || !doc) { console.error("fetch doc:", error); process.exit(1); }
console.log("URL:", doc.url);
console.log("storage_path:", doc.storage_path);

console.log("\n--- extracting ---");
const res = await extractPdf({ url: doc.url, storagePath: doc.storage_path });
console.log(`method=${res.method}, pages=${res.pages}, chars=${res.text.length}`);
if (res.unpdfError) console.log(`unpdfError: ${res.unpdfError}`);

if (!res.text || res.text.length <= 200) {
  console.error("text too short, aborting");
  process.exit(1);
}

const detectedLang = detectLangFromText(res.text);
const provenanceError = res.method === "firecrawl" && res.unpdfError
  ? `[provenance] unpdf bypassed → firecrawl OCR (${res.unpdfError.slice(0, 300)})`
  : null;

console.log("\n--- updating doc → scraped ---");
const { error: updErr } = await sb.from("documents").update({
  raw_markdown: res.text,
  title: res.title ?? doc.title ?? doc.url,
  lang: detectedLang || doc.lang || "en",
  status: "scraped",
  fetched_at: new Date().toISOString(),
  token_count: Math.ceil(res.text.length / 4),
  published_at: res.publishedAt?.date ?? doc.published_at ?? null,
  published_at_source: res.publishedAt?.source ?? (doc.published_at ? doc.published_at_source : null),
  extraction_method: res.method,
  error: provenanceError,
}).eq("id", ID);
if (updErr) { console.error("update failed:", updErr); process.exit(1); }
console.log("scraped ok, lang=", detectedLang, "title=", res.title);

console.log("\n--- chunking & embedding ---");
const cleaned = cleanMarkdown(res.text, { contentType: "pdf" });
const chunks = chunkMarkdown(cleaned, { lang: detectedLang || "en" });
console.log(`${chunks.length} chunks`);
const embeddings = await embedTexts(chunks.map((c) => c.text));
console.log(`${embeddings.length} embeddings`);

const rows = chunks.map((c, i) => ({
  ord: c.ord, text: c.text, token_count: c.tokenCount, embedding: embeddings[i], lang: detectedLang || "en",
}));
const { data: inserted, error: rpcErr } = await sb.rpc("replace_chunks", { p_document_id: ID, p_rows: rows as any });
if (rpcErr) { console.error("replace_chunks failed:", rpcErr); process.exit(1); }
console.log(`inserted ${inserted} chunks`);

const { error: finErr } = await sb.from("documents").update({ status: "embedded" }).eq("id", ID);
if (finErr) { console.error("final update failed:", finErr); process.exit(1); }
console.log("\n✅ status=embedded");

console.log("\n--- acceptance: find_mentions('informationsdriven vård') ---");
const { data: hits } = await sb.rpc("find_mentions_chunks", { query_text: "informationsdriven vård", match_count: 5 });
const ours = (hits ?? []).find((h: any) => h.document_id === ID);
console.log(`total hits: ${hits?.length ?? 0}, this doc included: ${!!ours}`);
if (ours) console.log("snippet:", ours.snippet.slice(0, 200));
