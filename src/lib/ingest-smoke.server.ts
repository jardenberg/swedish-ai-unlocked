// Post-ingest smoke tests. Runs after batch/retry/refresh completes and
// logs pass/fail counts to ingest_runs.notes. The five checks below mirror
// the queries we have been running manually to catch regressions.
import type { SupabaseClient } from "@supabase/supabase-js";

import { embedQuery } from "./embeddings.server";

export interface SmokeResult {
  name: string;
  pass: boolean;
  detail: string;
}

export interface SmokeReport {
  pass: number;
  fail: number;
  results: SmokeResult[];
  summary: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySb = SupabaseClient<any, any, any>;

async function searchDocs(
  sb: AnySb,
  query: string,
  opts: { limit: number; lang?: "en" | "sv" },
): Promise<Array<{ url: string; lang: string | null; document_id: string; similarity: number }>> {
  const vec = await embedQuery(query);
  const args: Record<string, unknown> = {
    query_embedding: vec as unknown as string,
    match_count: opts.limit,
  };
  if (opts.lang) args.filter_lang = opts.lang;
  const { data, error } = await sb.rpc("match_chunks", args);
  if (error) throw new Error(`match_chunks: ${error.message}`);
  return (data ?? []) as Array<{
    url: string;
    lang: string | null;
    document_id: string;
    similarity: number;
  }>;
}

export async function runSmokeTests(sb: AnySb): Promise<SmokeReport> {
  const results: SmokeResult[] = [];

  const wrap = async (name: string, fn: () => Promise<SmokeResult>) => {
    try {
      results.push(await fn());
    } catch (e) {
      results.push({ name, pass: false, detail: `error: ${(e as Error).message}` });
    }
  };

  // 1. search dedupe
  await wrap("search dedupe (secure AI in healthcare)", async () => {
    const rows = await searchDocs(sb, "secure AI in healthcare", { limit: 5 });
    const unique = new Set(rows.map((r) => r.document_id));
    const pass = unique.size === rows.length && unique.size >= 3;
    return {
      name: "search dedupe",
      pass,
      detail: `got ${rows.length} rows, ${unique.size} unique docs`,
    };
  });

  // 2. Swedish results present
  await wrap("swedish search returns sv hits", async () => {
    const rows = await searchDocs(sb, "kommuner artificiell intelligens", {
      limit: 10,
      lang: "sv",
    });
    const pass = rows.length >= 1;
    return {
      name: "swedish search",
      pass,
      detail: `${rows.length} sv results`,
    };
  });

  // 3. "State of Swedish AI" should surface a magazine/report doc
  await wrap("state-of-swedish-ai discoverable", async () => {
    const rows = await searchDocs(sb, "State of Swedish AI", { limit: 10 });
    const pass = rows.some((r) =>
      /magazine|state[-_ ]of|report|rapport/i.test(r.url),
    );
    return {
      name: "state-of-swedish-ai",
      pass,
      detail: pass ? "magazine/report found" : `none of ${rows.length} hits looked like the magazine`,
    };
  });

  // 4. list_latest top 10 contains no pre-2024 entries
  await wrap("list_latest no pre-2024", async () => {
    const { data, error } = await sb
      .from("documents")
      .select("url, published_at, sitemap_lastmod")
      .eq("status", "embedded")
      .eq("hidden", false)
      .limit(200);
    if (error) throw new Error(error.message);
    const ranked = (data ?? [])
      .map((d: { url: string; published_at: string | null; sitemap_lastmod: string | null }) => ({
        url: d.url,
        eff: d.published_at ?? d.sitemap_lastmod,
      }))
      .sort((a, b) => {
        const av = a.eff ? new Date(a.eff).getTime() : 0;
        const bv = b.eff ? new Date(b.eff).getTime() : 0;
        return bv - av;
      })
      .slice(0, 10);
    const cutoff = new Date("2024-01-01T00:00:00Z").getTime();
    const offenders = ranked.filter(
      (r) => !r.eff || new Date(r.eff).getTime() < cutoff,
    );
    return {
      name: "list_latest publish dates",
      pass: offenders.length === 0,
      detail:
        offenders.length === 0
          ? "all top 10 dated 2024 or later"
          : `${offenders.length} offenders, e.g. ${offenders[0].url} (${offenders[0].eff})`,
    };
  });

  // 5. find_similar centroid: pick first doc whose URL hints climate/sustainability,
  //    run similarity, assert no score > 0.95 (would indicate nav-chrome match).
  await wrap("find_similar no near-duplicate (>0.95)", async () => {
    const { data: seed } = await sb
      .from("documents")
      .select("id, url")
      .eq("status", "embedded")
      .eq("hidden", false)
      .or("url.ilike.%climate%,url.ilike.%klimat%,url.ilike.%sustain%")
      .limit(1)
      .maybeSingle();
    if (!seed) {
      return { name: "find_similar", pass: true, detail: "no climate seed doc; skipped" };
    }
    const { data, error } = await sb.rpc("match_similar_documents", {
      seed_document_id: seed.id,
      match_count: 10,
    });
    if (error) throw new Error(error.message);
    const max = (data ?? []).reduce(
      (m: number, r: { similarity: number }) => Math.max(m, r.similarity ?? 0),
      0,
    );
    return {
      name: "find_similar",
      pass: max <= 0.95,
      detail: `seed=${seed.url} max=${max.toFixed(4)}`,
    };
  });

  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  const summary =
    `smoke ${pass}/${results.length} pass` +
    (fail
      ? ` — fails: ${results
          .filter((r) => !r.pass)
          .map((r) => `${r.name} (${r.detail})`)
          .join("; ")}`
      : "");

  return { pass, fail, results, summary };
}
