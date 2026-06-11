import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useState } from "react";

import {
  listSourcesAdmin,
  mapSource,
  scrapeBatch,
  embedBatch,
  refreshSitemap,
  previewBulkOp,
} from "@/lib/ingest.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: SourcesPage,
});

type SourceSlug = "rise" | "ai_sweden";

type Preview = Awaited<ReturnType<typeof previewBulkOp>> & { _label: string; _slug: SourceSlug; _op: "map" | "refresh" };

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
  const previewFn = useServerFn(previewBulkOp);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pendingPreview, setPendingPreview] = useState<Preview | null>(null);

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

  async function previewThenRun(op: "map" | "refresh", slug: SourceSlug) {
    setBusy(`preview ${op} ${slug}`);
    try {
      const preview = await previewFn({ data: { op, sourceSlug: slug } });
      setPendingPreview({ ...preview, _label: `${op} ${slug}`, _slug: slug, _op: op });
    } catch (e) {
      toast.error(`Preview failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function confirmPreview(force: boolean) {
    if (!pendingPreview) return;
    const { _op, _slug, _label } = pendingPreview;
    setPendingPreview(null);
    await run(_label, () =>
      _op === "map"
        ? mapFn({ data: { sourceSlug: _slug, force } })
        : refreshFn({ data: { sourceSlug: _slug, force } }),
    );
  }

  // Loop a batch fn until it processes 0 items, or until safety cap reached.
  async function drain(
    label: string,
    fn: () => Promise<{ scraped?: number; embedded?: number; failed?: number }>,
    countKey: "scraped" | "embedded",
    maxIterations = 200,
  ) {
    setBusy(label);
    let total = 0;
    let iterations = 0;
    try {
      while (iterations < maxIterations) {
        iterations++;
        setProgress(`${label}: iteration ${iterations}, ${total} done so far…`);
        const res = await fn();
        const n = (res[countKey] ?? 0) as number;
        total += n;
        qc.invalidateQueries({ queryKey: ["admin-sources"] });
        if (n === 0) break;
      }
      toast.success(`${label}: ${total} total over ${iterations} batches`);
    } catch (e) {
      toast.error(`${label} failed after ${total}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }


  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Sources</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Trigger ingestion steps for each data source. Map and Refresh show a pre-flight impact summary before executing; a {`>10%`} embedded reset requires an explicit force confirm.
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
                    onClick={() => previewThenRun("map", slug)}
                  >
                    1. Map URLs…
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!busy}
                    onClick={() => run(`scrape ${slug}`, () => scrapeFn({ data: { sourceSlug: slug, batchSize: 50 } }))}
                  >
                    2. Scrape batch (50)
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    disabled={!!busy}
                    onClick={() =>
                      drain(
                        `drain scrape ${slug}`,
                        () =>
                          scrapeFn({ data: { sourceSlug: slug, batchSize: 100 } }) as Promise<{
                            scraped?: number;
                          }>,
                        "scraped",
                      )
                    }
                  >
                    Drain scrape
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!busy}
                    onClick={() => run(`embed ${slug}`, () => embedFn({ data: { sourceSlug: slug, batchSize: 25 } }))}
                  >
                    3. Embed batch (25)
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    disabled={!!busy}
                    onClick={() =>
                      drain(
                        `drain embed ${slug}`,
                        () =>
                          embedFn({ data: { sourceSlug: slug, batchSize: 50 } }) as Promise<{
                            embedded?: number;
                          }>,
                        "embedded",
                      )
                    }
                  >
                    Drain embed
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!!busy}
                    onClick={() => previewThenRun("refresh", slug)}
                  >
                    Refresh sitemap…
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      {busy && (
        <p className="text-sm text-muted-foreground">{progress ?? `Running: ${busy}…`}</p>
      )}

      <AlertDialog open={!!pendingPreview} onOpenChange={(o) => { if (!o) setPendingPreview(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Confirm {pendingPreview?._op} on {pendingPreview?._slug}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono">
                  <span>Currently embedded</span>
                  <span className="text-right">{pendingPreview?.embeddedBefore}</span>
                  {pendingPreview?._op === "map" && (
                    <>
                      <span>New URLs to insert</span>
                      <span className="text-right text-emerald-600">+{pendingPreview?.willInsert}</span>
                      <span>Existing URLs untouched</span>
                      <span className="text-right">{pendingPreview?.unchanged}</span>
                    </>
                  )}
                  <span>URLs to refresh (→ pending)</span>
                  <span className="text-right">{pendingPreview?.willRefresh}</span>
                  <span>Embedded docs that will reset</span>
                  <span className={`text-right ${pendingPreview && pendingPreview.willResetEmbedded > 0 ? "text-rose-600" : ""}`}>
                    {pendingPreview?.willResetEmbedded}
                  </span>
                  <span>Reset fraction</span>
                  <span className="text-right">
                    {pendingPreview ? (pendingPreview.guardFraction * 100).toFixed(1) : "0"}%
                  </span>
                </div>
                {pendingPreview?.guardTriggered && (
                  <div className="rounded border border-rose-600/40 bg-rose-600/10 p-2 text-rose-700 dark:text-rose-300">
                    ⚠ Backend guard triggered ({(pendingPreview.guardFraction * 100).toFixed(1)}% &gt; {(pendingPreview.guardThreshold * 100).toFixed(0)}%). This will create a search-corpus gap. Requires force.
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {pendingPreview?.guardTriggered ? (
              <AlertDialogAction
                className="bg-rose-600 hover:bg-rose-700"
                onClick={() => confirmPreview(true)}
              >
                Force confirm
              </AlertDialogAction>
            ) : (
              <AlertDialogAction onClick={() => confirmPreview(false)}>
                Confirm
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>

  );
}
