import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { listRuns } from "@/lib/ingest.functions";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/admin/runs")({
  component: RunsPage,
});

function RunsPage() {
  const list = useServerFn(listRuns);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-runs"],
    queryFn: () => list(),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Ingest runs</h1>
      <Card>
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Started</th>
              <th className="px-3 py-2">Mapped</th>
              <th className="px-3 py-2">Scraped</th>
              <th className="px-3 py-2">Embedded</th>
              <th className="px-3 py-2">Failed</th>
              <th className="px-3 py-2">Credits</th>
              <th className="px-3 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={9} className="p-4 text-muted-foreground">Loading…</td></tr>}
            {data?.runs.map((r) => {
              const isSmoke = r.kind === "smoke";
              const smokeFail = isSmoke && /smoke \d+\/\d+ pass/.test(r.notes ?? "") &&
                !/smoke \d+\/\d+ pass$/.test(r.notes ?? "");
              return (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{(r.sources as { slug?: string } | null)?.slug}</td>
                  <td className="px-3 py-2 text-xs">
                    {isSmoke ? (
                      <span className={`rounded px-1.5 py-0.5 ${smokeFail ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"}`}>
                        smoke
                      </span>
                    ) : r.kind}
                  </td>
                  <td className="px-3 py-2 text-xs">{new Date(r.started_at).toLocaleString()}</td>
                  <td className="px-3 py-2 text-xs">{r.mapped}</td>
                  <td className="px-3 py-2 text-xs">{r.scraped}</td>
                  <td className="px-3 py-2 text-xs">{r.embedded}</td>
                  <td className="px-3 py-2 text-xs">{r.failed}</td>
                  <td className="px-3 py-2 text-xs">{r.credits_used}</td>
                  <td className="px-3 py-2 text-xs">{r.notes}</td>
                </tr>
              );
            })}

          </tbody>
        </table>
      </Card>
    </div>
  );
}
