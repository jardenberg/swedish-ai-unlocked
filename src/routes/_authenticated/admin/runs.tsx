import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { listRunsDetailed } from "@/lib/admin-observability.functions";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/admin/runs")({
  component: RunsPage,
});

function RunsPage() {
  const list = useServerFn(listRunsDetailed);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-runs"],
    queryFn: () => list({ data: { limit: 80 } }),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Ingest runs</h1>
      <p className="text-sm text-muted-foreground">
        Operations timeline. Embedded delta is highlighted red when negative. Click a row to expand the JSON notes.
      </p>
      <Card>
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Op</th>
              <th className="px-3 py-2">Dur</th>
              <th className="px-3 py-2">Map</th>
              <th className="px-3 py-2">Scrape</th>
              <th className="px-3 py-2">Embed</th>
              <th className="px-3 py-2">Fail</th>
              <th className="px-3 py-2">Δ embedded</th>
              <th className="px-3 py-2">Credits</th>
              <th className="px-3 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={11} className="p-4 text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {data?.runs.map((r) => {
              const isSmoke = r.kind === "smoke";
              const smokeMatch = isSmoke && r.notes?.match(/smoke (\d+)\/(\d+) pass/);
              const smokeFail = smokeMatch ? smokeMatch[1] !== smokeMatch[2] : false;
              return (
                <tr key={r.id} className="border-b last:border-0 align-top">
                  <td className="px-3 py-2 text-xs">{new Date(r.started_at).toLocaleString()}</td>
                  <td className="px-3 py-2 text-xs">{r.sourceSlug ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {isSmoke ? (
                      <span
                        className={`rounded px-1.5 py-0.5 ${
                          smokeFail
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        }`}
                      >
                        smoke
                      </span>
                    ) : (
                      r.kind
                    )}
                    {r.trigger === "cron" && (
                      <span className="ml-1 rounded bg-sky-100 px-1 py-0.5 text-[10px] text-sky-900 dark:bg-sky-900/40 dark:text-sky-200">
                        CRON
                      </span>
                    )}
                    {r.force && (
                      <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                        FORCE
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.durationMs != null ? `${Math.round(r.durationMs / 100) / 10}s` : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.mapped ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.scraped ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.embedded ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.failed ?? "—"}</td>
                  <td
                    className={`px-3 py-2 text-xs font-mono ${
                      r.delta != null && r.delta < 0
                        ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                        : r.delta != null && r.delta > 0
                          ? "text-emerald-700 dark:text-emerald-400"
                          : ""
                    }`}
                  >
                    {r.delta == null ? "—" : r.delta > 0 ? `+${r.delta}` : r.delta}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.credits_used ?? 0}</td>
                  <td className="px-3 py-2 text-xs">
                    <details>
                      <summary className="cursor-pointer truncate max-w-md text-muted-foreground">
                        {r.notes ?? "(none)"}
                      </summary>
                      <pre className="mt-1 max-w-md overflow-auto rounded bg-muted/40 p-2 font-mono text-[11px]">
                        {r.notes ?? ""}
                      </pre>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-muted-foreground">
        Per-document drill-down: <Link to="/admin/documents" className="underline">Documents</Link>
      </p>
    </div>
  );
}
