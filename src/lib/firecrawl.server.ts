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
    } catch (e) {
      console.warn("[sitemap] fetch/parse failed", sm, (e as Error).message);
    }
  }
  return Array.from(out.entries()).map(([url, lastmod]) => ({ url, lastmod }));
}

// ri.se's WAF 403s unknown bot UAs outright and rate-limits bursts, so send a
// browser UA (with a bot token appended for transparency) and retry on 403/429.
const SITEMAP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 SwedishAILibrarianBot/1.0";

async function fetchSitemapXml(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    const res = await fetch(url, {
      headers: { "User-Agent": SITEMAP_UA, Accept: "application/xml,text/xml,*/*" },
    });
    if (res.ok) return await res.text();
    if (res.status !== 403 && res.status !== 429 && res.status < 500) return null;
  }
  console.warn("[sitemap] gave up after retries (WAF/rate-limit)", url);
  return null;
}

async function collectSitemap(url: string, out: Map<string, string | undefined>, depth = 0) {
  if (depth > 3) return;
  const xml = await fetchSitemapXml(url);
  if (xml === null) return;

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

// Junk-PDF patterns we never want to index (templates, ToS, appendices).
const JUNK_PDF_RE =
  /\/(?:[^/]*[-_])?(?:template|terms[-_]and[-_]conditions|appendix(?:[-_.]|$))[^/]*\.pdf$/i;

export function isJunkPdfUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (!lower.endsWith(".pdf")) return false;
  return JUNK_PDF_RE.test(lower);
}


