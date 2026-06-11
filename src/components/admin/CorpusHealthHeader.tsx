import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";

import { getAdminOverview } from "@/lib/admin-observability.functions";

export function CorpusHealthHeader() {
  const fn = useServerFn(getAdminOverview);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => fn(),
    refetchInterval: 30_000,
  });

  if (isLoading || !data) {
    return (
      <div className="border-b bg-muted/30">
        <div className="mx-auto max-w-6xl px-6 py-2 text-xs text-muted-foreground">
          Loading corpus health…
        </div>
      </div>
    );
  }

  const degraded = data.sources.filter((s) => s.belowPeak > 0);

  return (
    <div className="border-b bg-muted/30">
      <div className="mx-auto max-w-6xl px-6 py-3 space-y-1.5">
        {degraded.length > 0 && (
          <div className="mb-2 rounded border border-amber-400/50 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
            ⚠ Corpus degraded —{" "}
            {degraded.map((s) => `${s.slug} ${s.belowPeak} below 24h peak`).join(", ")}
          </div>
        )}
        {data.sources.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs">
            <span className="font-semibold">{s.slug}</span>
            <span className="text-emerald-700 dark:text-emerald-400">
              <b>{s.embedded}</b> embedded
            </span>
            <span className="text-muted-foreground">
              {s.delta24h == null
                ? "(no baseline yet)"
                : s.delta24h === 0
                  ? "(±0 vs 24h)"
                  : s.delta24h > 0
                    ? `(+${s.delta24h} vs 24h)`
                    : `(${s.delta24h} vs 24h)`}
            </span>
            <span className="text-muted-foreground">
              peak {s.embedded24hPeak}
            </span>
            <span>{s.chunks.toLocaleString()} chunks</span>
            <span>pending {s.pending}</span>
            <span>scraped {s.scraped}</span>
            {s.failed > 0 && (
              <span className="text-rose-600 dark:text-rose-400">failed {s.failed}</span>
            )}
            {s.hidden > 0 && <span className="text-muted-foreground">hidden {s.hidden}</span>}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[11px] text-muted-foreground">
          <span className="font-mono">{data.buildVersion}</span>
          <span>·</span>
          {data.smoke ? (
            <span
              className={
                data.smoke.allGreen
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              }
            >
              smoke {data.smoke.pass}/{data.smoke.total}{" "}
              ({new Date(data.smoke.at).toLocaleString()})
            </span>
          ) : (
            <span>no smoke run yet</span>
          )}
          <span>·</span>
          <span>{data.monthCredits} credits this month</span>
          {data.lastIngestAt && (
            <>
              <span>·</span>
              <span>last ingest {timeAgo(data.lastIngestAt)}</span>
            </>
          )}
          <span>·</span>
          <Link to="/admin/smoke" className="underline hover:text-foreground">
            smoke
          </Link>
          <Link to="/admin/pipeline" className="underline hover:text-foreground">
            pipeline
          </Link>
        </div>
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
