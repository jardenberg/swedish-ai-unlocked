import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { listRecentDocs } from "@/lib/ingest.functions";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/admin/documents")({
  component: DocumentsPage,
});

function DocumentsPage() {
  const [status, setStatus] = useState<string>("");
  const list = useServerFn(listRecentDocs);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-docs", status],
    queryFn: () => list({ data: { status: status || undefined, limit: 100 } }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Documents</h1>
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
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="p-4 text-muted-foreground">Loading…</td></tr>}
            {data?.docs.map((d) => (
              <tr key={d.id} className="border-b last:border-0">
                <td className="px-3 py-2 text-xs">{(d.sources as { slug?: string } | null)?.slug}</td>
                <td className="px-3 py-2"><a href={d.url} target="_blank" rel="noreferrer" className="hover:underline">{d.title || d.url}</a></td>
                <td className="px-3 py-2 text-xs uppercase">{d.lang}</td>
                <td className="px-3 py-2 text-xs">{d.content_type}</td>
                <td className="px-3 py-2 text-xs">{d.status}</td>
                <td className="px-3 py-2 text-xs text-rose-600 dark:text-rose-400 truncate max-w-xs">{d.error}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
