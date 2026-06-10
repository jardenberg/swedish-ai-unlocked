import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { listRecentDocs, retryAllFailed, retryDocument } from "@/lib/ingest.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/documents")({
  component: DocumentsPage,
});

function DocumentsPage() {
  const [status, setStatus] = useState<string>("");
  const list = useServerFn(listRecentDocs);
  const retryOne = useServerFn(retryDocument);
  const retryAll = useServerFn(retryAllFailed);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-docs", status],
    queryFn: () => list({ data: { status: status || undefined, limit: 100 } }),
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Documents</h1>
        <div className="flex items-center gap-2">
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
              <th className="px-3 py-2">Error</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="p-4 text-muted-foreground">Loading…</td></tr>}
            {data?.docs.map((d) => (
              <tr key={d.id} className="border-b last:border-0">
                <td className="px-3 py-2 text-xs">{(d.sources as { slug?: string } | null)?.slug}</td>
                <td className="px-3 py-2"><a href={d.url} target="_blank" rel="noreferrer" className="hover:underline">{d.title || d.url}</a></td>
                <td className="px-3 py-2 text-xs uppercase">{d.lang}</td>
                <td className="px-3 py-2 text-xs">{d.content_type}</td>
                <td className="px-3 py-2 text-xs">{d.status}</td>
                <td className="px-3 py-2 text-xs text-rose-600 dark:text-rose-400 truncate max-w-xs">{d.error}</td>
                <td className="px-3 py-2 text-right">
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
