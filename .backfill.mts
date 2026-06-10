import { createClient } from "@supabase/supabase-js";
import { extractPublishedAtFromHtml, extractPublishedAtFromPdfUrl } from "/dev-server/src/lib/published-date.server.ts";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

let total = 0, filled = 0, batch = 0;
const BATCH = 500;
while (true) {
  const { data: docs, error } = await sb
    .from("documents")
    .select("id, url, content_type, raw_markdown")
    .is("published_at", null)
    .limit(BATCH);
  if (error) { console.error("query err", error); break; }
  if (!docs?.length) break;
  batch++;
  for (const d of docs) {
    let pub: { date: string; source: string } | null = null;
    if (d.content_type === "pdf") pub = extractPublishedAtFromPdfUrl(d.url);
    else pub = extractPublishedAtFromHtml(d.raw_markdown ?? null);
    if (pub) {
      await sb.from("documents").update({ published_at: pub.date, published_at_source: pub.source }).eq("id", d.id);
      filled++;
    }
  }
  total += docs.length;
  console.log(`batch ${batch}: scanned=${docs.length} filled_total=${filled} scanned_total=${total}`);
  if (docs.length < BATCH) break;
}
console.log(`DONE backfill scanned=${total} filled=${filled}`);
