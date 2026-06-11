import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { getSmokeHistory, runSmokeNow } from "@/lib/admin-observability.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/admin/smoke")({
  component: SmokePage,
});

function SmokePage() {
  const qc = useQueryClient();
  const historyFn = useServerFn(getSmokeHistory);
  const runFn = useServerFn(runSmokeNow);

  const { data: hist, isLoading } = useQuery({
    queryKey: ["smoke-history"],
    queryFn: () => historyFn({ data: { limit: 30 } }),
  });

  const runMut = useMutation({
    mutationFn: () => runFn(),
    onSuccess: (r) => {
      if (r.fail === 0) toast.success(r.summary);
      else toast.error(r.summary, { duration: 10_000 });
      qc.invalidateQueries({ queryKey: ["smoke-history"] });
      qc.invalidateQueries({ queryKey: ["admin-overview"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // Collect distinct check names across history, ordered by most-recent first run
  const checkNames = new Set<string>();
  for (const r of hist?.runs ?? []) {
    for (const n of r.failNames) checkNames.add(n);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Smoke tests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Post-ingest sanity canaries. Last 30 runs shown as a heatmap; failing checks listed below.
          </p>
        </div>
        <Button onClick={() => runMut.mutate()} disabled={runMut.isPending}>
          {runMut.isPending ? "Running…" : "Run smoke now"}
        </Button>
      </div>

      {runMut.data && (
        <Card className="p-4 text-sm">
          <div className={`mb-2 font-semibold ${runMut.data.fail === 0 ? "text-emerald-700" : "text-rose-600"}`}>
            {runMut.data.pass}/{runMut.data.results.length} pass
          </div>
          <ul className="space-y-1 text-xs">
            {runMut.data.results.map((r) => (
              <li key={r.name} className="flex gap-2">
                <span className={r.pass ? "text-emerald-600" : "text-rose-600"}>{r.pass ? "✓" : "✗"}</span>
                <span className="font-medium">{r.name}</span>
                <span className="text-muted-foreground">— {r.detail}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold">Last 30 runs</h2>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : !hist?.runs.length ? (
          <div className="text-sm text-muted-foreground">No smoke runs yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="flex gap-1">
              {hist.runs.map((r) => (
                <div
                  key={r.id}
                  className={`h-6 w-2 rounded ${
                    r.total === 0
                      ? "bg-muted"
                      : r.pass === r.total
                        ? "bg-emerald-500"
                        : "bg-rose-500"
                  }`}
                  title={`${new Date(r.at).toLocaleString()} — ${r.pass}/${r.total}${r.failNames.length ? ` — fails: ${r.failNames.join(", ")}` : ""}`}
                />
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
              <span>{hist.runs[hist.runs.length - 1] && new Date(hist.runs[hist.runs.length - 1].at).toLocaleDateString()}</span>
              <span>now</span>
            </div>
          </div>
        )}
      </Card>

      {checkNames.size > 0 && (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Recurring failures</h2>
          <ul className="space-y-1 text-xs">
            {[...checkNames].map((name) => {
              const count = (hist?.runs ?? []).filter((r) => r.failNames.includes(name)).length;
              return (
                <li key={name}>
                  <span className="font-mono">{name}</span>{" "}
                  <span className="text-muted-foreground">failed in {count}/{hist?.runs.length ?? 0} recent runs</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
