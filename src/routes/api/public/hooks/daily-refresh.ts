import { createFileRoute } from "@tanstack/react-router";

// Daily scheduled refresh: re-diff both sitemaps, then drain the queue
// (scrape → embed) within a bounded time budget, then snapshot the corpus.
// Orchestration lives in src/lib/full-refresh.server.ts and is shared with
// the admin "Run full refresh now" button.
// Called by pg_cron with the project's anon key in the `apikey` header.

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

        const { runFullPipeline } = await import("@/lib/full-refresh.server");
        const report = await runFullPipeline({ trigger: "cron", budgetMs: 4 * 60 * 1000 });
        console.log("[cron] daily-refresh", JSON.stringify(report));
        return Response.json({ ok: true, ...report });
      },
    },
  },
});
