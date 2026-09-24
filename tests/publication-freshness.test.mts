import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractPublishedAtFromMarkdown as date,
  extractPublishedAtFromPage as page,
} from "../src/lib/published-date.server.ts";
import { fetchLatestDocuments } from "../src/lib/latest-documents.server.ts";
const url = "https://www.ai.se/sv/nyheter/test";
test("publisher date formats, exact calendar validation, and no dates from body/events", () => {
  for (const [text, expected] of [
    ["torsdag, juni 12, 2025", "2025-06-12"],
    ["Wednesday, September 23, 2026", "2026-09-23"],
    ["28 augusti 2025, 06:32", "2025-08-28"],
    ["2026-09-23", "2026-09-23"],
  ])
    assert.equal(date(`# Article\n\n${text}\n\nBody`, url)?.date.slice(0, 10), expected);
  for (const text of ["31 februari 2025", "2025-02-31", "Image caption", "2026-13-01"])
    assert.equal(date(`# Article\n\n${text}\n\n## Related\n2026-09-23`, url), null);
  assert.equal(date("# Event\n\n2026-09-23", "https://www.ai.se/sv/event/test"), null);
  assert.equal(
    page(
      '<time datetime="2026-06-09">Related</time>',
      "# Article\n\n28 augusti 2025, 06:32",
      url,
    )?.date.slice(0, 10),
    "2025-08-28",
  );
  assert.equal(page('<time datetime="2026-06-09">Related</time>', "# Article\n\nBody", url), null);
});

function db(rows) {
  return {
    from() {
      let predicates = [],
        ordering = [],
        limit = 1000;
      const q = {
        select() {
          return q;
        },
        eq(k, v) {
          predicates.push((r) => r[k] === v);
          return q;
        },
        is(k, v) {
          predicates.push((r) => r[k] === v);
          return q;
        },
        not(k, op, v) {
          predicates.push((r) => r[k] !== v);
          return q;
        },
        limit(n) {
          limit = n;
          return q;
        },
        order(k, o) {
          ordering.push([k, o]);
          return q;
        },
        then(resolve) {
          const data = rows
            .filter((r) => predicates.every((p) => p(r)))
            .sort((a, b) => {
              for (const [k, o] of ordering) {
                if (a[k] === b[k]) continue;
                if (a[k] === null) return o.nullsFirst ? -1 : 1;
                if (b[k] === null) return o.nullsFirst ? 1 : -1;
                return (a[k] < b[k] ? -1 : 1) * (o.ascending ? 1 : -1);
              }
              return 0;
            })
            .slice(0, limit);
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return q;
    },
  };
}
test("global latest includes new records beyond 1000, combines fallback dates, and respects filters", async () => {
  const rows = Array.from({ length: 1300 }, (_, i) => ({
    url: `https://x/${i}`,
    status: "embedded",
    hidden: false,
    source_id: "ai",
    lang: "sv",
    page_type: "news",
    published_at: "2025-01-01T00:00:00Z",
    sitemap_lastmod: "2026-09-24T00:00:00Z",
  }));
  rows.push({ ...rows[0], url: "https://x/new", published_at: "2026-09-23T00:00:00Z" });
  rows.push({
    ...rows[0],
    url: "https://x/fallback",
    published_at: null,
    sitemap_lastmod: "2026-09-22T00:00:00Z",
  });
  rows.push({
    ...rows[0],
    url: "https://x/hidden",
    hidden: true,
    published_at: "2027-01-01T00:00:00Z",
  });
  rows.push({
    ...rows[0],
    url: "https://x/other",
    source_id: "rise",
    published_at: "2027-01-01T00:00:00Z",
  });
  const result = await fetchLatestDocuments(db(rows), {
    sourceId: "ai",
    lang: "sv",
    pageType: "news",
    limit: 2,
  });
  assert.deepEqual(
    result.map((r) => r.d.url),
    ["https://x/new", "https://x/fallback"],
  );
});

test("sitemap audit rejects HTTP-200 block pages and incomplete child indexes", async () => {
  const { fetchSitemap } = await import("../src/lib/firecrawl.server.ts");
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("<html><title>Verifying...</title></html>");
    await assert.rejects(fetchSitemap("https://example.test"), /Sitemap unavailable/);
    globalThis.fetch = async (url) =>
      new Response(
        String(url).endsWith("child.xml")
          ? "<html>Blocked</html>"
          : "<sitemapindex><sitemap><loc>https://example.test/child.xml</loc></sitemap></sitemapindex>",
      );
    await assert.rejects(fetchSitemap("https://example.test"), /Sitemap unavailable/);
    globalThis.fetch = async () =>
      new Response(
        "<urlset><url><loc>https://example.test/news/one</loc><lastmod>2026-09-23</lastmod></url></urlset>",
      );
    assert.deepEqual(await fetchSitemap("https://example.test"), [
      { url: "https://example.test/news/one", lastmod: "2026-09-23" },
    ]);
  } finally {
    globalThis.fetch = original;
  }
});
