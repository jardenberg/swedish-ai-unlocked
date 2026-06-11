import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { getDocumentDetail } from "@/lib/admin-observability.functions";
import { retryDocument, setDocumentHidden } from "@/lib/ingest.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const searchSchema = z.object({ url: z.string().optional() });

export const Route = createFileRoute("/_authenticated/admin/documents/$documentId")({
  validateSearch: (s) => searchSchema.parse(s),
  component: DocumentDetailPage,
});

function DocumentDetailPage() {
  const navigate = useNavigate();
  const { url: searchUrl } = Route.useSearch();
  const params = Route.useParams() as { documentId: string };
  // The route id is informational; we look up by the ?url= search param so
  // the canonical key (URL) drives the query — matches the public tool model.
  const [url, setUrl] = useState(searchUrl ?? "");

  const detailFn = useServerFn(getDocumentDetail);
  const retryFn = useServerFn(retryDocument);
  const hideFn = useServerFn(setDocumentHidden);
  const qc = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["doc-detail", url],
    queryFn: () => detailFn({ data: { url } }),
    enabled: !!url,
    retry: false,
  });

  const retryMut = useMutation({
    mutationFn: (id: string) => retryFn({ data: { id } }),
    onSuccess: (r) => {
      toast.success(`Requeued as ${r.status}`);
      qc.invalidateQueries({ queryKey: ["doc-detail", url] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const hideMut = useMutation({
    mutationFn: (v: { id: string; hidden: boolean }) => hideFn({ data: v }),
    onSuccess: (r) => {
      toast.success(r.hidden ? "Hidden" : "Unhidden");
      qc.invalidateQueries({ queryKey: ["doc-detail", url] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/admin/documents" className="text-sm text-muted-foreground hover:underline">
          ← Documents
        </Link>
        <span className="text-muted-foreground">·</span>
        <code className="text-xs">{params.documentId}</code>
      </div>

      <Card className="p-4 space-y-2">
        <label className="text-xs font-medium">Document URL</label>
        <div className="flex gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.ri.se/en/…"
          />
          <Button
            onClick={() => navigate({ to: "/admin/documents/$documentId", params: { documentId: "lookup" }, search: { url } })}
          >
            Load
          </Button>
        </div>
      </Card>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-rose-600">{(error as Error).message}</p>}

      {data && (
        <>
          <Card className="p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold">{data.doc.title || data.doc.url}</h1>
                <a href={data.doc.url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:underline">
                  {data.doc.url}
                </a>
              </div>
              <div className="flex gap-2">
                {data.doc.status === "failed" && (
                  <Button size="sm" variant="outline" onClick={() => retryMut.mutate(data.doc.id)} disabled={retryMut.isPending}>
                    Retry
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => hideMut.mutate({ id: data.doc.id, hidden: !data.doc.hidden })}
                  disabled={hideMut.isPending}
                >
                  {data.doc.hidden ? "Unhide" : "Hide"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => refetch()}>
                  Refresh
                </Button>
              </div>
            </div>
            <Grid>
              <Field label="status" value={data.doc.status} />
              <Field label="page_type" value={data.doc.page_type ?? "—"} />
              <Field label="lang" value={data.doc.lang ?? "—"} />
              <Field label="content_type" value={data.doc.content_type} />
              <Field label="chunks" value={String(data.chunkCount)} />
              <Field label="hidden" value={data.doc.hidden ? "yes" : "no"} />
              <Field label="filter_miss" value={data.doc.filter_miss ? "yes" : "no"} />
              <Field label="extraction_method" value={data.doc.extraction_method ?? "—"} />
              <Field label="published_at" value={data.doc.published_at ?? "—"} />
              <Field label="published_at_source" value={data.doc.published_at_source ?? "—"} />
              <Field label="sitemap_lastmod" value={data.doc.sitemap_lastmod ?? "—"} />
              <Field label="fetched_at" value={data.doc.fetched_at ?? "—"} />
              <Field label="bytes_replaced_at" value={data.doc.bytes_replaced_at ?? "—"} />
              <Field label="token_count" value={String(data.doc.token_count ?? "—")} />
              <Field label="source" value={data.doc.source?.slug ?? "—"} />
              <Field label="storage_path" value={data.doc.storage_path ?? "—"} />
            </Grid>
            {data.doc.error && (
              <div className="rounded border border-rose-600/40 bg-rose-600/10 p-2 text-xs text-rose-700 dark:text-rose-300">
                {data.doc.error}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold">History</h2>
            {data.history.length === 0 ? (
              <p className="text-xs text-muted-foreground">No timestamps yet.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {data.history.map((h, i) => (
                  <li key={i} className="font-mono">
                    <span className="text-muted-foreground">{new Date(h.at).toLocaleString()}</span>{" "}
                    <span>· {h.event}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Cleaned markdown preview</h2>
              <span className="text-xs text-muted-foreground">
                {data.preview.length.toLocaleString()} / {data.previewTotalChars.toLocaleString()} chars
                {data.previewTruncated && " (truncated)"}
              </span>
            </div>
            <pre className="max-h-[500px] overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-3 font-mono text-xs">
              {data.preview || "(empty)"}
            </pre>
          </Card>
        </>
      )}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">{children}</div>;
}
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
