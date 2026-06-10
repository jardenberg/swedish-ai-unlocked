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

// Detect language from text content. Uses Swedish stopword density and
// Swedish-specific characters (å/ä/ö). Falls back to "en" when text is too
// short or signal is too weak.
const SV_STOPWORDS = [
  "och", "att", "är", "för", "på", "med", "som", "det", "inte", "även",
  "enligt", "har", "ett", "den", "till", "av", "kan", "vid", "från", "men",
  "eller", "när", "över", "under", "samt", "varit", "blir", "denna",
];
export function detectLangFromText(text: string): "sv" | "en" {
  if (!text || text.length < 200) return "en";
  const sample = text.slice(0, 20000).toLowerCase();
  const chars = sample.length;
  // Count Swedish-specific chars
  const swChars = (sample.match(/[åäö]/g) ?? []).length;
  // Count stopwords (word-boundary)
  let swWords = 0;
  for (const w of SV_STOPWORDS) {
    const re = new RegExp(`\\b${w}\\b`, "g");
    swWords += (sample.match(re) ?? []).length;
  }
  // Density per 1000 chars
  const charDensity = (swChars / chars) * 1000;
  const wordDensity = (swWords / chars) * 1000;
  // Threshold tuned empirically: Swedish prose has ~4-12 å/ä/ö per 1000 chars
  // and 30-60 stopword hits per 1000 chars. English has near 0 of both.
  if (charDensity >= 2 || wordDensity >= 8) return "sv";
  return "en";
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

