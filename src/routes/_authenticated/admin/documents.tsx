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
  uploadManualPdf,
} from "@/lib/ingest.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/documents")({
  component: DocumentsPage,
});

type DocRow = {
  id: string;
  url: string;
  title: string | null;
  lang: string | null;
  content_type: string;
  status: string;
  error: string | null;
  hidden: boolean;
  published_at: string | null;
  published_at_source: string | null;
  bytes_replaced_at?: string | null;
  sources: { slug?: string } | null;
};

const MAX_BYTES = 55 * 1024 * 1024;

function DocumentsPage() {
  const [status, setStatus] = useState<string>("");
  const [showHidden, setShowHidden] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<DocRow | null>(null);
  const list = useServerFn(listRecentDocs);
  const retryOne = useServerFn(retryDocument);
  const retryAll = useServerFn(retryAllFailed);
  const toggleHide = useServerFn(setDocumentHidden);
  const reclean = useServerFn(recleanAndReembed);
  const backfill = useServerFn(backfillPublishedDates);
  const smoke = useServerFn(runIngestSmokeTests);
  const upload = useServerFn(uploadManualPdf);
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
    mutationFn: () => smoke(),
    onSuccess: (r) =>
      r.fail === 0
        ? toast.success(r.summary)
        : toast.error(r.summary, { duration: 10000 }),
    onError: (e) => toast.error((e as Error).message),
  });

  const replaceMut = useMutation({
    mutationFn: async (vars: { target: DocRow; file: File }) => {
      const { target, file } = vars;
      if (file.type !== "application/pdf") throw new Error("File must be application/pdf");
      if (file.size > MAX_BYTES) throw new Error(`File exceeds 55 MB (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
      const slug = target.sources?.slug;
      if (slug !== "rise" && slug !== "ai_sweden") throw new Error("Unsupported source for replace");
      const lang = target.lang === "sv" ? "sv" : "en";
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < buf.length; i += CHUNK) {
        bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
      }
      const fileBase64 = btoa(bin);
      return upload({
        data: {
          canonicalUrl: target.url,
          title: target.title ?? target.url,
          sourceSlug: slug,
          lang,
          fileBase64,
          mimeType: "application/pdf",
          mode: "replace",
        },
      });
    },
    onSuccess: () => {
      toast.success("File replaced — row set to pending. The next scrape+embed run will reprocess it.");
      setReplaceTarget(null);
      qc.invalidateQueries({ queryKey: ["admin-docs"] });
    },
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
            {(data?.docs as DocRow[] | undefined)?.map((d) => {
              const canReplace =
                (d.content_type === "pdf" || d.status === "failed") &&
                (d.sources?.slug === "rise" || d.sources?.slug === "ai_sweden");
              return (
                <tr key={d.id} className={`border-b last:border-0 ${d.hidden ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2 text-xs">{d.sources?.slug}</td>
                  <td className="px-3 py-2">
                    <a href={d.url} target="_blank" rel="noreferrer" className="hover:underline">{d.title || d.url}</a>
                    {d.bytes_replaced_at && (
                      <span
                        className="ml-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                        title={`Stored bytes replaced ${d.bytes_replaced_at}`}
                      >
                        replaced
                      </span>
                    )}
                  </td>
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
                    {canReplace && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setReplaceTarget(d)}
                      >
                        Replace file…
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
              );
            })}
          </tbody>
        </table>
      </Card>

      <ReplaceFileDialog
        target={replaceTarget}
        pending={replaceMut.isPending}
        onCancel={() => setReplaceTarget(null)}
        onSubmit={(file) => replaceTarget && replaceMut.mutate({ target: replaceTarget, file })}
      />
    </div>
  );
}

function ReplaceFileDialog({
  target,
  pending,
  onCancel,
  onSubmit,
}: {
  target: DocRow | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (file: File) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <Dialog
      open={!!target}
      onOpenChange={(open) => {
        if (!open) {
          setFile(null);
          onCancel();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Replace stored file</DialogTitle>
          <DialogDescription>
            This replaces the stored bytes for this document. The canonical URL, document id,
            and citation history are kept untouched; the row is set to <code>pending</code> and
            reprocessed on the next scrape+embed run. The previous version stays searchable
            until the new one is embedded.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Canonical URL (locked)</Label>
            <Input value={target?.url ?? ""} readOnly disabled />
          </div>
          <div className="space-y-1">
            <Label htmlFor="replace-file">Replacement PDF (max 55 MB)</Label>
            <Input
              id="replace-file"
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            )}
          </div>
          <p className="rounded border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
            Confirming will replace the stored file for <strong>{target?.url}</strong>. A
            provenance marker is recorded and surfaced to API consumers as
            <code className="ml-1">contentNote</code>.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={!file || pending}
            onClick={() => file && onSubmit(file)}
          >
            {pending ? "Replacing…" : "Confirm replace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
