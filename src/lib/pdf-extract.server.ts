// PDF text extraction. Primary: unpdf (JS, Worker-compatible).
// Fallback: Firecrawl scrape with parsers: ['pdf'] when text density < 200 chars/page.
import { extractText, getDocumentProxy, getMeta } from "unpdf";

import { getFirecrawl } from "./firecrawl.server";
import {
  extractPublishedAtFromPdfMeta,
  extractPublishedAtFromPdfUrl,
  type PublishedAtResult,
} from "./published-date.server";

export interface PdfExtractResult {
  text: string;
  pages: number;
  method: "unpdf" | "firecrawl";
  title?: string;
  publishedAt?: PublishedAtResult | null;
}

export interface ExtractPdfInput {
  url: string;
  /** When set, fetch bytes from Supabase Storage instead of `url`. */
  storagePath?: string;
}

async function fetchBytes(input: ExtractPdfInput): Promise<Uint8Array> {
  if (input.storagePath) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.storage
      .from("manual-pdfs")
      .download(input.storagePath);
    if (error || !data) throw new Error(`storage download failed: ${error?.message}`);
    return new Uint8Array(await data.arrayBuffer());
  }
  const res = await fetch(input.url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; SwedishAILibrarianBot/1.0)",
      "Accept": "application/pdf,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`fetch failed ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (ct && !/application\/pdf|octet-stream/i.test(ct)) {
    throw new Error(
      `expected application/pdf but server returned ${ct} (likely redirected to an HTML page)`,
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

function isUsableTitle(t: string | undefined | null): t is string {
  if (!t) return false;
  const s = t.trim();
  if (s.length < 3 || s.length > 300) return false;
  if (/^untitled$/i.test(s)) return false;
  if (/^microsoft (word|powerpoint) -/i.test(s)) return false;
  if (/\.(pdf|docx?|pptx?)$/i.test(s)) return false;
  return true;
}

function titleFromText(text: string): string | undefined {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const l of lines.slice(0, 30)) {
    if (l.length >= 10 && l.length <= 200 && !/^page \d+/i.test(l) && !/^\d+$/.test(l)) {
      if (l === l.toUpperCase() && l.length < 20) continue;
      return l;
    }
  }
  return undefined;
}

function titleFromUrl(url: string): string {
  try {
    const name = new URL(url).pathname.split("/").pop() ?? url;
    let decoded = name;
    try { decoded = decodeURIComponent(name); } catch { /* keep raw */ }
    return decoded
      .replace(/\.pdf$/i, "")
      .replace(/_0$/, "")
      .replace(/[_-]+/g, " ")
      .trim();
  } catch {
    return url;
  }
}

// Reject PDF extractions that are clearly site-shell HTML (the bucket-1 redirect bug).
const HTML_SHELL_MARKERS = [
  /st[äa]ng meny/i,
  /skip to main content/i,
  /s[öo]k p[åa] webbplatsen/i,
  /research institutes of sweden/i,
  /search the website/i,
];

function looksLikeSiteShell(text: string): boolean {
  if (!text) return false;
  // Only flag short outputs — a real long PDF can incidentally mention these terms.
  if (text.length > 8000) return false;
  let hits = 0;
  for (const re of HTML_SHELL_MARKERS) if (re.test(text)) hits++;
  return hits >= 2;
}

export async function extractPdf(input: ExtractPdfInput | string): Promise<PdfExtractResult> {
  const inp: ExtractPdfInput = typeof input === "string" ? { url: input } : input;

  // 1) Try unpdf
  try {
    const buf = await fetchBytes(inp);
    const pdf = await getDocumentProxy(buf);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    const merged = Array.isArray(text) ? text.join("\n\n") : text;

    if (looksLikeSiteShell(merged)) {
      throw new Error("PDF extraction returned site HTML (likely redirect)");
    }

    // Title: metadata first, then first-line heuristic, then URL
    let title: string | undefined;
    let publishedAt: PublishedAtResult | null = null;
    try {
      const meta = await getMeta(pdf);
      const metaTitle = (meta?.info as Record<string, unknown> | undefined)?.Title;
      if (typeof metaTitle === "string" && isUsableTitle(metaTitle)) {
        title = metaTitle.trim();
      }
      publishedAt = extractPublishedAtFromPdfMeta(meta);
    } catch { /* ignore */ }
    if (!title) title = titleFromText(merged);
    if (!title) title = titleFromUrl(inp.url);
    if (!publishedAt) publishedAt = extractPublishedAtFromPdfUrl(inp.url);

    const density = merged.length / Math.max(totalPages, 1);
    if (density >= 200) {
      return { text: merged, pages: totalPages, method: "unpdf", title, publishedAt };
    }
    // density too low → fall through to Firecrawl OCR (but keep title we found)
  } catch (e) {
    console.warn("[pdf-extract] unpdf failed, falling back:", (e as Error).message);
  }

  // 2) Firecrawl fallback (cannot use for storage-only PDFs)
  if (inp.storagePath) {
    throw new Error("PDF extraction failed and Firecrawl fallback is not available for storage-only PDFs");
  }
  try {
    const fc = getFirecrawl();
    const result = (await fc.scrape(inp.url, {
      formats: ["markdown"],
      parsers: ["pdf"],
      onlyMainContent: false,
    } as unknown as Parameters<typeof fc.scrape>[1])) as
      | { markdown?: string; metadata?: { title?: string } }
      | null;
    const md = result?.markdown ?? "";
    if (!md) {
      throw new Error("Firecrawl returned no markdown for PDF");
    }
    if (looksLikeSiteShell(md)) {
      throw new Error("PDF extraction returned site HTML (likely redirect)");
    }
    const fallbackTitle =
      result?.metadata?.title?.trim() || titleFromText(md) || titleFromUrl(inp.url);
    return {
      text: md,
      pages: 0,
      method: "firecrawl",
      title: fallbackTitle,
      publishedAt: extractPublishedAtFromPdfUrl(inp.url),
    };
  } catch (e) {
    throw new Error(`PDF extraction failed: ${(e as Error).message}`);
  }
}
