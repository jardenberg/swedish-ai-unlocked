// Admin observability server functions. All require admin role. Numbers
// come from count head queries (never row fetches) so the PostgREST 1k cap
// can't silently lie. See scripts/audit-pagination.mjs.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(sb: any, userId: string) {
  const { data } = await sb.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!data) throw new Error("Forbidden: admin role required");
}

// ───────────────────────────────────────────────────────────────
// getAdminOverview — Corpus Health header data source
// ───────────────────────────────────────────────────────────────
export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { countBySource, countChunksBySource, snapshotAllSources } = await import("./ingest-helpers.server");
    const { VERSION } = await import("./build-version");

    const { data: sources } = await supabaseAdmin
      .from("sources")
      .select("id, slug, name")
      .order("name");

    // Opportunistic snapshot: if newest snapshot is older than 15 min, write one
    // before computing — keeps the 24h-delta chart growing on quiet days
    // without a cron. (A future cron job will also call snapshotAllSources.)
    const { data: newestSnap } = await supabaseAdmin
      .from("corpus_snapshots")
      .select("captured_at")
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const FIFTEEN_MIN = 15 * 60 * 1000;
    if (!newestSnap || Date.now() - new Date(newestSnap.captured_at).getTime() > FIFTEEN_MIN) {
      await snapshotAllSources(supabaseAdmin);
    }

    const perSource = await Promise.all(
      (sources ?? []).map(async (s) => {
        const counts = await countBySource(supabaseAdmin, s.id);
        const chunks = await countChunksBySource(supabaseAdmin, s.id);
        // 24h-ago snapshot (closest to T-24h, but within ±2h window)
        const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { data: ago } = await supabaseAdmin
          .from("corpus_snapshots")
          .select("embedded, captured_at")
          .eq("source_id", s.id)
          .lte("captured_at", cutoff)
          .order("captured_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        // Peak embedded in last 24h
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { data: peakRows } = await supabaseAdmin
          .from("corpus_snapshots")
          .select("embedded, captured_at")
          .eq("source_id", s.id)
          .gte("captured_at", since)
          .order("embedded", { ascending: false })
          .limit(1);
        const peak = peakRows?.[0]?.embedded ?? counts.embedded;
        const embedded24hAgo = ago?.embedded ?? null;
        return {
          id: s.id,
          slug: s.slug,
          name: s.name,
          ...counts,
          chunks,
          embedded24hAgo,
          embedded24hAgoAt: ago?.captured_at ?? null,
          embedded24hPeak: peak,
          belowPeak: counts.embedded < peak ? peak - counts.embedded : 0,
          // First-day case: no baseline yet → null delta, not a fake 0.
          delta24h: embedded24hAgo == null ? null : counts.embedded - embedded24hAgo,
        };
      }),
    );

    // Last smoke run
    const { data: lastSmoke } = await supabaseAdmin
      .from("ingest_runs")
      .select("started_at, notes")
      .eq("kind", "smoke")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const smokeMatch = lastSmoke?.notes?.match(/smoke (\d+)\/(\d+) pass/);
    const smoke = lastSmoke
      ? {
          at: lastSmoke.started_at,
          pass: smokeMatch ? parseInt(smokeMatch[1], 10) : 0,
          total: smokeMatch ? parseInt(smokeMatch[2], 10) : 0,
          allGreen: smokeMatch ? smokeMatch[1] === smokeMatch[2] : false,
        }
      : null;

    // Credits this month
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const { data: monthRuns } = await supabaseAdmin
      .from("ingest_runs")
      .select("credits_used")
      .gte("started_at", monthStart.toISOString());
    const monthCredits = (monthRuns ?? []).reduce((s, r) => s + (r.credits_used ?? 0), 0);

    // Last ingest (non-smoke)
    const { data: lastIngest } = await supabaseAdmin
      .from("ingest_runs")
      .select("started_at")
      .neq("kind", "smoke")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      buildVersion: VERSION,
      sources: perSource,
      smoke,
      monthCredits,
      lastIngestAt: lastIngest?.started_at ?? null,
    };
  });

// ───────────────────────────────────────────────────────────────
// getPipelineRates — per-source throughput + stall indicator
// ───────────────────────────────────────────────────────────────
const PipelineInput = z.object({
  sourceSlug: z.enum(["rise", "ai_sweden"]),
  windowMin: z.number().int().min(1).max(60).default(10),
});

export const getPipelineRates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PipelineInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { countBySource } = await import("./ingest-helpers.server");

    const { data: source } = await supabaseAdmin
      .from("sources").select("id, slug").eq("slug", data.sourceSlug).single();
    if (!source) throw new Error("source not found");

    const counts = await countBySource(supabaseAdmin, source.id);
    const since = new Date(Date.now() - data.windowMin * 60 * 1000).toISOString();
    const { data: runs } = await supabaseAdmin
      .from("ingest_runs")
      .select("kind, scraped, embedded, started_at, finished_at")
      .eq("source_id", source.id)
      .gte("started_at", since)
      .order("started_at", { ascending: false });

    const scrapedSum = (runs ?? []).reduce((s, r) => s + (r.scraped ?? 0), 0);
    const embeddedSum = (runs ?? []).reduce((s, r) => s + (r.embedded ?? 0), 0);
    const scrapedRate = scrapedSum / data.windowMin;
    const embeddedRate = embeddedSum / data.windowMin;

    // Stall indicator: queue depth > 0 AND last activity > 3 min ago.
    const STALL_MIN = 3;
    const stallCutoff = Date.now() - STALL_MIN * 60 * 1000;
    const lastScrapeRun = (runs ?? []).find((r) => r.kind === "scrape" && (r.scraped ?? 0) > 0);
    const lastEmbedRun = (runs ?? []).find((r) => r.kind === "embed" && (r.embedded ?? 0) > 0);
    const scrapeStalledSince =
      counts.pending > 0 && scrapedRate === 0 && (!lastScrapeRun || new Date(lastScrapeRun.started_at).getTime() < stallCutoff)
        ? lastScrapeRun?.started_at ?? null
        : null;
    const embedStalledSince =
      counts.scraped > 0 && embeddedRate === 0 && (!lastEmbedRun || new Date(lastEmbedRun.started_at).getTime() < stallCutoff)
        ? lastEmbedRun?.started_at ?? null
        : null;

    const etaScrapeMin = scrapedRate > 0 ? Math.ceil(counts.pending / scrapedRate) : null;
    const etaEmbedMin = embeddedRate > 0 ? Math.ceil(counts.scraped / embeddedRate) : null;

    return {
      source: source.slug,
      windowMin: data.windowMin,
      counts,
      scrapedRate,
      embeddedRate,
      etaScrapeMin,
      etaEmbedMin,
      scrapeStalledSince,
      embedStalledSince,
    };
  });

// ───────────────────────────────────────────────────────────────
// listRunsDetailed — operations timeline with parsed notes
// ───────────────────────────────────────────────────────────────
const RunsInput = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  beforeStartedAt: z.string().optional(),
});

export const listRunsDetailed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RunsInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("ingest_runs")
      .select("*, sources(slug, name)")
      .order("started_at", { ascending: false })
      .limit(data.limit);
    if (data.beforeStartedAt) q = q.lt("started_at", data.beforeStartedAt);
    const { data: runs } = await q;
    const parsed = (runs ?? []).map((r) => {
      let delta: number | null = null;
      let durationMs: number | null = null;
      let force: boolean | null = null;
      try {
        if (r.notes) {
          const o = JSON.parse(r.notes) as { delta?: unknown; durationMs?: unknown; force?: unknown };
          if (typeof o.delta === "number") delta = o.delta;
          if (typeof o.durationMs === "number") durationMs = o.durationMs;
          if (typeof o.force === "boolean") force = o.force;
        }
      } catch {
        /* not JSON */
      }
      return {
        id: r.id,
        kind: r.kind,
        sourceSlug: (r.sources as { slug?: string } | null)?.slug ?? null,
        started_at: r.started_at,
        finished_at: r.finished_at,
        mapped: r.mapped,
        scraped: r.scraped,
        embedded: r.embedded,
        failed: r.failed,
        credits_used: r.credits_used,
        notes: r.notes,
        delta,
        durationMs,
        force,
      };
    });
    return { runs: parsed };
  });

// ───────────────────────────────────────────────────────────────
// getSmokeHistory — last N smoke runs, parsed per-check
// ───────────────────────────────────────────────────────────────
export const getSmokeHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ limit: z.number().int().min(1).max(100).default(30) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("ingest_runs")
      .select("id, started_at, notes")
      .eq("kind", "smoke")
      .order("started_at", { ascending: false })
      .limit(data.limit);

    // Notes format: "smoke X/Y pass — fails: name (detail); name (detail)..."
    const parsed = (rows ?? []).map((r) => {
      const m = r.notes?.match(/smoke (\d+)\/(\d+) pass/);
      const pass = m ? parseInt(m[1], 10) : 0;
      const total = m ? parseInt(m[2], 10) : 0;
      // Pull failing check names
      const failNames: string[] = [];
      const failsPart = r.notes?.split("fails:")[1];
      if (failsPart) {
        for (const seg of failsPart.split(";")) {
          const name = seg.trim().split(" (")[0];
          if (name) failNames.push(name);
        }
      }
      return { id: r.id, at: r.started_at, pass, total, failNames };
    });
    return { runs: parsed };
  });

// ───────────────────────────────────────────────────────────────
// runSmokeNow — run smoke and return result inline (also persisted)
// ───────────────────────────────────────────────────────────────
export const runSmokeNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runSmokeTests } = await import("./ingest-smoke.server");
    const report = await runSmokeTests(supabaseAdmin);
    await supabaseAdmin.from("ingest_runs").insert({
      kind: "smoke",
      finished_at: new Date().toISOString(),
      notes: report.summary,
    });
    return report;
  });

// ───────────────────────────────────────────────────────────────
// snapshotCorpus — manual trigger for the dashboard "Snapshot now" link
// ───────────────────────────────────────────────────────────────
export const snapshotCorpus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { snapshotAllSources } = await import("./ingest-helpers.server");
    await snapshotAllSources(supabaseAdmin);
    return { ok: true, at: new Date().toISOString() };
  });

// ───────────────────────────────────────────────────────────────
// getDocumentDetail — drill-down for one document
// ───────────────────────────────────────────────────────────────
export const getDocumentDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ url: z.string().url().max(1000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { canonicalizeUrl } = await import("./url-canonical.server");
    const url = canonicalizeUrl(data.url);

    const { data: doc } = await supabaseAdmin
      .from("documents")
      .select("*, sources(slug, name)")
      .eq("url", url)
      .maybeSingle();
    if (!doc) throw new Error("Document not found");

    // Chunk count
    const { count: chunkCount } = await supabaseAdmin
      .from("chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", doc.id);

    // Cleaned markdown preview (first 4 KB)
    const { cleanMarkdown } = await import("./markdown-clean.server");
    const cleaned = cleanMarkdown(doc.raw_markdown ?? "");
    const preview = cleaned.slice(0, 4000);

    // Cheap per-doc history derived from existing columns (no separate table yet).
    const history: Array<{ at: string; event: string }> = [];
    if (doc.fetched_at) history.push({ at: doc.fetched_at, event: "scraped" });
    if (doc.bytes_replaced_at) history.push({ at: doc.bytes_replaced_at, event: "bytes replaced (manual)" });
    if (doc.published_at) history.push({ at: doc.published_at, event: `published (${doc.published_at_source ?? "unknown source"})` });
    if (doc.sitemap_lastmod) history.push({ at: doc.sitemap_lastmod, event: "sitemap lastmod" });
    history.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    return {
      doc: {
        id: doc.id,
        url: doc.url,
        title: doc.title,
        lang: doc.lang,
        page_type: doc.page_type,
        content_type: doc.content_type,
        status: doc.status,
        hidden: doc.hidden,
        error: doc.error,
        fetched_at: doc.fetched_at,
        sitemap_lastmod: doc.sitemap_lastmod,
        published_at: doc.published_at,
        published_at_source: doc.published_at_source,
        bytes_replaced_at: (doc as { bytes_replaced_at?: string | null }).bytes_replaced_at ?? null,
        extraction_method: (doc as { extraction_method?: string | null }).extraction_method ?? null,
        filter_miss: (doc as { filter_miss?: boolean | null }).filter_miss ?? null,
        storage_path: (doc as { storage_path?: string | null }).storage_path ?? null,
        token_count: (doc as { token_count?: number | null }).token_count ?? null,
        source: (doc.sources as { slug?: string; name?: string } | null) ?? null,
      },
      chunkCount: chunkCount ?? 0,
      preview,
      previewTruncated: cleaned.length > preview.length,
      previewTotalChars: cleaned.length,
      history,
    };
  });

// ───────────────────────────────────────────────────────────────
// runSearchConsole — admin-side wrapper around MCP tool execute()
// ───────────────────────────────────────────────────────────────
const TOOL_NAMES = [
  "search_swedish_ai",
  "find_mentions",
  "find_similar",
  "list_latest",
  "get_document",
  "list_sources",
] as const;

// Lightweight per-process rate limit (resets on cold start — fine for an
// admin tab that's rarely abused).
const adminCallTimes = new Map<string, number[]>();
function rateLimit(userId: string, perMinute = 30) {
  const now = Date.now();
  const arr = (adminCallTimes.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (arr.length >= perMinute) throw new Error(`Search console: rate limit (${perMinute}/min)`);
  arr.push(now);
  adminCallTimes.set(userId, arr);
}

export const runSearchConsole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        tool: z.enum(TOOL_NAMES),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        params: z.record(z.string(), z.any()).default({}),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    rateLimit(context.userId);

    const { searchTool } = await import("./mcp/tools/search");
    const { findMentionsTool } = await import("./mcp/tools/find-mentions");
    const { findSimilarTool } = await import("./mcp/tools/find-similar");
    const { listLatestTool } = await import("./mcp/tools/list-latest");
    const { getDocumentTool } = await import("./mcp/tools/get-document");
    const { listSourcesTool } = await import("./mcp/tools/list-sources");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: Record<string, { execute: (p: any, ctx: any) => Promise<unknown> }> = {
      search_swedish_ai: searchTool as never,
      find_mentions: findMentionsTool as never,
      find_similar: findSimilarTool as never,
      list_latest: listLatestTool as never,
      get_document: getDocumentTool as never,
      list_sources: listSourcesTool as never,
    };

    const tool = tools[data.tool];
    if (!tool) throw new Error(`Unknown tool: ${data.tool}`);
    const t0 = Date.now();
    let resultJson = "";
    let error: string | null = null;
    try {
      const raw = await tool.execute(data.params, {});
      resultJson = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
    } catch (e) {
      error = (e as Error).message;
    }
    return {
      tool: data.tool,
      durationMs: Date.now() - t0,
      resultJson,
      error,
    };
  });
