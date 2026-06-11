import { createClient } from "@supabase/supabase-js";
import { extractText, getDocumentProxy, getMeta } from "unpdf";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const path = "ai_sweden/d60f68b2-ca38-4bab-a6ba-9c3be01f49c4-1781201466339.pdf";
const t0 = Date.now();
const { data, error } = await sb.storage.from("manual-pdfs").download(path);
if (error || !data) { console.error("download:", error); process.exit(1); }
const bytes = new Uint8Array(await data.arrayBuffer());
console.log(`downloaded ${(bytes.byteLength/1024/1024).toFixed(2)} MB in ${Date.now()-t0}ms`);
console.log(`heap before: rss=${(process.memoryUsage().rss/1024/1024).toFixed(1)}MB`);
try {
  const t1 = Date.now();
  const pdf = await getDocumentProxy(bytes);
  console.log(`getDocumentProxy ok in ${Date.now()-t1}ms, pages=${pdf.numPages}`);
  const meta = await getMeta(pdf).catch((e) => ({ err: String(e) }));
  console.log("meta:", JSON.stringify(meta, null, 2).slice(0, 800));
  const t2 = Date.now();
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  const merged = Array.isArray(text) ? text.join("\n\n") : text;
  console.log(`extractText ok in ${Date.now()-t2}ms, pages=${totalPages}, chars=${merged.length}, density=${(merged.length/Math.max(totalPages,1)).toFixed(1)} chars/page`);
  console.log(`heap after: rss=${(process.memoryUsage().rss/1024/1024).toFixed(1)}MB`);
  console.log("first 500 chars:\n" + merged.slice(0, 500));
} catch (e) {
  console.error("UNPDF THREW:", (e as Error).name, (e as Error).message);
  console.error((e as Error).stack);
}
