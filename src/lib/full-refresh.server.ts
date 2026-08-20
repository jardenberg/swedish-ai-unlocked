// Shared full-pipeline orchestration: refresh sitemaps (with new-URL
// discovery) → alternate scrape/embed drain within a time budget → corpus
// snapshot. ONE implementation, used by both the daily cron route and the
// admin "Run full refresh now" button (which passes trigger: "manual").
import type { Trigger } from "./ingest-core.server";

export const SOURCES = ["rise", "ai_sweden"] as const;
export type SourceSlug = (typeof SOURCES)[number];

export interface SourceReport {
  slug: SourceSlug;
  newInserted: number;
  stale: number;
  scraped: number;
  embedded: number;
  failed: number;
  blocked: boolean;
  /** Guard preview when the >10% embedded-drop guard tripped. */
  guardPreview?: Record<string, unknown>;
  error?: string;
}

export interface FullPipelineReport {
  startedAt: string;
  durationMs: number;
  budgetExhausted: boolean;
  sources: SourceReport[];
}

export async function runFullPipeline(opts: {
  trigger: Trigger;
  budgetMs?: number;
  /** Per-source force override for the reset guard. Never set by default. */
  force?: Partial<Record<SourceSlug, boolean>>;
}): Promise<FullPipelineReport> {
  const budgetMs = opts.budgetMs ?? 4 * 60 * 1000;
  const t0 = Date.now();
  const { refreshSitemapCore, scrapeBatchCore, embedBatchCore, BulkGuardError } =
    await import("./ingest-core.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { snapshotAllSources } = await import("./ingest-helpers.server");

  const reports = new Map<SourceSlug, SourceReport>();
  for (const slug of SOURCES) {
    reports.set(slug, {
      slug, newInserted: 0, stale: 0, scraped: 0, embedded: 0, failed: 0, blocked: false,
    });
  }

  // 1. Refresh sitemaps. The guard stays armed — a blocked source must not
  // abort the run; its new inserts already persisted inside the core.
  for (const slug of SOURCES) {
    const rep = reports.get(slug)!;
    try {
      const res = await refreshSitemapCore({ sourceSlug: slug, trigger: opts.trigger, force: opts.force?.[slug] });
      rep.newInserted = res.newInserted;
      rep.stale = res.stale;
    } catch (e) {
      const message = (e as Error).message;
      rep.error = message;
      if (e instanceof BulkGuardError) {
        rep.blocked = true;
        rep.guardPreview = e.preview;
        rep.newInserted = Number(e.preview.newInserted ?? 0);
        // ingest_runs row already written by the core with blocked: true.
      } else {
        try {
          const { data: src } = await supabaseAdmin
            .from("sources").select("id").eq("slug", slug).maybeSingle();
          await supabaseAdmin.from("ingest_runs").insert({
            source_id: src?.id ?? null,
            kind: "refresh",
            trigger: opts.trigger,
            finished_at: new Date().toISOString(),
            notes: JSON.stringify({ op: "refresh", blocked: true, error: message }),
          });
        } catch { /* best-effort */ }
      }
    }
  }

  // 2. Drain: alternate scrape/embed until queues are empty or budget runs out.
  let budgetExhausted = false;
  drain: for (let round = 0; round < 40; round++) {
    if (Date.now() - t0 > budgetMs) { budgetExhausted = true; break; }
    let progressed = false;
    for (const slug of SOURCES) {
      const rep = reports.get(slug)!;
      if (Date.now() - t0 > budgetMs) { budgetExhausted = true; break drain; }
      try {
        const s = await scrapeBatchCore({ sourceSlug: slug, batchSize: 25, trigger: opts.trigger });
        rep.scraped += s.scraped ?? 0;
        rep.failed += s.failed ?? 0;
        if ((s.scraped ?? 0) > 0) progressed = true;
      } catch (e) {
        console.error("[full-pipeline] scrape failed", slug, (e as Error).message);
      }
      try {
        const em = await embedBatchCore({ sourceSlug: slug, batchSize: 20, trigger: opts.trigger });
        rep.embedded += em.embedded ?? 0;
        rep.failed += em.failed ?? 0;
        if ((em.embedded ?? 0) > 0) progressed = true;
      } catch (e) {
        console.error("[full-pipeline] embed failed", slug, (e as Error).message);
      }
    }
    if (!progressed) break;
  }

  // 3. Snapshot so the 24h delta view has a point even on quiet days.
  await snapshotAllSources(supabaseAdmin);

  return {
    startedAt: new Date(t0).toISOString(),
    durationMs: Date.now() - t0,
    budgetExhausted,
    sources: [...reports.values()],
  };
}
