import Firecrawl from "@mendable/firecrawl-js";

export function getFirecrawl() {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not set");
  return new Firecrawl({ apiKey });
}

// Fetch sitemap(s) and return { url, lastmod } pairs. Handles sitemap indexes.
export async function fetchSitemap(rootUrl: string): Promise<Array<{ url: string; lastmod?: string }>> {
  const candidates = [
    `${rootUrl}/sitemap.xml`,
    `${rootUrl}/sitemap_index.xml`,
    `${rootUrl}/en/sitemap.xml`,
  ];
  const out = new Map<string, string | undefined>();
  for (const sm of candidates) {
    try {
      await collectSitemap(sm, out);
    } catch {
      /* ignore */
    }
  }
  return Array.from(out.entries()).map(([url, lastmod]) => ({ url, lastmod }));
}

async function collectSitemap(url: string, out: Map<string, string | undefined>, depth = 0) {
  if (depth > 3) return;
  const res = await fetch(url, { headers: { "User-Agent": "SwedishAILibrarianBot/1.0" } });
  if (!res.ok) return;
  const xml = await res.text();

  // Sitemap index?
  const sitemapMatches = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>[\s\S]*?<\/sitemap>/g)];
  if (sitemapMatches.length > 0) {
    for (const m of sitemapMatches) {
      await collectSitemap(m[1].trim(), out, depth + 1);
    }
    return;
  }
  // URL set
  const urlMatches = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)];
  for (const m of urlMatches) {
    const block = m[1];
    const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1]?.trim();
    const lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1]?.trim();
    if (loc) out.set(loc, lastmod);
  }
}

// Detect language from URL path (RISE/AI Sweden both use /en/ and /sv/ prefixes).
export function detectLang(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname.toLowerCase();
    if (p.startsWith("/en/") || p === "/en") return "en";
    if (p.startsWith("/sv/") || p === "/sv") return "sv";
    // ai.se default = en
    if (u.hostname.includes("ai.se")) return "en";
    return "sv";
  } catch {
    return "en";
  }
}

export function urlMatchesFilters(
  url: string,
  includePatterns: string[],
  excludePatterns: string[],
): boolean {
  const u = url.toLowerCase();
  if (excludePatterns.some((p) => u.includes(p.toLowerCase()))) return false;
  if (includePatterns.length === 0) return true;
  return includePatterns.some((p) => u.includes(p.toLowerCase()));
}
