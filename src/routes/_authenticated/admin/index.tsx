import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useState } from "react";

import {
  listSourcesAdmin,
  mapSource,
  scrapeBatch,
  embedBatch,
  refreshSitemap,
} from "@/lib/ingest.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: SourcesPage,
});

type SourceSlug = "rise" | "ai_sweden";

function SourcesPage() {
  const list = useServerFn(listSourcesAdmin);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-sources"],
    queryFn: () => list(),
  });

  const mapFn = useServerFn(mapSource);
  const scrapeFn = useServerFn(scrapeBatch);
  const embedFn = useServerFn(embedBatch);
  const refreshFn = useServerFn(refreshSitemap);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try {
      const res = await fn();
      toast.success(`${label}: ${JSON.stringify(res)}`);
      qc.invalidateQueries({ queryKey: ["admin-sources"] });
    } catch (e) {
      toast.error(`${label} failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Sources</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Trigger ingestion steps for each data source. Run map → scrape → embed in order. Use refresh to mark stale URLs as pending.
        </p>
      </div>

      <div className="grid gap-4">
        {data?.sources.map((s) => {
          const stats = data.stats[s.id] ?? { pending: 0, scraped: 0, embedded: 0, failed: 0 };
          const slug = s.slug as SourceSlug;
          return (
            <Card key={s.id} className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold">{s.name}</h2>
                  <a href={s.root_url} className="text-sm text-muted-foreground hover:underline" target="_blank" rel="noreferrer">
                    {s.root_url}
                  </a>
                  <div className="mt-3 flex gap-4 text-sm">
                    <span><b>{stats.pending}</b> pending</span>
                    <span><b>{stats.scraped}</b> scraped</span>
                    <span className="text-emerald-600 dark:text-emerald-400"><b>{stats.embedded}</b> embedded</span>
                    <span className="text-rose-600 dark:text-rose-400"><b>{stats.failed}</b> failed</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!busy}
                    onClick={() => run(`map ${slug}`, () => mapFn({ data: { sourceSlug: slug } }))}
                  >
                    1. Map URLs
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!busy}
                    onClick={() => run(`scrape ${slug}`, () => scrapeFn({ data: { sourceSlug: slug, batchSize: 25 } }))}
                  >
                    2. Scrape batch (25)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!busy}
                    onClick={() => run(`embed ${slug}`, () => embedFn({ data: { sourceSlug: slug, batchSize: 10 } }))}
                  >
                    3. Embed batch (10)
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!!busy}
                    onClick={() => run(`refresh ${slug}`, () => refreshFn({ data: { sourceSlug: slug } }))}
                  >
                    Refresh sitemap
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      {busy && <p className="text-sm text-muted-foreground">Running: {busy}…</p>}
    </div>
  );
}
