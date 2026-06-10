import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import {
  backfillPublishedDates,
  listRecentDocs,
  recleanAndReembed,
  retryAllFailed,
  retryDocument,
  runIngestSmokeTests,
  setDocumentHidden,
} from "@/lib/ingest.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/documents")({
  component: DocumentsPage,
});

function DocumentsPage() {
  const [status, setStatus] = useState<string>("");
  const [showHidden, setShowHidden] = useState(false);
  const list = useServerFn(listRecentDocs);
  const retryOne = useServerFn(retryDocument);
  const retryAll = useServerFn(retryAllFailed);
  const toggleHide = useServerFn(setDocumentHidden);
  const reclean = useServerFn(recleanAndReembed);
  const backfill = useServerFn(backfillPublishedDates);
  const smoke = useServerFn(runIngestSmokeTests);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-docs", status, showHidden],
    queryFn: () =>
      list({ data: { status: status || undefined, limit: 100, includeHidden: showHidden } }),
  });

  const retryOneMut = useMutation({
    mutationFn: (id: string) => retryOne({ data: { id } }),
    onSuccess: (r) => {
      toast.success(`Requeued as "${r.status}"`);
      qc.invalidateQueries({ queryKey: ["admin-docs"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const retryAllMut = useMutation({
    mutationFn: () => retryAll({ data: {} }),
    onSuccess: (r) => {
      toast.success(`Requeued ${r.reset} (→ scraped: ${r.toScraped}, → pending: ${r.toPending})`);
      qc.invalidateQueries({ queryKey: ["admin-docs"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const hideMut = useMutation({
    mutationFn: (v: { id: string; hidden: boolean }) => toggleHide({ data: v }),
    onSuccess: (r) => {
      toast.success(r.hidden ? "Hidden from public search" : "Unhidden");
      qc.invalidateQueries({ queryKey: ["admin-docs"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const recleanMut = useMutation({
    mutationFn: () => reclean({ data: { sinceHours: 24, limit: 200 } }),
    onSuccess: (r) => toast.success(`Re-cleaned ${r.processed} (failed ${r.failed})`),
    onError: (e) => toast.error((e as Error).message),
  });

  const backfillMut = useMutation({
    mutationFn: () => backfill({ data: { limit: 2000 } }),
    onSuccess: (r) => {
      toast.success(`Backfilled ${r.filled}/${r.scanned} publish dates`);
      qc.invalidateQueries({ queryKey: ["admin-docs"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const smokeMut = useMutation({
    mutationFn: () => smoke({ data: {} }),
    onSuccess: (r) =>
      r.fail === 0
        ? toast.success(r.summary)
        : toast.error(r.summary, { duration: 10000 }),
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Documents</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={smokeMut.isPending}
            onClick={() => smokeMut.mutate()}
          >
            {smokeMut.isPending ? "Running…" : "Run smoke tests"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={backfillMut.isPending}
            onClick={() => backfillMut.mutate()}
          >
            {backfillMut.isPending ? "…" : "Backfill publish dates"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={recleanMut.isPending}
            onClick={() => recleanMut.mutate()}
          >
            {recleanMut.isPending ? "…" : "Re-clean & re-embed (24h)"}
          </Button>
          {status === "failed" && (
            <Button
              variant="outline"
              size="sm"
              disabled={retryAllMut.isPending}
              onClick={() => retryAllMut.mutate()}
            >
              {retryAllMut.isPending ? "Retrying…" : "Retry all failed"}
            </Button>
          )}
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            Show hidden
          </label>
          <select
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="scraped">Scraped</option>
            <option value="embedded">Embedded</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>
      <Card>
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">URL</th>
              <th className="px-3 py-2">Lang</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Published</th>
              <th className="px-3 py-2">Error</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} className="p-4 text-muted-foreground">Loading…</td></tr>}
            {data?.docs.map((d) => (
              <tr key={d.id} className={`border-b last:border-0 ${d.hidden ? "opacity-50" : ""}`}>
                <td className="px-3 py-2 text-xs">{(d.sources as { slug?: string } | null)?.slug}</td>
                <td className="px-3 py-2"><a href={d.url} target="_blank" rel="noreferrer" className="hover:underline">{d.title || d.url}</a></td>
                <td className="px-3 py-2 text-xs uppercase">{d.lang}</td>
                <td className="px-3 py-2 text-xs">{d.content_type}</td>
                <td className="px-3 py-2 text-xs">{d.status}</td>
                <td className="px-3 py-2 text-xs">
                  {d.published_at ? (
                    <span title={d.published_at_source ?? ""}>
                      {new Date(d.published_at).toISOString().slice(0, 10)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-rose-600 dark:text-rose-400 truncate max-w-xs">{d.error}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {d.status === "failed" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={retryOneMut.isPending && retryOneMut.variables === d.id}
                      onClick={() => retryOneMut.mutate(d.id)}
                    >
                      Retry
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={hideMut.isPending}
                    onClick={() => hideMut.mutate({ id: d.id, hidden: !d.hidden })}
                  >
                    {d.hidden ? "Unhide" : "Hide"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
