// Read-only audit against a database snapshot exported by the operator.
// No credentials required; never changes corpus scope or document states.
import { readFileSync, writeFileSync } from "node:fs";
import { fetchSitemap, urlMatchesFilters } from "../src/lib/firecrawl.server.ts";
import { canonicalizeUrl } from "../src/lib/url-canonical.server.ts";
const snapshot = JSON.parse(readFileSync(process.argv[2], "utf8"));
const report = { checkedAt: new Date().toISOString(), sources: [] };
for (const source of snapshot.sources) {
  const sitemap = await fetchSitemap(source.root_url);
  if (!sitemap.length) {
    report.sources.push({
      source: source.slug,
      verified: false,
      error: "No sitemap entries returned; coverage not certified",
    });
    continue;
  }
  const scoped = new Map(
    sitemap
      .filter((e) => urlMatchesFilters(e.url, source.url_filter_patterns, source.exclude_patterns))
      .map((e) => [canonicalizeUrl(e.url), e]),
  );
  const stored = new Map(
    snapshot.documents
      .filter((d) => d.source_id === source.id)
      .map((d) => [canonicalizeUrl(d.url), d]),
  );
  const missing = [],
    stale = [],
    parked = [];
  for (const [url, e] of scoped) {
    const d = stored.get(url);
    if (!d) missing.push(e);
    else if (d.status !== "embedded" || d.hidden)
      parked.push({ url, status: d.status, hidden: d.hidden });
    else if (e.lastmod && Date.parse(e.lastmod) > Date.parse(d.fetched_at ?? "1970-01-01"))
      stale.push({ url, lastmod: e.lastmod, fetchedAt: d.fetched_at });
  }
  const r = {
    source: source.slug,
    sitemapTotal: sitemap.length,
    eligible: scoped.size,
    matched: scoped.size - missing.length,
    missing,
    stale,
    parked,
  };
  report.sources.push(r);
  console.log(
    JSON.stringify({
      ...r,
      missing: r.missing.length,
      stale: r.stale.length,
      parked: r.parked.length,
    }),
  );
}
writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + "\n");
