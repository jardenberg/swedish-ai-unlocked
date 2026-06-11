import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// All ingestion fns require admin role.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!data) throw new Error("Forbidden: admin role required");
}

const SourceSlug = z.object({ sourceSlug: z.enum(["rise", "ai_sweden"]) });

// Backend hard guard: any bulk operation that would reduce the embedded count
// by more than this fraction must be invoked with { force: true }.
const EMBEDDED_DROP_GUARD = 0.10;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function countEmbedded(sb: any, sourceId: string): Promise<number> {
  const { count } = await sb
    .from("documents")
    .select("*", { count: "exact", head: true })
    .eq("source_id", sourceId)
    .eq("status", "embedded")
    .eq("hidden", false);
  return count ?? 0;
}

function writeRunNotes(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

// Build a canonical-URL → row lookup from raw documents rows. Stored URLs may
// predate canonicalizeUrl (bare host, trailing slash, mixed case), so the diff
// MUST canonicalize both sides — otherwise existing rows look like new inserts.
// If two rows collapse to the same canonical key, prefer embedded; tiebreak by
// most recent fetched_at. Returns the dup count so callers can log it.
type ExistingRow = {
  id: string;
  url: string;
  status: string;
  sitemap_lastmod: string | null;
  fetched_at: string | null;
};
function buildCanonicalExistingMap<R extends ExistingRow>(
  rows: R[],
  canon: (u: string) => string,
): { existing: Map<string, R>; dupes: number } {
  const existing = new Map<string, R>();
  let dupes = 0;
  for (const r of rows) {
    const key = canon(r.url);
    const prev = existing.get(key);
    if (!prev) { existing.set(key, r); continue; }
    dupes++;
    const prevEmb = prev.status === "embedded";
    const curEmb = r.status === "embedded";
    if (curEmb && !prevEmb) { existing.set(key, r); continue; }
    if (prevEmb && !curEmb) continue;
    const prevT = prev.fetched_at ? new Date(prev.fetched_at).getTime() : 0;
    const curT = r.fetched_at ? new Date(r.fetched_at).getTime() : 0;
    if (curT > prevT) existing.set(key, r);
  }
  return { existing, dupes };
}

// PostgREST caps .select() at 1000 rows. Paginate so the diff sees ALL docs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllDocuments(sb: any, sourceId: string): Promise<ExistingRow[]> {
  const PAGE = 1000;
  const out: ExistingRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("documents")
      .select("id, url, status, sitemap_lastmod, fetched_at")
      .eq("source_id", sourceId)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as ExistingRow[]));
    if (data.length < PAGE) break;
  }
  return out;
}

export class BulkGuardError extends Error {
  preview: Record<string, unknown>;
  constructor(preview: Record<string, unknown>) {
    super(
      `BulkGuard: operation would reset ${preview.willResetEmbedded} of ${preview.embeddedBefore} embedded docs (>${Math.round(EMBEDDED_DROP_GUARD * 100)}%). Re-run with { force: true } to override.`,
    );
    this.preview = preview;
    this.name = "BulkGuardError";
  }
}

// ──────────────────────────────────────────────────────────────────
// listSources — read for admin UI
// ──────────────────────────────────────────────────────────────────
export const listSourcesAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sources } = await supabaseAdmin.from("sources").select("*").order("name");
    const stats: Record<string, { pending: number; scraped: number; embedded: number; failed: number }> = {};
    for (const s of sources ?? []) {
      const { data: counts } = await supabaseAdmin
        .from("documents")
        .select("status", { count: "exact", head: false })
        .eq("source_id", s.id);
      const c = { pending: 0, scraped: 0, embedded: 0, failed: 0 };
      (counts ?? []).forEach((r: { status: string }) => {
        if (r.status in c) c[r.status as keyof typeof c]++;
      });
      stats[s.id] = c;
    }
    return { sources: sources ?? [], stats };
  });

// ──────────────────────────────────────────────────────────────────
// mapSource — pull sitemap + Firecrawl map, NON-DESTRUCTIVE diff upsert.
// Only inserts new URLs as pending and refreshes existing rows whose
// sitemap lastmod is strictly newer than fetched_at. Untouched URLs
// stay completely untouched (including their status='embedded').
// ──────────────────────────────────────────────────────────────────
const MapInput = z.object({
  sourceSlug: z.enum(["rise", "ai_sweden"]),
  force: z.boolean().optional(),
});

export const mapSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => MapInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getFirecrawl, fetchSitemap, detectLang, urlMatchesFilters } = await import("./firecrawl.server");
    const { canonicalizeUrl } = await import("./url-canonical.server");

    const t0 = Date.now();
    const { data: source, error } = await supabaseAdmin
      .from("sources")
      .select("*")
      .eq("slug", data.sourceSlug)
      .single();
    if (error || !source) throw new Error(`Source ${data.sourceSlug} not found`);

    const embeddedBefore = await countEmbedded(supabaseAdmin, source.id);

    let credits = 0;

    // 1. Sitemap (free, includes lastmod)
    const sitemapEntries = await fetchSitemap(source.root_url);
    const filtered = sitemapEntries.filter((e) =>
      urlMatchesFilters(e.url, source.url_filter_patterns, source.exclude_patterns),
    );

    // 2. Firecrawl map (paid, fills gaps the sitemap misses)
    let mapLinks: string[] = [];
    try {
      const fc = getFirecrawl();
      const mapRes = await fc.map(source.root_url, { limit: 5000, includeSubdomains: false });
      mapLinks = ((mapRes as { links?: Array<string | { url: string }> }).links ?? []).map((l) =>
        typeof l === "string" ? l : l.url,
      );
      credits += 1;
    } catch (e) {
      console.warn("[map] firecrawl map failed:", (e as Error).message);
    }

    // Merge — sitemap entries have lastmod, map-only entries don't
    const lastmodByUrl = new Map<string, string | undefined>();
    for (const e of filtered) lastmodByUrl.set(canonicalizeUrl(e.url), e.lastmod);
    for (const link of mapLinks) {
      if (urlMatchesFilters(link, source.url_filter_patterns, source.exclude_patterns)) {
        const u = canonicalizeUrl(link);
        if (!lastmodByUrl.has(u)) lastmodByUrl.set(u, undefined);
      }
    }

    // Load existing rows for this source so we can diff (paginated — PostgREST 1k cap)
    const existingRows = await fetchAllDocuments(supabaseAdmin, source.id);
    const { existing, dupes: mapDupes } = buildCanonicalExistingMap(existingRows, canonicalizeUrl);
    if (mapDupes > 0) console.warn(`[map] ${mapDupes} legacy duplicate URL rows collapsed (canonical form). Clean up later.`);

    type Refresh = { id: string; sitemap_lastmod: string | null };
    const toInsert: Array<{
      source_id: string; url: string; lang: string; content_type: string;
      sitemap_lastmod: string | null; status: string;
    }> = [];
    const toRefresh: Refresh[] = [];
    let unchanged = 0;

    for (const [url, lastmod] of lastmodByUrl) {
      const row = existing.get(url);
      if (!row) {
        toInsert.push({
          source_id: source.id,
          url,
          lang: detectLang(url),
          content_type: url.toLowerCase().endsWith(".pdf") ? "pdf" : "html",
          sitemap_lastmod: lastmod ?? null,
          status: "pending",
        });
        continue;
      }
      // Decide refresh purely on lastmod vs fetched_at.
      const newer =
        lastmod &&
        (!row.fetched_at || new Date(lastmod).getTime() > new Date(row.fetched_at).getTime());
      if (newer) {
        toRefresh.push({ id: row.id, sitemap_lastmod: lastmod });
      } else {
        unchanged++;
      }
    }

    // Guard: a refresh resets embedded → pending. If too many, require force.
    const wouldResetEmbedded = toRefresh.filter((r) => {
      const row = existingRows!.find((x) => x.id === r.id)!;
      return row.status === "embedded";
    }).length;

    const willInsertSample = toInsert
      .map((r) => r.url)
      .sort()
      .slice(0, 20);
    const preview = {
      op: "map",
      source: data.sourceSlug,
      willInsert: toInsert.length,
      willRefresh: toRefresh.length,
      willResetEmbedded: wouldResetEmbedded,
      unchanged,
      embeddedBefore,
      estCredits: credits,
      willInsertSample,
    };

    if (
      embeddedBefore > 0 &&
      wouldResetEmbedded / Math.max(embeddedBefore, 1) > EMBEDDED_DROP_GUARD &&
      !data.force
    ) {
      throw new BulkGuardError(preview);
    }

    const { data: run } = await supabaseAdmin
      .from("ingest_runs")
      .insert({ source_id: source.id, kind: "map" })
      .select()
      .single();

    // Inserts — onConflict ignore in case of a race (another concurrent map)
    let inserted = 0;
    for (let i = 0; i < toInsert.length; i += 500) {
      const slice = toInsert.slice(i, i + 500);
      const { error: upErr } = await supabaseAdmin
        .from("documents")
        .upsert(slice, { onConflict: "url", ignoreDuplicates: true });
      if (!upErr) inserted += slice.length;
      else console.error("[map] insert error:", upErr.message);
    }

    // Refreshes — flip just the changed rows
    let refreshed = 0;
    for (const r of toRefresh) {
      const { error: uErr } = await supabaseAdmin
        .from("documents")
        .update({ status: "pending", sitemap_lastmod: r.sitemap_lastmod })
        .eq("id", r.id);
      if (!uErr) refreshed++;
    }

    const embeddedAfter = await countEmbedded(supabaseAdmin, source.id);
    const notes = writeRunNotes({
      op: "map",
      force: !!data.force,
      inserted,
      refreshed,
      unchanged,
      sitemapUrls: filtered.length,
      mapUrls: mapLinks.length,
      embeddedBefore,
      embeddedAfter,
      delta: embeddedAfter - embeddedBefore,
      creditsUsed: credits,
      durationMs: Date.now() - t0,
    });

    await supabaseAdmin
      .from("ingest_runs")
      .update({
        finished_at: new Date().toISOString(),
        mapped: inserted,
        skipped: refreshed,
        credits_used: credits,
        notes,
      })
      .eq("id", run!.id);

    return {
      mapped: inserted,
      inserted,
      refreshed,
      unchanged,
      embeddedBefore,
      embeddedAfter,
      delta: embeddedAfter - embeddedBefore,
      credits,
      runId: run!.id,
    };
  });

// ──────────────────────────────────────────────────────────────────
// previewBulkOp — dry-run impact analysis for guard-eligible ops.
// Same code path as the actual fns, but never writes.
// ──────────────────────────────────────────────────────────────────
const PreviewInput = z.object({
  op: z.enum(["map", "refresh"]),
  sourceSlug: z.enum(["rise", "ai_sweden"]),
});

export const previewBulkOp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PreviewInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { fetchSitemap, urlMatchesFilters } = await import("./firecrawl.server");
    const { canonicalizeUrl } = await import("./url-canonical.server");

    const { data: source } = await supabaseAdmin
      .from("sources").select("*").eq("slug", data.sourceSlug).single();
    if (!source) throw new Error(`Source ${data.sourceSlug} not found`);

    const embeddedBefore = await countEmbedded(supabaseAdmin, source.id);
    const sitemapEntries = await fetchSitemap(source.root_url);
    const filtered = sitemapEntries.filter((e) =>
      urlMatchesFilters(e.url, source.url_filter_patterns, source.exclude_patterns),
    );
    const lastmodByUrl = new Map<string, string | undefined>(
      filtered.map((e) => [canonicalizeUrl(e.url), e.lastmod]),
    );

    const existingRows = await fetchAllDocuments(supabaseAdmin, source.id);

    const { existing, dupes } = buildCanonicalExistingMap(existingRows, canonicalizeUrl);
    if (dupes > 0) console.warn(`[preview] ${dupes} legacy duplicate URL rows collapsed.`);

    let willInsert = 0;
    let willRefresh = 0;
    let willResetEmbedded = 0;
    let unchanged = 0;
    const insertSample: string[] = [];

    if (data.op === "map") {
      for (const [url, lastmod] of lastmodByUrl) {
        const row = existing.get(url);
        if (!row) { willInsert++; insertSample.push(url); continue; }
        const newer =
          lastmod &&
          (!row.fetched_at || new Date(lastmod).getTime() > new Date(row.fetched_at).getTime());
        if (newer) {
          willRefresh++;
          if (row.status === "embedded") willResetEmbedded++;
        } else {
          unchanged++;
        }
      }
    } else {
      // refresh: only diff against existing rows in DB (canonical key)
      for (const row of existingRows ?? []) {
        const key = canonicalizeUrl(row.url);
        const lastmod = lastmodByUrl.get(key);
        const newer =
          lastmod &&
          (!row.sitemap_lastmod || new Date(lastmod).getTime() > new Date(row.sitemap_lastmod).getTime());
        if (newer) {
          willRefresh++;
          if (row.status === "embedded") willResetEmbedded++;
        }
      }
    }

    const guardFraction = embeddedBefore > 0 ? willResetEmbedded / embeddedBefore : 0;
    return {
      op: data.op,
      source: data.sourceSlug,
      willInsert,
      willRefresh,
      willResetEmbedded,
      unchanged,
      embeddedBefore,
      guardFraction,
      guardThreshold: EMBEDDED_DROP_GUARD,
      guardTriggered: guardFraction > EMBEDDED_DROP_GUARD,
      willInsertSample: insertSample.sort().slice(0, 20),
    };
  });

// ──────────────────────────────────────────────────────────────────
// scrapeBatch — pick N pending docs, batch-scrape, store markdown
// ──────────────────────────────────────────────────────────────────
const ScrapeBatchInput = z.object({
  sourceSlug: z.enum(["rise", "ai_sweden"]),
  batchSize: z.number().int().min(1).max(200).default(50),
});


export const scrapeBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ScrapeBatchInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getFirecrawl } = await import("./firecrawl.server");
    const { extractPdf } = await import("./pdf-extract.server");

    const { data: source } = await supabaseAdmin
      .from("sources")
      .select("*")
      .eq("slug", data.sourceSlug)
      .single();
    if (!source) throw new Error("source not found");

    // Pick pending docs (or those whose lastmod changed)
    const { data: pendingDocs } = await supabaseAdmin
      .from("documents")
      .select("*")
      .eq("source_id", source.id)
      .in("status", ["pending"])
      .limit(data.batchSize);

    if (!pendingDocs || pendingDocs.length === 0) {
      return { scraped: 0, failed: 0, credits: 0, message: "No pending documents" };
    }

    const { data: run } = await supabaseAdmin
      .from("ingest_runs")
      .insert({ source_id: source.id, kind: "scrape" })
      .select()
      .single();

    let scraped = 0;
    let failed = 0;
    let credits = 0;

    const htmlDocs = pendingDocs.filter((d) => d.content_type === "html");
    const pdfDocs = pendingDocs.filter((d) => d.content_type === "pdf");

    // HTML — batch via Firecrawl, with per-source include/exclude selectors
    if (htmlDocs.length > 0) {
      try {
        const fc = getFirecrawl();
        const { extractPublishedAtFromHtml } = await import("./published-date.server");
        const includeTags = ((source as { include_tags?: string[] }).include_tags ?? []) as string[];
        const excludeTags = ((source as { exclude_tags?: string[] }).exclude_tags ?? []) as string[];
        const urls = htmlDocs.map((d) => d.url);
        const scrapeOpts: Record<string, unknown> = {
          formats: ["markdown", "rawHtml"],
          onlyMainContent: false,
        };
        if (includeTags.length) scrapeOpts.includeTags = includeTags;
        if (excludeTags.length) scrapeOpts.excludeTags = excludeTags;
        const batchRes = await fc.batchScrape(urls, { options: scrapeOpts } as unknown as Parameters<typeof fc.batchScrape>[1]);
        const docs = ((batchRes as { data?: Array<{ markdown?: string; rawHtml?: string; metadata?: { sourceURL?: string; title?: string; statusCode?: number } }> }).data) ?? [];
        credits += docs.length;
        const byUrl = new Map<string, { markdown: string; title?: string; rawHtml?: string }>();
        for (const d of docs) {
          const u = d.metadata?.sourceURL;
          if (u && d.markdown) byUrl.set(u, { markdown: d.markdown, title: d.metadata?.title, rawHtml: d.rawHtml });
        }
        for (const doc of htmlDocs) {
          let got = byUrl.get(doc.url);
          let filterMiss = false;
          // Defined fallback: include-tags returned empty → retry once with
          // onlyMainContent. Never unfiltered. Mark filter_miss for review.
          if (!got || got.markdown.length <= 100) {
            try {
              const retry = (await fc.scrape(doc.url, {
                formats: ["markdown", "rawHtml"],
                onlyMainContent: true,
                waitFor: 1500,
              } as unknown as Parameters<typeof fc.scrape>[1])) as
                | { markdown?: string; rawHtml?: string; metadata?: { title?: string } }
                | null;
              credits += 1;
              if (retry?.markdown && retry.markdown.length > 100) {
                got = { markdown: retry.markdown, title: retry.metadata?.title, rawHtml: retry.rawHtml };
                filterMiss = true;
              }
            } catch (e) {
              console.warn("[scrape] fallback failed", doc.url, (e as Error).message);
            }
          }
          if (got && got.markdown.length > 100) {
            const pub = extractPublishedAtFromHtml(got.rawHtml ?? null);
            await supabaseAdmin
              .from("documents")
              .update({
                raw_markdown: got.markdown,
                title: got.title ?? doc.title,
                status: "scraped",
                fetched_at: new Date().toISOString(),
                token_count: Math.ceil(got.markdown.length / 4),
                published_at: pub?.date ?? doc.published_at ?? null,
                published_at_source: pub?.source ?? (doc.published_at ? doc.published_at_source : null),
                filter_miss: filterMiss,
                error: null,
              })
              .eq("id", doc.id);
            scraped++;
          } else {
            await supabaseAdmin
              .from("documents")
              .update({ status: "failed", error: "no markdown (after onlyMainContent fallback)", filter_miss: true })
              .eq("id", doc.id);
            failed++;
          }
        }
      } catch (e) {
        console.error("[scrape] batch failed:", (e as Error).message);
        failed += htmlDocs.length;
      }
    }

    // PDFs — one-by-one via unpdf, fallback to Firecrawl
    const { detectLangFromText } = await import("./firecrawl.server");
    for (const doc of pdfDocs) {
      try {
        const res = await extractPdf({
          url: doc.url,
          storagePath: (doc as { storage_path?: string | null }).storage_path ?? undefined,
        });
        if (res.method === "firecrawl") credits += 1;
        if (res.text && res.text.length > 200) {
          const detectedLang = detectLangFromText(res.text);
          await supabaseAdmin
            .from("documents")
            .update({
              raw_markdown: res.text,
              title: res.title ?? doc.title ?? doc.url,
              lang: detectedLang || doc.lang || "en",
              status: "scraped",
              fetched_at: new Date().toISOString(),
              token_count: Math.ceil(res.text.length / 4),
              published_at: res.publishedAt?.date ?? doc.published_at ?? null,
              published_at_source: res.publishedAt?.source ?? (doc.published_at ? doc.published_at_source : null),
              error: null,
            })
            .eq("id", doc.id);
          scraped++;
        } else {
          await supabaseAdmin
            .from("documents")
            .update({ status: "failed", error: `empty PDF (${res.method})` })
            .eq("id", doc.id);
          failed++;
        }
      } catch (e) {
        await supabaseAdmin
          .from("documents")
          .update({ status: "failed", error: (e as Error).message.slice(0, 500) })
          .eq("id", doc.id);
        failed++;
      }
    }



    await supabaseAdmin
      .from("ingest_runs")
      .update({ finished_at: new Date().toISOString(), scraped, failed, credits_used: credits })
      .eq("id", run!.id);

    return { scraped, failed, credits, runId: run!.id };
  });

// ──────────────────────────────────────────────────────────────────
// embedBatch — pick N scraped docs, chunk, embed via Lovable AI, store
// ──────────────────────────────────────────────────────────────────
const EmbedBatchInput = z.object({
  sourceSlug: z.enum(["rise", "ai_sweden"]).optional(),
  batchSize: z.number().int().min(1).max(100).default(25),
});


export const embedBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => EmbedBatchInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { chunkMarkdown } = await import("./chunking.server");
    const { cleanMarkdown } = await import("./markdown-clean.server");
    const { embedTexts } = await import("./embeddings.server");

    let q = supabaseAdmin.from("documents").select("*, sources!inner(slug)").eq("status", "scraped");
    if (data.sourceSlug) q = q.eq("sources.slug", data.sourceSlug);
    const { data: docs } = await q.limit(data.batchSize);

    if (!docs || docs.length === 0) return { embedded: 0, chunks: 0 };

    const { data: run } = await supabaseAdmin
      .from("ingest_runs")
      .insert({ source_id: docs[0].source_id, kind: "embed" })
      .select()
      .single();

    let embedded = 0;
    let totalChunks = 0;
    let failed = 0;

    for (const doc of docs) {
      try {
        const cleaned = cleanMarkdown(doc.raw_markdown ?? "");
        const chunks = chunkMarkdown(cleaned);

        if (chunks.length === 0) {
          await supabaseAdmin
            .from("documents")
            .update({ status: "failed", error: "no chunks" })
            .eq("id", doc.id);
          failed++;
          continue;
        }
        // Embed in sub-batches of 20
        const all: number[][] = [];
        for (let i = 0; i < chunks.length; i += 20) {
          const slice = chunks.slice(i, i + 20).map((c) => c.text);
          const vecs = await embedTexts(slice);
          all.push(...vecs);
        }
        // Atomic chunk swap via SQL function: delete + insert in one tx,
        // so old chunks remain searchable until the new ones land.
        const rows = chunks.map((c, i) => ({
          ord: c.ord,
          text: c.text,
          token_count: c.tokenCount,
          embedding: `[${(all[i] as unknown as number[]).join(",")}]`,
          lang: doc.lang ?? null,
        }));
        const { error: rpcErr } = await supabaseAdmin.rpc("replace_chunks", {
          p_document_id: doc.id,
          p_rows: rows,
        });
        if (rpcErr) throw rpcErr;
        await supabaseAdmin
          .from("documents")
          .update({ status: "embedded", error: null })
          .eq("id", doc.id);
        embedded++;
        totalChunks += chunks.length;
      } catch (e) {
        await supabaseAdmin
          .from("documents")
          .update({ status: "failed", error: (e as Error).message.slice(0, 500) })
          .eq("id", doc.id);
        failed++;
      }
    }

    await supabaseAdmin
      .from("ingest_runs")
      .update({ finished_at: new Date().toISOString(), embedded, failed, notes: `${totalChunks} chunks` })
      .eq("id", run!.id);

    return { embedded, chunks: totalChunks, failed };
  });

// ──────────────────────────────────────────────────────────────────
// refreshSitemap — diff sitemap lastmod, mark stale docs as pending.
// Same guard as mapSource: > EMBEDDED_DROP_GUARD reset requires force.
// ──────────────────────────────────────────────────────────────────
const RefreshInput = z.object({
  sourceSlug: z.enum(["rise", "ai_sweden"]),
  force: z.boolean().optional(),
});

export const refreshSitemap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => RefreshInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { fetchSitemap } = await import("./firecrawl.server");

    const t0 = Date.now();
    const { data: source } = await supabaseAdmin
      .from("sources").select("*").eq("slug", data.sourceSlug).single();
    if (!source) throw new Error("source not found");

    const embeddedBefore = await countEmbedded(supabaseAdmin, source.id);

    const sitemap = await fetchSitemap(source.root_url);
    const { canonicalizeUrl } = await import("./url-canonical.server");
    const lastmodByUrl = new Map(sitemap.map((e) => [canonicalizeUrl(e.url), e.lastmod]));

    const { data: existing } = await supabaseAdmin
      .from("documents")
      .select("id, url, status, sitemap_lastmod, fetched_at")
      .eq("source_id", source.id);

    type Stale = { id: string; lastmod: string; wasEmbedded: boolean };
    const stale: Stale[] = [];
    for (const doc of existing ?? []) {
      const newLastmod = lastmodByUrl.get(canonicalizeUrl(doc.url));
      if (newLastmod && (!doc.sitemap_lastmod || new Date(newLastmod) > new Date(doc.sitemap_lastmod))) {
        stale.push({ id: doc.id, lastmod: newLastmod, wasEmbedded: doc.status === "embedded" });
      }
    }
    const willResetEmbedded = stale.filter((s) => s.wasEmbedded).length;

    const preview = {
      op: "refresh",
      source: data.sourceSlug,
      willRefresh: stale.length,
      willResetEmbedded,
      embeddedBefore,
    };

    if (
      embeddedBefore > 0 &&
      willResetEmbedded / Math.max(embeddedBefore, 1) > EMBEDDED_DROP_GUARD &&
      !data.force
    ) {
      throw new BulkGuardError(preview);
    }

    for (const s of stale) {
      await supabaseAdmin
        .from("documents")
        .update({ status: "pending", sitemap_lastmod: s.lastmod })
        .eq("id", s.id);
    }

    const embeddedAfter = await countEmbedded(supabaseAdmin, source.id);
    const notes = writeRunNotes({
      op: "refresh",
      force: !!data.force,
      stale: stale.length,
      willResetEmbedded,
      embeddedBefore,
      embeddedAfter,
      delta: embeddedAfter - embeddedBefore,
      durationMs: Date.now() - t0,
    });
    await supabaseAdmin.from("ingest_runs").insert({
      source_id: source.id,
      kind: "refresh",
      finished_at: new Date().toISOString(),
      skipped: stale.length,
      notes,
    });

    return {
      stale: stale.length,
      totalInSitemap: sitemap.length,
      embeddedBefore,
      embeddedAfter,
      delta: embeddedAfter - embeddedBefore,
    };
  });

// ──────────────────────────────────────────────────────────────────
// discoverPdfs — scan already-scraped markdown for .pdf links, add as docs
// ──────────────────────────────────────────────────────────────────
export const discoverPdfs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SourceSlug.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { canonicalizeUrl } = await import("./url-canonical.server");
    const { detectLang, isJunkPdfUrl } = await import("./firecrawl.server");

    const { data: source } = await supabaseAdmin
      .from("sources").select("*").eq("slug", data.sourceSlug).single();
    if (!source) throw new Error("source not found");

    // Pull existing URLs (set) to skip duplicates cheaply
    const { data: existing } = await supabaseAdmin
      .from("documents").select("url").eq("source_id", source.id);
    const known = new Set((existing ?? []).map((d) => d.url));

    // Stream over scraped docs in pages of 200
    const PDF_RE = /\(([^)\s]+\.pdf)(?:[?#][^)\s]*)?\)|href=["']([^"'\s]+\.pdf)(?:[?#][^"'\s]*)?["']/gi;
    const found = new Set<string>();
    const baseHost = new URL(source.root_url).hostname.replace(/^www\./, "");

    let from = 0;
    const PAGE = 200;
    for (;;) {
      const { data: page } = await supabaseAdmin
        .from("documents")
        .select("url, raw_markdown")
        .eq("source_id", source.id)
        .not("raw_markdown", "is", null)
        .range(from, from + PAGE - 1);
      if (!page || page.length === 0) break;
      for (const d of page) {
        const md = d.raw_markdown ?? "";
        let m: RegExpExecArray | null;
        PDF_RE.lastIndex = 0;
        while ((m = PDF_RE.exec(md)) !== null) {
          const raw = m[1] ?? m[2];
          if (!raw) continue;
          let abs: string;
          try {
            abs = new URL(raw, d.url).toString();
          } catch { continue; }
          const u = canonicalizeUrl(abs);
          if (!u.toLowerCase().endsWith(".pdf")) continue;
          if (isJunkPdfUrl(u)) continue;
          // Only same-domain PDFs (matches source site, ignoring subdomain `www`)
          try {
            const h = new URL(u).hostname.replace(/^www\./, "");
            if (h !== baseHost) continue;
          } catch { continue; }
          if (known.has(u) || found.has(u)) continue;
          found.add(u);

        }
      }
      if (page.length < PAGE) break;
      from += PAGE;
    }

    const rows = Array.from(found).map((url) => ({
      source_id: source.id,
      url,
      lang: detectLang(url),
      content_type: "pdf",
      status: "pending",
    }));

    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const slice = rows.slice(i, i + 500);
      const { error } = await supabaseAdmin
        .from("documents")
        .upsert(slice, { onConflict: "url", ignoreDuplicates: true });
      if (!error) inserted += slice.length;
    }
    return { discovered: found.size, inserted };
  });


// ──────────────────────────────────────────────────────────────────
// Recent docs and runs for admin UI
// ──────────────────────────────────────────────────────────────────
export const listRecentDocs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        status: z.string().optional(),
        limit: z.number().default(50),
        includeHidden: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("documents")
      .select(
        "id, url, title, lang, content_type, status, error, fetched_at, hidden, published_at, published_at_source, sources(slug)",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status) q = q.eq("status", data.status);
    if (!data.includeHidden) q = q.eq("hidden", false);
    const { data: rows } = await q;
    return { docs: rows ?? [] };
  });


export const listRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("ingest_runs")
      .select("*, sources(slug, name)")
      .order("started_at", { ascending: false })
      .limit(50);
    return { runs: data ?? [] };
  });

// Public stats for the landing page
export const publicStats = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ count: docCount }, { count: chunkCount }, { data: sources }] = await Promise.all([
    supabaseAdmin.from("documents").select("*", { count: "exact", head: true }).eq("status", "embedded"),
    supabaseAdmin.from("chunks").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("sources").select("slug, name"),
  ]);
  return { documents: docCount ?? 0, chunks: chunkCount ?? 0, sources: sources ?? [] };
});

// ──────────────────────────────────────────────────────────────────
// uploadManualPdf — admin uploads a PDF that the crawler can't reach
// (e.g. form-gated). Stored in the private `manual-pdfs` bucket; the
// document's public URL stays as the canonical landing page so all
// citations point back to the publisher.
// ──────────────────────────────────────────────────────────────────
const UploadPdfInput = z.object({
  canonicalUrl: z.string().url().max(1000),
  title: z.string().min(1).max(500),
  sourceSlug: z.enum(["rise", "ai_sweden"]),
  lang: z.enum(["en", "sv"]),
  fileBase64: z.string().min(1).max(70_000_000), // ~52 MB decoded
  mimeType: z.string().refine((m) => m === "application/pdf", "must be application/pdf"),
});

export const uploadManualPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UploadPdfInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { canonicalizeUrl } = await import("./url-canonical.server");

    const url = canonicalizeUrl(data.canonicalUrl);

    // Resolve source
    const { data: source } = await supabaseAdmin
      .from("sources").select("id").eq("slug", data.sourceSlug).single();
    if (!source) throw new Error("source not found");

    // Dedupe on canonical URL
    const { data: existing } = await supabaseAdmin
      .from("documents").select("id").eq("url", url).maybeSingle();
    if (existing) throw new Error("A document with this canonical URL already exists");

    // Decode base64 → bytes
    const bytes = Uint8Array.from(atob(data.fileBase64), (c) => c.charCodeAt(0));
    if (bytes.length > 55 * 1024 * 1024) throw new Error("File exceeds 55 MB limit");

    // Storage path
    const id = crypto.randomUUID();
    const storagePath = `${data.sourceSlug}/${id}.pdf`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("manual-pdfs")
      .upload(storagePath, bytes, { contentType: "application/pdf", upsert: false });
    if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);

    // Insert document
    const { data: doc, error: insErr } = await supabaseAdmin
      .from("documents")
      .insert({
        source_id: source.id,
        url,
        title: data.title,
        lang: data.lang,
        content_type: "pdf",
        status: "pending",
        storage_path: storagePath,
      })
      .select()
      .single();
    if (insErr) {
      // Roll back storage on insert failure
      await supabaseAdmin.storage.from("manual-pdfs").remove([storagePath]);
      throw new Error(`document insert failed: ${insErr.message}`);
    }

    return { id: doc.id, url, storagePath };
  });

// ──────────────────────────────────────────────────────────────────
// retryDocument / retryFailed — reset failed docs back to pending so
// the next scrape/embed batch picks them up (with the improved logic).
// ──────────────────────────────────────────────────────────────────
export const retryDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // If it had markdown but failed during embed, send it back to 'scraped'.
    const { data: doc } = await supabaseAdmin
      .from("documents")
      .select("id, raw_markdown")
      .eq("id", data.id)
      .single();
    if (!doc) throw new Error("document not found");
    const nextStatus = doc.raw_markdown && doc.raw_markdown.length > 100 ? "scraped" : "pending";
    const { error } = await supabaseAdmin
      .from("documents")
      .update({ status: nextStatus, error: null })
      .eq("id", data.id);
    if (error) throw error;
    return { id: data.id, status: nextStatus };
  });

export const retryAllFailed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ sourceSlug: z.enum(["rise", "ai_sweden"]).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("documents").select("id, raw_markdown").eq("status", "failed");
    if (data.sourceSlug) {
      const { data: src } = await supabaseAdmin
        .from("sources").select("id").eq("slug", data.sourceSlug).single();
      if (src) q = q.eq("source_id", src.id);
    }
    const { data: rows } = await q.limit(2000);
    const toScraped = (rows ?? []).filter((r) => r.raw_markdown && r.raw_markdown.length > 100).map((r) => r.id);
    const toPending = (rows ?? []).filter((r) => !(r.raw_markdown && r.raw_markdown.length > 100)).map((r) => r.id);
    if (toScraped.length) {
      await supabaseAdmin.from("documents").update({ status: "scraped", error: null }).in("id", toScraped);
    }
    if (toPending.length) {
      await supabaseAdmin.from("documents").update({ status: "pending", error: null }).in("id", toPending);
    }
    return { reset: (rows ?? []).length, toScraped: toScraped.length, toPending: toPending.length };
  });

// ──────────────────────────────────────────────────────────────────
// setDocumentHidden — admin curation toggle
// ──────────────────────────────────────────────────────────────────
export const setDocumentHidden = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), hidden: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("documents")
      .update({ hidden: data.hidden })
      .eq("id", data.id);
    if (error) throw error;
    return { id: data.id, hidden: data.hidden };
  });

// ──────────────────────────────────────────────────────────────────
// recleanAndReembed — re-run cleaner + chunk + embed for docs whose
// raw markdown was captured by the relaxed onlyMainContent=false retry
// path (which can leak menu trees). Default window: last 24h.
// ──────────────────────────────────────────────────────────────────
export const recleanAndReembed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sinceHours: z.number().int().min(1).max(24 * 30).default(24),
        limit: z.number().int().min(1).max(500).default(100),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { chunkMarkdown } = await import("./chunking.server");
    const { cleanMarkdown } = await import("./markdown-clean.server");
    const { embedTexts } = await import("./embeddings.server");

    const since = new Date(Date.now() - data.sinceHours * 3600 * 1000).toISOString();
    const { data: docs } = await supabaseAdmin
      .from("documents")
      .select("id, raw_markdown, lang")
      .gt("updated_at", since)
      .eq("status", "embedded")
      .not("raw_markdown", "is", null)
      .limit(data.limit);

    let processed = 0;
    let failed = 0;
    for (const doc of docs ?? []) {
      try {
        const cleaned = cleanMarkdown(doc.raw_markdown ?? "");
        const chunks = chunkMarkdown(cleaned);
        if (!chunks.length) continue;
        const all: number[][] = [];
        for (let i = 0; i < chunks.length; i += 20) {
          const vecs = await embedTexts(chunks.slice(i, i + 20).map((c) => c.text));
          all.push(...vecs);
        }
        await supabaseAdmin.rpc("replace_chunks", {
          p_document_id: doc.id,
          p_rows: chunks.map((c, i) => ({
            ord: c.ord,
            text: c.text,
            token_count: c.tokenCount,
            embedding: `[${(all[i] as unknown as number[]).join(",")}]`,
            lang: doc.lang ?? null,
          })),
        });
        processed++;
      } catch (e) {
        console.error("[reclean] failed", doc.id, (e as Error).message);
        failed++;
      }
    }
    return { processed, failed, window: data.sinceHours };
  });

// ──────────────────────────────────────────────────────────────────
// backfillPublishedDates — fill published_at for existing docs from
// raw_markdown / URL patterns (no re-scrape).
// ──────────────────────────────────────────────────────────────────
export const backfillPublishedDates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ limit: z.number().int().min(1).max(5000).default(1000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { extractPublishedAtFromHtml, extractPublishedAtFromPdfUrl } = await import(
      "./published-date.server"
    );

    const { data: docs } = await supabaseAdmin
      .from("documents")
      .select("id, url, content_type, raw_markdown, sitemap_lastmod")
      .is("published_at", null)
      .limit(data.limit);

    let filled = 0;
    for (const doc of docs ?? []) {
      let pub: { date: string; source: string } | null = null;
      if (doc.content_type === "pdf") {
        pub = extractPublishedAtFromPdfUrl(doc.url);
      } else {
        // Try extracting from raw_markdown (won't catch <meta>, but JSON-LD
        // may have leaked through). For real backfill, the next scrape will
        // capture it via rawHtml.
        pub = extractPublishedAtFromHtml(doc.raw_markdown ?? null);
      }
      if (pub) {
        await supabaseAdmin
          .from("documents")
          .update({ published_at: pub.date, published_at_source: pub.source })
          .eq("id", doc.id);
        filled++;
      }
    }
    return { scanned: docs?.length ?? 0, filled };
  });

// ──────────────────────────────────────────────────────────────────
// runIngestSmokeTests — admin trigger; also called from batch-ingest
// ──────────────────────────────────────────────────────────────────
export const runIngestSmokeTests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runSmokeTests } = await import("./ingest-smoke.server");
    const report = await runSmokeTests(supabaseAdmin);

    // Persist as a fake "smoke" ingest_runs row so admin sees history.
    await supabaseAdmin.from("ingest_runs").insert({
      kind: "smoke",
      finished_at: new Date().toISOString(),
      notes: report.summary,
    });
    return report;
  });
