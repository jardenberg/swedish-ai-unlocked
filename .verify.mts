import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// (A) find_mentions_total reconciles with raw SQL for ai_sweden / Helsingborg
const { data: src } = await sb.from("sources").select("id").eq("slug","ai_sweden").single();
const { data: total } = await sb.rpc("find_mentions_total", { query_text: "Helsingborg", filter_source: src!.id });
const { count: raw } = await sb.from("documents").select("*", { count: "exact", head: true })
  .eq("status","embedded").eq("hidden", false).eq("source_id", src!.id).ilike("raw_markdown", "%helsingborg%");
console.log("[Acc1] find_mentions_total =", total, "| raw ILIKE =", raw, "| parity =", total === raw);

// (B) Lexical arm — how many distinct docs match Helsingborg?
const { data: lex } = await sb.rpc("lexical_match_chunks", { query_text: "Helsingborg", match_count: 30 });
console.log("[lex] returned", lex?.length, "rows; top urls:");
for (const r of (lex ?? []).slice(0, 10)) console.log("  ", r.url);

// (C) Hybrid: run vector + lexical + RRF (k=60, lex 2x for single-token)
async function embed(q: string) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type":"application/json", "Lovable-API-Key": process.env.LOVABLE_API_KEY! },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: ["Helsingborg"] }),
  });
  const j = await res.json();
  return j.data[0].embedding;
}
const vec = await embed("Helsingborg");
const { data: vRows } = await sb.rpc("match_chunks", { query_embedding: vec as any, match_count: 30 });
const K = 60;
const byDoc = new Map<string, { url: string; score: number; arms: any }>();
(vRows as any[] ?? []).forEach((r, i) => {
  const c = 1 / (K + i + 1);
  byDoc.set(r.document_id, { url: r.url, score: c, arms: { v: r.similarity } });
});
(lex as any[] ?? []).forEach((r, i) => {
  const c = 2 / (K + i + 1);
  const cur = byDoc.get(r.document_id);
  if (cur) { cur.score += c; cur.arms.l = r.rank; }
  else byDoc.set(r.document_id, { url: r.url, score: c, arms: { l: r.rank } });
});
const top = [...byDoc.values()].sort((a,b) => b.score - a.score).slice(0, 10);
console.log("\n[Acc2] hybrid top 10 for 'Helsingborg':");
for (const t of top) console.log(`   ${t.score.toFixed(4)}  ${t.url}`);
const hasNCL = top.some(t => t.url.includes("/national-city-lab"));
console.log("national-city-lab in top 10?", hasNCL);

// (D) page_type distribution
const { data: pts } = await sb.from("documents").select("page_type").eq("status","embedded").eq("hidden",false);
const counts: Record<string,number> = {};
for (const p of (pts ?? []) as any[]) counts[p.page_type] = (counts[p.page_type] ?? 0) + 1;
console.log("\n[page_type]", counts);
