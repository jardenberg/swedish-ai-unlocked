import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getPipelineRates } from "@/lib/admin-observability.functions";
import { Card } from "@/components/ui/card";
import { FullRefreshPanel } from "@/components/admin/FullRefreshPanel";

export const Route = createFileRoute("/_authenticated/admin/pipeline")({
  component: PipelinePage,
});

const SOURCES = ["rise", "ai_sweden"] as const;

function PipelinePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Pipeline</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Per-source queue depth, throughput (last 10 min), and ETA to drain. Polls every 15 s.
        </p>
      </div>
      <FullRefreshPanel />
      {SOURCES.map((slug) => (
        <PipelineStrip key={slug} slug={slug} />
      ))}
    </div>
  );
}

function PipelineStrip({ slug }: { slug: "rise" | "ai_sweden" }) {
  const fn = useServerFn(getPipelineRates);
  const { data, isLoading } = useQuery({
    queryKey: ["pipeline-rates", slug],
    queryFn: () => fn({ data: { sourceSlug: slug, windowMin: 10 } }),
    refetchInterval: 15_000,
  });

  if (isLoading || !data) {
    return (
      <Card className="p-6">
        <div className="text-sm text-muted-foreground">Loading {slug}…</div>
      </Card>
    );
  }

  const { counts, scrapedRate, embeddedRate, etaScrapeMin, etaEmbedMin, scrapeStalledSince, embedStalledSince } = data;

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{slug}</h2>
        <Link to="/admin" className="text-xs text-muted-foreground hover:underline">
          actions →
        </Link>
      </div>
      <div className="grid grid-cols-4 gap-3 text-sm">
        <Stage label="pending" value={counts.pending} />
        <Stage label="scraped" value={counts.scraped} />
        <Stage label="embedded" value={counts.embedded} accent="emerald" />
        <Stage label="failed" value={counts.failed} accent={counts.failed > 0 ? "rose" : undefined} />
      </div>
      <div className="grid grid-cols-2 gap-4 border-t pt-3 text-xs">
        <div>
          <div className="font-medium">scrape → next stage</div>
          <div className="font-mono text-muted-foreground">
            {scrapedRate.toFixed(1)}/min ·{" "}
            {etaScrapeMin == null
              ? counts.pending === 0
                ? "drained"
                : "idle"
              : `ETA ${etaScrapeMin}m`}
          </div>
          {scrapeStalledSince && (
            <div className="mt-1 rounded bg-amber-100 px-2 py-1 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              ⚠ possibly stalled since {new Date(scrapeStalledSince).toLocaleString()}
            </div>
          )}
        </div>
        <div>
          <div className="font-medium">embed → searchable</div>
          <div className="font-mono text-muted-foreground">
            {embeddedRate.toFixed(1)}/min ·{" "}
            {etaEmbedMin == null
              ? counts.scraped === 0
                ? "drained"
                : "idle"
              : `ETA ${etaEmbedMin}m`}
          </div>
          {embedStalledSince && (
            <div className="mt-1 rounded bg-amber-100 px-2 py-1 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              ⚠ possibly stalled since {new Date(embedStalledSince).toLocaleString()}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function Stage({ label, value, accent }: { label: string; value: number; accent?: "emerald" | "rose" }) {
  const color =
    accent === "emerald"
      ? "text-emerald-700 dark:text-emerald-400"
      : accent === "rose"
        ? "text-rose-600 dark:text-rose-400"
        : "";
  return (
    <div className="rounded border bg-card p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value.toLocaleString()}</div>
    </div>
  );
}
