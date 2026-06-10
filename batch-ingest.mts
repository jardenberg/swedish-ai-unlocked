// Standalone batch importer — runs scrape+embed for all pending docs, paced.
import { createClient } from "@supabase/supabase-js";
import Firecrawl from "@mendable/firecrawl-js";
import { chunkMarkdown } from "/dev-server/src/lib/chunking.server.ts";
import { embedTexts } from "/dev-server/src/lib/embeddings.server.ts";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const fc = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });

const SCRAPE_BATCH = 20;
const EMBED_BATCH = 8;
const PAUSE_MS = 3000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function scrapeOne(sourceId: string): Promise<number> {
  const { data: docs } = await sb
    .from("documents")
    .select("*")
    .eq("source_id", sourceId)
    .eq("status", "pending")
    .eq("content_type", "html")
    .limit(SCRAPE_BATCH);
  if (!docs?.length) return 0;

  const urls = docs.map((d) => d.url);
  let scraped = 0;
  try {
    const res: any = await fc.batchScrape(urls, {
      options: { formats: ["markdown"], onlyMainContent: true },
    } as any);
    const items = (res?.data ?? []) as any[];
    const byUrl = new Map<string, { markdown: string; title?: string }>();
    for (const it of items) {
      const u = it?.metadata?.sourceURL;
      if (u && it.markdown) byUrl.set(u, { markdown: it.markdown, title: it?.metadata?.title });
    }
    for (const doc of docs) {
      const got = byUrl.get(doc.url);
      if (got && got.markdown.length > 100) {
        await sb.from("documents").update({
          raw_markdown: got.markdown,
          title: got.title ?? doc.title,
          status: "scraped",
          fetched_at: new Date().toISOString(),
          token_count: Math.ceil(got.markdown.length / 4),
          error: null,
        }).eq("id", doc.id);
        scraped++;
      } else {
        await sb.from("documents").update({ status: "failed", error: "no markdown returned" }).eq("id", doc.id);
      }
    }
  } catch (e) {
    console.error("scrape err", (e as Error).message);
  }
  return scraped;
}

async function embedSome(sourceId: string): Promise<{ docs: number; chunks: number }> {
  const { data: docs } = await sb
    .from("documents")
    .select("*")
    .eq("source_id", sourceId)
    .eq("status", "scraped")
    .limit(EMBED_BATCH);
  if (!docs?.length) return { docs: 0, chunks: 0 };

  let embedded = 0;
  let totalChunks = 0;
  for (const doc of docs) {
    try {
      const chunks = chunkMarkdown(doc.raw_markdown ?? "");
      if (!chunks.length) {
        await sb.from("documents").update({ status: "failed", error: "no chunks" }).eq("id", doc.id);
        continue;
      }
      const all: number[][] = [];
      for (let i = 0; i < chunks.length; i += 20) {
        const vecs = await embedTexts(chunks.slice(i, i + 20).map((c) => c.text));
        all.push(...vecs);
      }
      await sb.from("chunks").delete().eq("document_id", doc.id);
      const rows = chunks.map((c, i) => ({
        document_id: doc.id,
        ord: c.ord,
        text: c.text,
        token_count: c.tokenCount,
        embedding: all[i] as unknown as string,
      }));
      const { error } = await sb.from("chunks").insert(rows);
      if (error) throw error;
      await sb.from("documents").update({ status: "embedded", error: null }).eq("id", doc.id);
      embedded++;
      totalChunks += chunks.length;
    } catch (e) {
      await sb.from("documents").update({ status: "failed", error: (e as Error).message.slice(0, 500) }).eq("id", doc.id);
      console.error("embed err", doc.url, (e as Error).message);
    }
  }
  return { docs: embedded, chunks: totalChunks };
}

async function main() {
  const { data: sources } = await sb.from("sources").select("id, slug");
  if (!sources) return;

  let round = 0;
  while (true) {
    round++;
    let totalPending = 0;
    let totalScraped = 0;
    for (const s of sources) {
      const { count: pending } = await sb.from("documents").select("*", { count: "exact", head: true })
        .eq("source_id", s.id).eq("status", "pending");
      const { count: scrapedCount } = await sb.from("documents").select("*", { count: "exact", head: true })
        .eq("source_id", s.id).eq("status", "scraped");
      totalPending += pending ?? 0;
      totalScraped += scrapedCount ?? 0;

      if ((pending ?? 0) > 0) {
        const n = await scrapeOne(s.id);
        console.log(`[${round}] ${s.slug} scraped ${n} (pending was ${pending})`);
        await sleep(PAUSE_MS);
      }
      if ((scrapedCount ?? 0) > 0) {
        const r = await embedSome(s.id);
        console.log(`[${round}] ${s.slug} embedded ${r.docs} docs / ${r.chunks} chunks`);
        await sleep(PAUSE_MS);
      }
    }
    if (totalPending === 0 && totalScraped === 0) {
      console.log("DONE — nothing left pending/scraped");
      break;
    }
    console.log(`-- round ${round} done; remaining pending=${totalPending} scraped=${totalScraped}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
