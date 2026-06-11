import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data: src } = await sb.from("sources").select("id,root_url").eq("slug", "ai_sweden").single();
const srcHost = new URL(src!.root_url).hostname.replace(/^www\./, "");

// Candidates: ai_sweden docs that hit the onlyMainContent fallback. Most are events.
const { data: docs, error } = await sb
  .from("documents")
  .select("id,url,page_type,status")
  .eq("source_id", src!.id)
  .eq("filter_miss", true);
if (error) throw error;
console.log("candidates:", docs!.length);

const offsite: { id: string; url: string; final: string }[] = [];
const onsite: { id: string; url: string; final: string }[] = [];
const errors: { id: string; url: string; err: string }[] = [];

async function finalHost(u: string, maxHops = 10): Promise<string> {
  let cur = u;
  for (let i = 0; i < maxHops; i++) {
    const r = await fetch(cur, { method: "HEAD", redirect: "manual" });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) return cur;
      cur = new URL(loc, cur).toString();
      continue;
    }
    return cur;
  }
  return cur;
}

let i = 0;
const CONC = 12;
async function worker() {
  while (i < docs!.length) {
    const my = i++;
    const d = docs![my]!;
    try {
      const final = await finalHost(d.url);
      const fh = new URL(final).hostname.replace(/^www\./, "");
      if (fh !== srcHost) offsite.push({ id: d.id, url: d.url, final });
      else onsite.push({ id: d.id, url: d.url, final });
    } catch (e) {
      errors.push({ id: d.id, url: d.url, err: (e as Error).message });
    }
    if (my % 50 === 0) console.log(`  ${my}/${docs!.length}…`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

console.log("offsite:", offsite.length, "onsite:", onsite.length, "errors:", errors.length);
if (errors.length) console.log("first errors:", errors.slice(0, 5));
if (onsite.length) {
  console.log("onsite samples (these stay as filter_miss):");
  for (const o of onsite.slice(0, 10)) console.log(" ", o.url);
}

// Apply: mark skipped_offsite + delete chunks
const ids = offsite.map((o) => o.id);
console.log("applying to", ids.length, "docs");
const CHUNK_BATCH = 200;
for (let j = 0; j < ids.length; j += CHUNK_BATCH) {
  const slice = ids.slice(j, j + CHUNK_BATCH);
  const { error: dErr } = await sb.from("chunks").delete().in("document_id", slice);
  if (dErr) console.error("chunks delete:", dErr.message);
  const { error: uErr } = await sb
    .from("documents")
    .update({
      status: "skipped_offsite",
      hidden: true,
      filter_miss: false,
      error: "offsite-redirect backfill (intentional, see ingest_runs)",
    })
    .in("id", slice);
  if (uErr) console.error("docs update:", uErr.message);
}

// Also: scrub the on-domain page misses (the ai-security pages) — re-clean
// chunks via embedBatch. Simplest: flip them to 'scraped' so embedBatch picks
// them up; the new cleanMarkdown strips the skip-link line, then re-embeds.
const { data: pageMiss } = await sb
  .from("documents")
  .select("id,url")
  .eq("source_id", src!.id)
  .eq("filter_miss", true)
  .eq("page_type", "page");
console.log("page-type filter_miss left:", pageMiss?.length ?? 0, pageMiss?.map((p) => p.url));
if (pageMiss?.length) {
  await sb.from("documents").update({ status: "scraped" }).in("id", pageMiss.map((p) => p.id));
}

// Log the operation
await sb.from("ingest_runs").insert({
  source_id: src!.id,
  kind: "backfill",
  finished_at: new Date().toISOString(),
  notes: JSON.stringify({
    op: "offsite-redirect cleanup, intentional",
    candidates: docs!.length,
    skipped_offsite: offsite.length,
    onsite_remaining: onsite.length,
    page_misses_requeued_for_embed: pageMiss?.length ?? 0,
    errors: errors.length,
  }),
});
console.log("done");
