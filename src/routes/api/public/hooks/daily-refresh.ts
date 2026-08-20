import { createFileRoute } from "@tanstack/react-router";

// Daily scheduled refresh: re-diff both sitemaps, then drain the queue
// (scrape → embed) within a bounded time budget, then snapshot the corpus.
// Called by pg_cron with the project's anon key in the `apikey` header.

const SOURCES = ["rise", "ai_sweden"] as const;
const BUDGET_MS = 4 * 60 * 1000;

export const Route = createFileRoute("/api/public/hooks/daily-refresh")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        const expected =
          process.env["SUPABASE_PUBLISHABLE_KEY"] ??
          process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
          "";
        if (!expected || apikey !== expected) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const t0 = Date.now();
        const { refreshSitemapCore, scrapeBatchCore, embedBatchCore } = await import(
          "@/lib/ingest-core.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { snapshotAllSources } = await import("@/lib/ingest-helpers.server");

        const report: Record<string, unknown> = { startedAt: new Date().toISOString() };

        // 1. Refresh sitemaps (guard stays armed — a cron run must never
        // silently reset >10% of embedded docs).
        const refresh: Record<string, unknown> = {};
        for (const slug of SOURCES) {
          try {
            refresh[slug] = await refreshSitemapCore({ sourceSlug: slug, trigger: "cron" });
          } catch (e) {
            const message = (e as Error).message;
            refresh[slug] = { error: message };
            // Record guard-blocked / failed cron refreshes so the admin run
            // history shows them instead of them vanishing into logs.
            try {
              const { supabaseAdmin: sb } = await import(
                "@/integrations/supabase/client.server"
              );
              const { data: src } = await sb
                .from("sources")
                .select("id")
                .eq("slug", slug)
                .maybeSingle();
              await sb.from("ingest_runs").insert({
                source_id: src?.id ?? null,
                kind: "refresh",
                trigger: "cron",
                finished_at: new Date().toISOString(),
                notes: JSON.stringify({ op: "refresh", blocked: true, error: message }),
              });
            } catch { /* best-effort */ }
          }
        }
        report.refresh = refresh;

        // 2. Drain: alternate scrape/embed until the queue is empty or the
        // time budget runs out.
        let scraped = 0;
        let embedded = 0;
        let failed = 0;
        drain: for (let round = 0; round < 40; round++) {
          if (Date.now() - t0 > BUDGET_MS) break;
          let progressed = false;
          for (const slug of SOURCES) {
            if (Date.now() - t0 > BUDGET_MS) break drain;
            try {
              const s = await scrapeBatchCore({
                sourceSlug: slug,
                batchSize: 25,
                trigger: "cron",
              });
              scraped += s.scraped ?? 0;
              failed += s.failed ?? 0;
              if ((s.scraped ?? 0) > 0) progressed = true;
            } catch (e) {
              console.error("[cron] scrape failed", slug, (e as Error).message);
            }
            try {
              const em = await embedBatchCore({
                sourceSlug: slug,
                batchSize: 20,
                trigger: "cron",
              });
              embedded += em.embedded ?? 0;
              failed += em.failed ?? 0;
              if ((em.embedded ?? 0) > 0) progressed = true;
            } catch (e) {
              console.error("[cron] embed failed", slug, (e as Error).message);
            }
          }
          if (!progressed) break;
        }
        report.drain = { scraped, embedded, failed };

        // 3. Snapshot corpus counts so the 24h delta view has a point even
        // on quiet days.
        await snapshotAllSources(supabaseAdmin);

        report.durationMs = Date.now() - t0;
        console.log("[cron] daily-refresh", JSON.stringify(report));
        return Response.json({ ok: true, ...report });
      },
    },
  },
});
