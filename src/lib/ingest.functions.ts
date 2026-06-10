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
// mapSource — pull sitemap + Firecrawl map, filter, upsert documents
// ──────────────────────────────────────────────────────────────────
export const mapSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SourceSlug.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getFirecrawl, fetchSitemap, detectLang, urlMatchesFilters } = await import("./firecrawl.server");

    const { data: source, error } = await supabaseAdmin
      .from("sources")
      .select("*")
      .eq("slug", data.sourceSlug)
      .single();
    if (error || !source) throw new Error(`Source ${data.sourceSlug} not found`);

    const { data: run } = await supabaseAdmin
      .from("ingest_runs")
      .insert({ source_id: source.id, kind: "map" })
      .select()
      .single();

    let mapped = 0;
    let skipped = 0;
    let credits = 0;
    const seen = new Set<string>();

    // 1. Sitemap (free, includes lastmod)
    const sitemapEntries = await fetchSitemap(source.root_url);
    const filtered = sitemapEntries.filter((e) =>
      urlMatchesFilters(e.url, source.url_filter_patterns, source.exclude_patterns),
    );

    // 2. Firecrawl map (paid, fills gaps the sitemap misses)
    let mapLinks: string[] = [];
    try {
      const fc = getFirecrawl();
      const mapRes = await fc.map(source.root_url, {
        limit: 5000,
        includeSubdomains: false,
      });
      mapLinks = ((mapRes as { links?: Array<string | { url: string }> }).links ?? []).map((l) =>
        typeof l === "string" ? l : l.url,
      );
      credits += 1;
    } catch (e) {
      console.warn("[map] firecrawl map failed:", (e as Error).message);
    }

    // Merge — sitemap entries have lastmod, map-only entries don't
    const lastmodByUrl = new Map(filtered.map((e) => [e.url, e.lastmod]));
    for (const link of mapLinks) {
      if (urlMatchesFilters(link, source.url_filter_patterns, source.exclude_patterns)) {
        if (!lastmodByUrl.has(link)) lastmodByUrl.set(link, undefined);
      }
    }

    // Upsert documents
    const { canonicalizeUrl } = await import("./url-canonical.server");
    const rows: Array<{
      source_id: string;
      url: string;
      lang: string;
      content_type: string;
      sitemap_lastmod: string | null;
      status: string;
    }> = [];
    for (const [rawUrl, lastmod] of lastmodByUrl) {
      const url = canonicalizeUrl(rawUrl);
      if (seen.has(url)) continue;
      seen.add(url);
      rows.push({
        source_id: source.id,
        url,
        lang: detectLang(url),
        content_type: url.toLowerCase().endsWith(".pdf") ? "pdf" : "html",
        sitemap_lastmod: lastmod ?? null,
        status: "pending",
      });
      mapped++;
    }


    // Batch upsert (ignore conflicts on url)
    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const slice = rows.slice(i, i + batchSize);
      const { error: upErr } = await supabaseAdmin
        .from("documents")
        .upsert(slice, { onConflict: "url", ignoreDuplicates: false });
      if (upErr) {
        console.error("[map] upsert error:", upErr.message);
        skipped += slice.length;
      }
    }

    await supabaseAdmin
      .from("ingest_runs")
      .update({ finished_at: new Date().toISOString(), mapped, skipped, credits_used: credits })
      .eq("id", run!.id);

    return { mapped, skipped, credits, runId: run!.id };
  });

// ──────────────────────────────────────────────────────────────────
// scrapeBatch — pick N pending docs, batch-scrape, store markdown
// ──────────────────────────────────────────────────────────────────
const ScrapeBatchInput = z.object({
  sourceSlug: z.enum(["rise", "ai_sweden"]),
  batchSize: z.number().int().min(1).max(100).default(25),
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

    // HTML — batch via Firecrawl
    if (htmlDocs.length > 0) {
      try {
        const fc = getFirecrawl();
        const urls = htmlDocs.map((d) => d.url);
        const batchRes = await fc.batchScrape(urls, {
          options: {
            formats: ["markdown"],
            onlyMainContent: true,
          },
        } as unknown as Parameters<typeof fc.batchScrape>[1]);
        const docs = ((batchRes as { data?: Array<{ markdown?: string; metadata?: { sourceURL?: string; title?: string; statusCode?: number } }> }).data) ?? [];
        credits += docs.length;
        const byUrl = new Map<string, { markdown: string; title?: string }>();
        for (const d of docs) {
          const u = d.metadata?.sourceURL;
          if (u && d.markdown) byUrl.set(u, { markdown: d.markdown, title: d.metadata?.title });
        }
        for (const doc of htmlDocs) {
          const got = byUrl.get(doc.url);
          if (got && got.markdown.length > 100) {
            await supabaseAdmin
              .from("documents")
              .update({
                raw_markdown: got.markdown,
                title: got.title ?? doc.title,
                status: "scraped",
                fetched_at: new Date().toISOString(),
                token_count: Math.ceil(got.markdown.length / 4),
                error: null,
              })
              .eq("id", doc.id);
            scraped++;
          } else {
            await supabaseAdmin
              .from("documents")
              .update({ status: "failed", error: "no markdown returned" })
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
    for (const doc of pdfDocs) {
      try {
        const res = await extractPdf(doc.url);
        if (res.method === "firecrawl") credits += 1;
        if (res.text && res.text.length > 200) {
          await supabaseAdmin
            .from("documents")
            .update({
              raw_markdown: res.text,
              title: doc.title ?? new URL(doc.url).pathname.split("/").pop() ?? doc.url,
              status: "scraped",
              fetched_at: new Date().toISOString(),
              token_count: Math.ceil(res.text.length / 4),
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
  batchSize: z.number().int().min(1).max(50).default(10),
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
        // Delete existing chunks then insert
        await supabaseAdmin.from("chunks").delete().eq("document_id", doc.id);
        const rows = chunks.map((c, i) => ({
          document_id: doc.id,
          ord: c.ord,
          text: c.text,
          token_count: c.tokenCount,
          embedding: all[i] as unknown as string,
        }));
        const { error: insErr } = await supabaseAdmin.from("chunks").insert(rows);
        if (insErr) throw insErr;
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
// refreshSitemap — diff sitemap lastmod, mark stale docs as pending
// ──────────────────────────────────────────────────────────────────
export const refreshSitemap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SourceSlug.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { fetchSitemap } = await import("./firecrawl.server");

    const { data: source } = await supabaseAdmin
      .from("sources")
      .select("*")
      .eq("slug", data.sourceSlug)
      .single();
    if (!source) throw new Error("source not found");

    const sitemap = await fetchSitemap(source.root_url);
    const { canonicalizeUrl } = await import("./url-canonical.server");
    const lastmodByUrl = new Map(sitemap.map((e) => [canonicalizeUrl(e.url), e.lastmod]));

    const { data: existing } = await supabaseAdmin
      .from("documents")
      .select("id, url, sitemap_lastmod, fetched_at")
      .eq("source_id", source.id);

    let stale = 0;
    for (const doc of existing ?? []) {
      const newLastmod = lastmodByUrl.get(doc.url);
      if (newLastmod && (!doc.sitemap_lastmod || new Date(newLastmod) > new Date(doc.sitemap_lastmod))) {
        await supabaseAdmin
          .from("documents")
          .update({ status: "pending", sitemap_lastmod: newLastmod })
          .eq("id", doc.id);
        stale++;
      }
    }

    return { stale, totalInSitemap: sitemap.length };
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
    const { detectLang } = await import("./firecrawl.server");

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
  .inputValidator((d: unknown) => z.object({ status: z.string().optional(), limit: z.number().default(50) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("documents")
      .select("id, url, title, lang, content_type, status, error, fetched_at, sources(slug)")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status) q = q.eq("status", data.status);
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
