// Standalone batch importer — runs scrape+embed for all pending docs, paced.
import { createClient } from "@supabase/supabase-js";
import Firecrawl from "@mendable/firecrawl-js";
import { chunkMarkdown } from "/dev-server/src/lib/chunking.server.ts";
import { embedTexts } from "/dev-server/src/lib/embeddings.server.ts";
import { cleanMarkdown } from "/dev-server/src/lib/markdown-clean.server.ts";
import { canonicalizeUrl } from "/dev-server/src/lib/url-canonical.server.ts";
import { extractPdf } from "/dev-server/src/lib/pdf-extract.server.ts";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const fc = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });


const SCRAPE_BATCH = 20;
const EMBED_BATCH = 8;
const PAUSE_MS = 3000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type SourceFilters = { include_tags: string[]; exclude_tags: string[] };
const sourceFilterCache = new Map<string, SourceFilters>();
async function getFilters(sourceId: string): Promise<SourceFilters> {
  const cached = sourceFilterCache.get(sourceId);
  if (cached) return cached;
  const { data } = await sb
    .from("sources")
    .select("include_tags, exclude_tags")
    .eq("id", sourceId)
    .single();
  const f: SourceFilters = {
    include_tags: (data?.include_tags as string[]) ?? [],
    exclude_tags: (data?.exclude_tags as string[]) ?? [],
  };
  sourceFilterCache.set(sourceId, f);
  return f;
}

// Counters surfaced in the run summary.
let filterMissCount = 0;
let emptyAfterFallback = 0;

async function scrapeOne(sourceId: string): Promise<number> {
  const { data: docs } = await sb
    .from("documents")
    .select("*")
    .eq("source_id", sourceId)
    .eq("status", "pending")
    .limit(SCRAPE_BATCH);
  if (!docs?.length) return 0;

  const htmlDocs = docs.filter((d) => d.content_type === "html");
  const pdfDocs = docs.filter((d) => d.content_type === "pdf");
  let scraped = 0;
  const filters = await getFilters(sourceId);

  // HTML batch — pass per-source CSS include/exclude selectors
  if (htmlDocs.length) {
    const { extractPublishedAtFromHtml } = await import("/dev-server/src/lib/published-date.server.ts");
    const urls = htmlDocs.map((d) => d.url);
    const scrapeOpts: any = {
      formats: ["markdown", "rawHtml"],
      onlyMainContent: false,
    };
    if (filters.include_tags.length) scrapeOpts.includeTags = filters.include_tags;
    if (filters.exclude_tags.length) scrapeOpts.excludeTags = filters.exclude_tags;

    try {
      const res: any = await fc.batchScrape(urls, { options: scrapeOpts } as any);
      const items = (res?.data ?? []) as any[];
      const byUrl = new Map<string, { markdown: string; title?: string; rawHtml?: string }>();
      for (const it of items) {
        const u = it?.metadata?.sourceURL;
        if (!u) continue;
        const cu = canonicalizeUrl(u);
        if (it.markdown) byUrl.set(cu, { markdown: it.markdown, title: it?.metadata?.title, rawHtml: it?.rawHtml });
      }
      for (const doc of htmlDocs) {
        let got = byUrl.get(doc.url);
        let filterMiss = false;
        // Defined fallback: include-tags returned empty → retry once with
        // onlyMainContent. NEVER an unfiltered fallback. Mark filter_miss.
        if (!got || got.markdown.length <= 100) {
          try {
            const retry: any = await fc.scrape(doc.url, {
              formats: ["markdown", "rawHtml"],
              onlyMainContent: true,
              waitFor: 1500,
            } as any);
            if (retry?.markdown && retry.markdown.length > 100) {
              got = { markdown: retry.markdown, title: retry?.metadata?.title, rawHtml: retry?.rawHtml };
              filterMiss = true;
              filterMissCount++;
              console.warn(`  filter_miss fallback ok: ${doc.url}`);
            } else {
              emptyAfterFallback++;
            }
          } catch (e) {
            console.warn("  fallback failed", doc.url, (e as Error).message);
          }
        }
        if (got && got.markdown.length > 100) {
          const pub = extractPublishedAtFromHtml(got.rawHtml ?? null);
          await sb.from("documents").update({
            raw_markdown: got.markdown,
            title: got.title ?? doc.title,
            status: "scraped",
            fetched_at: new Date().toISOString(),
            token_count: Math.ceil(got.markdown.length / 4),
            published_at: pub?.date ?? doc.published_at ?? null,
            published_at_source: pub?.source ?? (doc.published_at ? doc.published_at_source : null),
            filter_miss: filterMiss,
            error: null,
          }).eq("id", doc.id);
          scraped++;
        } else {
          await sb.from("documents").update({
            status: "failed",
            error: "no markdown returned (after onlyMainContent fallback)",
            filter_miss: true,
          }).eq("id", doc.id);
        }
      }
    } catch (e) {
      console.error("scrape html err", (e as Error).message);
    }
  }

  // PDFs one-by-one (selectors don't apply)
  const { detectLangFromText } = await import("/dev-server/src/lib/firecrawl.server.ts");
  for (const doc of pdfDocs) {
    try {
      const res = await extractPdf({
        url: doc.url,
        storagePath: (doc as { storage_path?: string | null }).storage_path ?? undefined,
      });
      if (res.text && res.text.length > 200) {
        const detected = detectLangFromText(res.text);
        await sb.from("documents").update({
          raw_markdown: res.text,
          title: res.title ?? doc.title ?? new URL(doc.url).pathname.split("/").pop() ?? doc.url,
          lang: detected || doc.lang || "en",
          status: "scraped",
          fetched_at: new Date().toISOString(),
          token_count: Math.ceil(res.text.length / 4),
          published_at: res.publishedAt?.date ?? doc.published_at ?? null,
          published_at_source: res.publishedAt?.source ?? (doc.published_at ? doc.published_at_source : null),
          error: null,
        }).eq("id", doc.id);
        scraped++;
        console.log(`  pdf[${res.method}] ${doc.url} (${res.text.length} chars, lang=${detected})`);
      } else {
        await sb.from("documents").update({ status: "failed", error: `empty pdf (${res.method})` }).eq("id", doc.id);
      }
    } catch (e) {
      await sb.from("documents").update({ status: "failed", error: (e as Error).message.slice(0, 500) }).eq("id", doc.id);
      console.error("pdf err", doc.url, (e as Error).message);
    }
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
      const cleaned = cleanMarkdown(doc.raw_markdown ?? "");
      const chunks = chunkMarkdown(cleaned);
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
      try {
        const { runSmokeTests } = await import("/dev-server/src/lib/ingest-smoke.server.ts");
        const report = await runSmokeTests(sb);
        console.log(`SMOKE: ${report.summary}`);
        await sb.from("ingest_runs").insert({
          kind: "smoke",
          finished_at: new Date().toISOString(),
          notes: report.summary,
        });
      } catch (e) {
        console.error("smoke err", (e as Error).message);
      }
      break;
    }
    console.log(`-- round ${round} done; remaining pending=${totalPending} scraped=${totalScraped}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

