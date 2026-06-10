// Extract a document's actual publish date from HTML, PDF metadata, or URL.

export type PublishedAtSource =
  | "meta"
  | "visible_date"
  | "pdf_path"
  | "pdf_metadata"
  | "sitemap";

export interface PublishedAtResult {
  date: string; // ISO timestamp
  source: PublishedAtSource;
}

// HTML: prefer article:published_time, then datePublished, then visible date.
export function extractPublishedAtFromHtml(rawHtml: string | null | undefined): PublishedAtResult | null {
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

  // 4) <time datetime="...">
  const time = rawHtml.match(/<time\s+[^>]*datetime=["']([^"']+)["']/i);
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
