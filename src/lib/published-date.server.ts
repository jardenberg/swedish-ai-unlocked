// Extract a document's actual publish date from HTML, PDF metadata, or URL.

export type PublishedAtSource = "meta" | "visible_date" | "pdf_path" | "pdf_metadata" | "sitemap";

export interface PublishedAtResult {
  date: string; // ISO timestamp
  source: PublishedAtSource;
}

// HTML: prefer article:published_time, then datePublished, then visible date.
export function extractPublishedAtFromHtml(
  rawHtml: string | null | undefined,
): PublishedAtResult | null {
  if (!rawHtml) return null;

  // 1) <meta property="article:published_time" content="..."> (Drupal/OG)
  const og = rawHtml.match(
    /<meta\s+[^>]*property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i,
  );
  if (og?.[1]) {
    const iso = normalizeDate(og[1]);
    if (iso) return { date: iso, source: "meta" };
  }
  // Same attr order reversed
  const og2 = rawHtml.match(
    /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']article:published_time["']/i,
  );
  if (og2?.[1]) {
    const iso = normalizeDate(og2[1]);
    if (iso) return { date: iso, source: "meta" };
  }

  // 2) <meta name="dcterms.created" / "date" / "pubdate">
  const meta = rawHtml.match(
    /<meta\s+[^>]*name=["'](?:dcterms\.created|date|pubdate|publishdate)["'][^>]*content=["']([^"']+)["']/i,
  );
  if (meta?.[1]) {
    const iso = normalizeDate(meta[1]);
    if (iso) return { date: iso, source: "meta" };
  }

  // 3) JSON-LD datePublished
  const jsonLd = rawHtml.match(/"datePublished"\s*:\s*"([^"]+)"/);
  if (jsonLd?.[1]) {
    const iso = normalizeDate(jsonLd[1]);
    if (iso) return { date: iso, source: "meta" };
  }

  // A generic first <time> can be navigation, a related article, or an event.
  // Only explicitly marked publication times are safe without page context.
  const time =
    rawHtml.match(/<time\b[^>]*itemprop=["']datePublished["'][^>]*datetime=["']([^"']+)["']/i) ??
    rawHtml.match(/<time\b[^>]*datetime=["']([^"']+)["'][^>]*itemprop=["']datePublished["']/i);
  if (time?.[1]) {
    const iso = normalizeDate(time[1]);
    if (iso) return { date: iso, source: "visible_date" };
  }

  return null;
}

// PDFs: derive month from /sites/default/files/YYYY-MM/ URL pattern.
export function extractPublishedAtFromPdfUrl(url: string): PublishedAtResult | null {
  const m = url.match(/\/files\/(\d{4})-(\d{2})\//);
  if (m) {
    const yyyy = m[1];
    const mm = m[2];
    const iso = `${yyyy}-${mm}-01T00:00:00Z`;
    if (normalizeDate(iso)) return { date: iso, source: "pdf_path" };
  }
  return null;
}

// PDFs: read CreationDate from unpdf metadata (D:YYYYMMDDHHmmSS format).
export function extractPublishedAtFromPdfMeta(meta: unknown): PublishedAtResult | null {
  if (!meta || typeof meta !== "object") return null;
  const info = (meta as { info?: Record<string, unknown> }).info;
  if (!info) return null;
  const raw = info.CreationDate ?? info.creationDate ?? info.ModDate;
  if (typeof raw !== "string") return null;
  // PDF date format: D:20240315103045+02'00' or plain ISO
  const m = raw.match(/^D:(\d{4})(\d{2})(\d{2})/);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}T00:00:00Z`;
    if (normalizeDate(iso)) return { date: iso, source: "pdf_metadata" };
  }
  const iso = normalizeDate(raw);
  if (iso) return { date: iso, source: "pdf_metadata" };
  return null;
}

function normalizeDate(s: string): string | null {
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    const year = d.getUTCFullYear();
    // Sanity: reject anything before 2000 or > 2 years in the future
    if (year < 2000 || year > new Date().getUTCFullYear() + 2) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

// Only the date immediately following a news headline is publication evidence.
// Never scan the article body, related links, or event dates for a plausible date.
export function extractPublishedAtFromMarkdown(
  markdown: string | null | undefined,
  url: string,
): PublishedAtResult | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  if (!/\/(?:news|nyheter)\//.test(path) || !markdown) return null;
  const header = markdown.match(/^# [^\n]+\n+([^\n]+)/m)?.[1]?.trim();
  if (!header) return null;
  const value = header
    .replace(
      /^(?:måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag|monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+/i,
      "",
    )
    .toLowerCase();
  const months = [
    "januari|january",
    "februari|february",
    "mars|march",
    "april",
    "maj|may",
    "juni|june",
    "juli|july",
    "augusti|august",
    "september",
    "oktober|october",
    "november",
    "december",
  ];
  let year: number, month: number, day: number;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ ,T].*)?$/);
  const words = value.match(
    /^(?:(\d{1,2})\s+)?([a-zåäö]+)\s+(\d{1,2}|\d{4})(?:,?\s+(\d{4}))?(?:,?\s+\d{2}:\d{2})?$/,
  );
  if (iso) {
    year = +iso[1];
    month = +iso[2];
    day = +iso[3];
  } else if (words) {
    month = months.findIndex((m) => m.split("|").includes(words[2])) + 1;
    day = +(words[1] ?? words[3]);
    year = +(words[1] ? words[3] : words[4]);
  } else return null;
  if (!month || month > 12 || day < 1 || day > 31 || !year) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const normalized = normalizeDate(date.toISOString());
  return normalized ? { date: normalized, source: "visible_date" } : null;
}

export function extractPublishedAtFromPage(
  html: string | null | undefined,
  markdown: string | null | undefined,
  url: string,
): PublishedAtResult | null {
  return extractPublishedAtFromMarkdown(markdown, url) ?? extractPublishedAtFromHtml(html);
}
