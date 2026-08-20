import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { runFullRefresh } from "@/lib/admin-observability.functions";
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

type Report = Awaited<ReturnType<typeof runFullRefresh>>;
type SourceReport = Report["sources"][number];

export function FullRefreshPanel() {
  const fn = useServerFn(runFullRefresh);
  const qc = useQueryClient();
  const [report, setReport] = useState<Report | null>(null);
  const [blocked, setBlocked] = useState<SourceReport | null>(null);

  const mut = useMutation({
    mutationFn: (force?: Record<string, boolean>) =>
      fn({ data: force ? { force } : {} }) as Promise<Report>,
    onSuccess: (res) => {
      setReport(res);
      const b = res.sources.find((s) => s.blocked);
      setBlocked(b ?? null);
      qc.invalidateQueries({ queryKey: ["pipeline-rates"] });
      qc.invalidateQueries({ queryKey: ["admin-overview"] });
      qc.invalidateQueries({ queryKey: ["admin-sources"] });
      toast.success(
        `Full refresh done in ${Math.round(res.durationMs / 1000)}s${res.budgetExhausted ? " (time budget reached — run again to continue)" : ""}`,
      );
    },
    onError: (e) => toast.error(`Full refresh failed: ${(e as Error).message}`),
  });

  const running = mut.isPending;

  return (
    <Card className="p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Run full refresh now</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Runs the exact daily pipeline for both sources: sitemap refresh with new-URL
            discovery → alternating scrape/embed drain (time-budgeted) → corpus snapshot.
            Runs are recorded with trigger <code>manual</code>. The {`>10%`} embedded-drop
            guard is never auto-forced.
          </p>
        </div>
        <Button disabled={running} onClick={() => mut.mutate(undefined)}>
          {running ? "Running…" : "Update all"}
        </Button>
      </div>

      {running && (
        <p className="text-sm text-muted-foreground">
          Refreshing sitemaps and draining queues… the per-source counters below keep
          polling every 15 s.
        </p>
      )}

      {report && !running && (
        <div className="space-y-2 border-t pt-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Last run summary
          </div>
          <div className="grid gap-2 text-sm">
            {report.sources.map((s) => (
              <div key={s.slug} className="rounded border bg-card p-3 font-mono text-xs">
                <span className="font-semibold">{s.slug}</span>{" "}
                newInserted <b>{s.newInserted}</b> · scraped <b>{s.scraped}</b> · embedded{" "}
                <b className="text-emerald-600 dark:text-emerald-400">{s.embedded}</b> · failed{" "}
                <b className={s.failed > 0 ? "text-rose-600" : ""}>{s.failed}</b>
                {s.blocked && (
                  <span className="ml-2 text-amber-700 dark:text-amber-300">
                    ⚠ refresh blocked by guard
                    <button
                      type="button"
                      className="ml-2 underline"
                      onClick={() => setBlocked(s)}
                    >
                      review
                    </button>
                  </span>
                )}
                {!s.blocked && s.error && (
                  <span className="ml-2 text-rose-600">⚠ {s.error}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <AlertDialog open={!!blocked} onOpenChange={(o) => { if (!o) setBlocked(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Guard blocked refresh on {blocked?.slug}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono">
                  <span>Currently embedded</span>
                  <span className="text-right">{String(blocked?.guardPreview?.embeddedBefore ?? "–")}</span>
                  <span>URLs to refresh (→ pending)</span>
                  <span className="text-right">{String(blocked?.guardPreview?.willRefresh ?? "–")}</span>
                  <span>Embedded docs that will reset</span>
                  <span className="text-right text-rose-600">
                    {String(blocked?.guardPreview?.willResetEmbedded ?? "–")}
                  </span>
                  <span>New URLs inserted (already applied)</span>
                  <span className="text-right text-emerald-600">+{blocked?.newInserted ?? 0}</span>
                </div>
                <div className="rounded border border-rose-600/40 bg-rose-600/10 p-2 text-rose-700 dark:text-rose-300">
                  ⚠ This reset exceeds the 10% embedded-drop guard. New URLs were still
                  inserted; only the stale-row resets were skipped. Forcing will create a
                  temporary search-corpus gap until the re-embed drains.
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Leave blocked</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              onClick={() => {
                const slug = blocked?.slug;
                setBlocked(null);
                if (slug) mut.mutate({ [slug]: true });
              }}
            >
              Force confirm {blocked?.slug}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
