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

  // 6. Boilerplate-zero: assert no chunks still contain known chrome strings.
  await wrap("boilerplate-zero", async () => {
    const phrases = ["CAPTCHA", "Expand/contract", "Skip to main content"];
    let total = 0;
    const offenders: string[] = [];
    for (const p of phrases) {
      const { count } = await sb
        .from("chunks")
        .select("*", { count: "exact", head: true })
        .ilike("text", `%${p}%`);
      const n = count ?? 0;
      total += n;
      if (n > 0) offenders.push(`${p}=${n}`);
    }
    return {
      name: "boilerplate-zero",
      pass: total === 0,
      detail: total === 0 ? "no chunks contain known chrome strings" : offenders.join(", "),
    };
  });

  // 7. Cross-doc duplicate metric: sample chunks; for each, count peer chunks
  //    in OTHER docs with similarity > 0.97. A clean corpus has near zero.
  await wrap("cross-doc duplicate chunks", async () => {
    const { data: sample } = await sb
      .from("chunks")
      .select("id, document_id, embedding")
      .limit(200);
    if (!sample?.length) return { name: "cross-doc duplicates", pass: true, detail: "no chunks" };
    let bad = 0;
    let checked = 0;
    for (const row of sample.slice(0, 50) as Array<{ id: string; document_id: string; embedding: unknown }>) {
      const { data: rpc, error } = await sb.rpc("match_chunks", {
        query_embedding: row.embedding as string,
        match_count: 20,
      });
      if (error) continue;
      checked++;
      const peers = ((rpc ?? []) as Array<{ document_id: string; similarity: number }>)
        .filter((r) => r.document_id !== row.document_id && r.similarity > 0.97);
      if (peers.length >= 5) bad++;
    }
    const pct = checked ? (bad / checked) * 100 : 0;
    return {
      name: "cross-doc duplicates",
      pass: pct < 5,
      detail: `${bad}/${checked} sample chunks have ≥5 near-dup peers (${pct.toFixed(1)}%)`,
    };
  });

  // 8. Usable-date coverage for HTML docs. list_latest ranks by
  //    published_at OR sitemap_lastmod OR path-month, so any of those
  //    counts. Meta-only coverage is what the sites emit (~10%); the
  //    combined metric is what actually matters and should be ≥ 95%.
  await wrap("html usable-date coverage", async () => {
    const { count: total } = await sb
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("content_type", "html")
      .eq("status", "embedded");
    // Paginate to bypass PostgREST's default 1000-row limit.
    const pathMonthRe = /\/(20\d{2})[-/](0[1-9]|1[0-2])(?:[-/]|$)/;
    let withDate = 0;
    const pageSize = 1000;
    for (let from = 0; from < (total ?? 0); from += pageSize) {
      const { data: rows } = await sb
        .from("documents")
        .select("url, published_at, sitemap_lastmod")
        .eq("content_type", "html")
        .eq("status", "embedded")
        .range(from, from + pageSize - 1);
      for (const d of (rows ?? []) as Array<{ url: string; published_at: string | null; sitemap_lastmod: string | null }>) {
        if (d.published_at || d.sitemap_lastmod || pathMonthRe.test(d.url)) withDate++;
      }
    }
    const pct = total ? (withDate / total) * 100 : 0;
    return {
      name: "html usable-date coverage",
      pass: pct >= 95,
      detail: `${withDate}/${total ?? 0} HTML embedded docs have a usable date (${pct.toFixed(1)}%)`,
    };
  });

  // 9. filter_miss rate (must stay below ~2% of HTML docs).
  await wrap("filter_miss rate", async () => {
    const { count: total } = await sb
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("content_type", "html");
    const { count: misses } = await sb
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("content_type", "html")
      .eq("filter_miss", true);
    const pct = total ? ((misses ?? 0) / total) * 100 : 0;
    return {
      name: "filter_miss rate",
      pass: pct <= 2,
      detail: `${misses ?? 0}/${total ?? 0} HTML docs hit fallback (${pct.toFixed(2)}%)`,
    };
  });

  // 10. Lexical-entity canary: hybrid search for a proper noun should return
  //     ≥10 distinct documents that literally contain the term, AND the
  //     find_mentions total should be within ±10% of the raw ILIKE count.
  await wrap("lexical entity canary (Helsingborg)", async () => {
    const term = "Helsingborg";

    // Vector arm
    const vec = await embedQuery(term);
    const { data: vecRows, error: vErr } = await sb.rpc("match_chunks", {
      query_embedding: vec as unknown as string,
      match_count: 30,
    });
    if (vErr) throw new Error(`match_chunks: ${vErr.message}`);

    // Lexical arm
    const { data: lexRows, error: lErr } = await sb.rpc("lexical_match_chunks", {
      query_text: term,
      match_count: 30,
    });
    if (lErr) throw new Error(`lexical_match_chunks: ${lErr.message}`);

    // RRF fuse (lex weight 2x — single-token query)
    const RRF_K = 60;
    type R = { document_id: string; url: string };
    const byDoc = new Map<string, { doc: R; score: number }>();
    (vecRows as R[] ?? []).forEach((r, i) => {
      const c = 1 / (RRF_K + i + 1);
      const cur = byDoc.get(r.document_id);
      if (cur) cur.score += c; else byDoc.set(r.document_id, { doc: r, score: c });
    });
    (lexRows as R[] ?? []).forEach((r, i) => {
      const c = 2 / (RRF_K + i + 1);
      const cur = byDoc.get(r.document_id);
      if (cur) cur.score += c; else byDoc.set(r.document_id, { doc: r, score: c });
    });
    const fused = [...byDoc.values()].sort((a, b) => b.score - a.score).slice(0, 20);

    // How many of the top-20 fused docs literally contain "Helsingborg"?
    const ids = fused.map((f) => f.doc.document_id);
    const { data: docHits } = await sb
      .from("documents")
      .select("id, raw_markdown")
      .in("id", ids);
    const literal = (docHits ?? []).filter((d: { raw_markdown: string | null }) =>
      (d.raw_markdown ?? "").toLowerCase().includes("helsingborg"),
    ).length;

    // Parity: find_mentions_total vs raw ILIKE
    const { data: rpcTotal, error: tErr } = await sb.rpc("find_mentions_total", {
      query_text: term,
    });
    if (tErr) throw new Error(`find_mentions_total: ${tErr.message}`);
    const { count: rawTotal } = await sb
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("status", "embedded")
      .eq("hidden", false)
      .ilike("raw_markdown", `%${term}%`);

    const total = Number(rpcTotal ?? 0);
    const raw = rawTotal ?? 0;
    const drift = raw ? Math.abs(total - raw) / raw : 0;

    const pass = literal >= 10 && drift <= 0.1;
    return {
      name: "lexical entity canary",
      pass,
      detail: `top-20 literal=${literal}/20, find_mentions_total=${total} vs raw ILIKE=${raw} (drift ${(drift * 100).toFixed(1)}%)`,
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
