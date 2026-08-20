// Server-only ingest core. Extracted from ingest.functions.ts so both the
// admin server functions and the daily cron route can share one implementation.
// Backend hard guard: any bulk operation that would reduce the embedded count
// by more than this fraction must be invoked with { force: true }.
export const EMBEDDED_DROP_GUARD = 0.10;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function countEmbedded(sb: any, sourceId: string): Promise<number> {
  const { count } = await sb
    .from("documents")
    .select("*", { count: "exact", head: true })
    .eq("source_id", sourceId)
    .eq("status", "embedded")
    .eq("hidden", false);
  return count ?? 0;
}

export function writeRunNotes(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

// Build a canonical-URL → row lookup from raw documents rows. Stored URLs may
// predate canonicalizeUrl (bare host, trailing slash, mixed case), so the diff
// MUST canonicalize both sides — otherwise existing rows look like new inserts.
// If two rows collapse to the same canonical key, prefer embedded; tiebreak by
// most recent fetched_at. Returns the dup count so callers can log it.
export type ExistingRow = {
  id: string;
  url: string;
  status: string;
  sitemap_lastmod: string | null;
  fetched_at: string | null;
};
export function buildCanonicalExistingMap<R extends ExistingRow>(
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
export async function fetchAllDocuments(sb: any, sourceId: string): Promise<ExistingRow[]> {
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

export type Trigger = "manual" | "cron";

// ──────────────────────────────────────────────────────────────────
export async function refreshSitemapCore(
  args: { sourceSlug: "rise" | "ai_sweden"; force?: boolean; trigger?: Trigger },
) {
  const data = args;
  const trigger: Trigger = args.trigger ?? "manual";
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { fetchSitemap, urlMatchesFilters, detectLang } = await import("./firecrawl.server");

    const t0 = Date.now();
    const { data: source } = await supabaseAdmin
      .from("sources").select("*").eq("slug", data.sourceSlug).single();
    if (!source) throw new Error("source not found");

    const embeddedBefore = await countEmbedded(supabaseAdmin, source.id);

    const sitemap = await fetchSitemap(source.root_url);
    const { canonicalizeUrl } = await import("./url-canonical.server");
    // SCOPE: identical per-source inclusion filtering to mapSource — shared
    // urlMatchesFilters + the source's own url_filter_patterns/exclude_patterns.
    // Without this, refresh would insert the full ~17.6k-page ri.se sitemap.
    const scoped = sitemap.filter((e) =>
      urlMatchesFilters(e.url, source.url_filter_patterns, source.exclude_patterns),
    );
    const lastmodByUrl = new Map<string, string | undefined>();
    for (const e of scoped) lastmodByUrl.set(canonicalizeUrl(e.url), e.lastmod);

    const existingRows = await fetchAllDocuments(supabaseAdmin, source.id);
    const { existing, dupes } = buildCanonicalExistingMap(existingRows, canonicalizeUrl);
    if (dupes > 0) console.warn(`[refresh] ${dupes} legacy duplicate URL rows collapsed`);

    type Stale = { id: string; lastmod: string; wasEmbedded: boolean };
    const stale: Stale[] = [];
    for (const doc of existingRows) {
      // skipped_offsite rows are permanently parked — never resurrect.
      if (doc.status === "skipped_offsite") continue;
      const newLastmod = lastmodByUrl.get(canonicalizeUrl(doc.url));
      if (newLastmod && (!doc.sitemap_lastmod || new Date(newLastmod) > new Date(doc.sitemap_lastmod))) {
        stale.push({ id: doc.id, lastmod: newLastmod, wasEmbedded: doc.status === "embedded" });
      }
    }

    // NEW URL DISCOVERY: sitemap entries with no existing row (canonical on
    // both sides) become pending docs. Inserts reset nothing, so they don't
    // count against the embedded-drop guard.
    const toInsert: Array<{
      source_id: string; url: string; lang: string; content_type: string;
      sitemap_lastmod: string | null; status: string;
    }> = [];
    for (const [url, lastmod] of lastmodByUrl) {
      if (existing.has(url)) continue;
      toInsert.push({
        source_id: source.id,
        url,
        lang: detectLang(url),
        content_type: url.toLowerCase().endsWith(".pdf") ? "pdf" : "html",
        sitemap_lastmod: lastmod ?? null,
        status: "pending",
      });
    }

    const willResetEmbedded = stale.filter((s) => s.wasEmbedded).length;

    const preview = {
      op: "refresh",
      source: data.sourceSlug,
      willRefresh: stale.length,
      willInsert: toInsert.length,
      willInsertSample: toInsert.map((r) => r.url).sort().slice(0, 20),
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

    let newInserted = 0;
    for (let i = 0; i < toInsert.length; i += 500) {
      const slice = toInsert.slice(i, i + 500);
      const { error: insErr, count } = await supabaseAdmin
        .from("documents")
        .upsert(slice, { onConflict: "url", ignoreDuplicates: true, count: "exact" });
      if (insErr) throw new Error(`insert new docs failed: ${insErr.message}`);
      newInserted += count ?? slice.length;
    }

    const embeddedAfter = await countEmbedded(supabaseAdmin, source.id);
    const notes = writeRunNotes({
      op: "refresh",
      force: !!data.force,
      stale: stale.length,
      newInserted,
      newInsertedSample: toInsert.map((r) => r.url).sort().slice(0, 20),
      willResetEmbedded,
      embeddedBefore,
      embeddedAfter,
      delta: embeddedAfter - embeddedBefore,
      durationMs: Date.now() - t0,
    });
    await supabaseAdmin.from("ingest_runs").insert({
      source_id: source.id,
      kind: "refresh",
      trigger,
      finished_at: new Date().toISOString(),
      skipped: stale.length,
      notes,
    });

    const { snapshotCorpusForSource } = await import("./ingest-helpers.server");
    await snapshotCorpusForSource(supabaseAdmin, source.id);

    return {
      stale: stale.length,
      newInserted,
      totalInSitemap: sitemap.length,
      scopedInSitemap: scoped.length,
      embeddedBefore,
      embeddedAfter,
      delta: embeddedAfter - embeddedBefore,
    };
}

// ──────────────────────────────────────────────────────────────────
export async function scrapeBatchCore(
  args: { sourceSlug: "rise" | "ai_sweden"; batchSize: number; trigger?: Trigger },
) {
  const data = args;
  const trigger: Trigger = args.trigger ?? "manual";
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
      .insert({ source_id: source.id, kind: "scrape", trigger })
      .select()
      .single();

    let scraped = 0;
    let failed = 0;
    let credits = 0;

    const htmlDocs = pendingDocs.filter((d) => d.content_type === "html");
    const pdfDocs = pendingDocs.filter((d) => d.content_type === "pdf");
    let skippedOffsite = 0;

    // Host equality with `www.` stripped (matches scrape paths everywhere).
    const sourceHost = (() => {
      try { return new URL(source.root_url).hostname.replace(/^www\./, ""); }
      catch { return ""; }
    })();
    const isOffsite = (finalUrl: string | undefined): boolean => {
      if (!finalUrl || !sourceHost) return false;
      try {
        const h = new URL(finalUrl).hostname.replace(/^www\./, "");
        return h !== sourceHost;
      } catch { return false; }
    };
    const markSkippedOffsite = async (docId: string, finalUrl: string | undefined, origUrl: string) => {
      // Purge any existing chunks so dead vectors don't pollute search.
      await supabaseAdmin.from("chunks").delete().eq("document_id", docId);
      await supabaseAdmin
        .from("documents")
        .update({
          status: "skipped_offsite",
          hidden: true,
          fetched_at: new Date().toISOString(),
          error: `offsite redirect: ${origUrl} → ${finalUrl ?? "(unknown)"}`,
          filter_miss: false,
        })
        .eq("id", docId);
      skippedOffsite++;
    };

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
        const docs = ((batchRes as { data?: Array<{ markdown?: string; rawHtml?: string; metadata?: { sourceURL?: string; url?: string; title?: string; statusCode?: number } }> }).data) ?? [];
        credits += docs.length;
        // Index by ORIGINAL requested URL — match by metadata.url first (the
        // request URL) and fall back to sourceURL (final). When the final URL
        // is on another host, we never want to index it.
        const byUrl = new Map<string, { markdown: string; title?: string; rawHtml?: string; finalUrl?: string }>();
        for (const d of docs) {
          const final = d.metadata?.sourceURL ?? d.metadata?.url;
          const key = d.metadata?.url ?? final;
          if (key && d.markdown) byUrl.set(key, { markdown: d.markdown, title: d.metadata?.title, rawHtml: d.rawHtml, finalUrl: final });
        }
        for (const doc of htmlDocs) {
          let got = byUrl.get(doc.url);
          if (got && isOffsite(got.finalUrl)) {
            await markSkippedOffsite(doc.id, got.finalUrl, doc.url);
            continue;
          }
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
                | { markdown?: string; rawHtml?: string; metadata?: { sourceURL?: string; url?: string; title?: string } }
                | null;
              credits += 1;
              const retryFinal = retry?.metadata?.sourceURL ?? retry?.metadata?.url;
              if (retry && isOffsite(retryFinal)) {
                await markSkippedOffsite(doc.id, retryFinal, doc.url);
                continue;
              }
              if (retry?.markdown && retry.markdown.length > 100) {
                got = { markdown: retry.markdown, title: retry.metadata?.title, rawHtml: retry.rawHtml, finalUrl: retryFinal };
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
          // Provenance: when we routed via OCR, keep the unpdf reason in `error`
          // (non-fatal annotation) so operators can spot patterns like
          // "large file → Worker memory exhaustion → routinely OCR'd".
          const provenanceError =
            res.method === "firecrawl" && res.unpdfError
              ? `[provenance] unpdf bypassed → firecrawl OCR (${res.unpdfError.slice(0, 300)})`
              : null;
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
              extraction_method: res.method,
              error: provenanceError,
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
      .update({ finished_at: new Date().toISOString(), scraped, failed, credits_used: credits, notes: skippedOffsite ? `skipped_offsite=${skippedOffsite}` : null })
      .eq("id", run!.id);

    const { snapshotCorpusForSource } = await import("./ingest-helpers.server");
    await snapshotCorpusForSource(supabaseAdmin, source.id);

    return { scraped, failed, skippedOffsite, credits, runId: run!.id };
}

// ──────────────────────────────────────────────────────────────────
export async function embedBatchCore(
  args: { sourceSlug?: "rise" | "ai_sweden"; batchSize: number; trigger?: Trigger },
) {
  const data = args;
  const trigger: Trigger = args.trigger ?? "manual";
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
      .insert({ source_id: docs[0].source_id, kind: "embed", trigger })
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

    const { snapshotCorpusForSource } = await import("./ingest-helpers.server");
    if (docs[0]?.source_id) await snapshotCorpusForSource(supabaseAdmin, docs[0].source_id);

    return { embedded, chunks: totalChunks, failed };
}
