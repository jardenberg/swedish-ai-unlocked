// PDF text extraction. Primary: unpdf (JS, Worker-compatible).
// Fallback: Firecrawl scrape with parsers: ['pdf'] when text density < 200 chars/page.
import { extractText, getDocumentProxy } from "unpdf";

import { getFirecrawl } from "./firecrawl.server";

export interface PdfExtractResult {
  text: string;
  pages: number;
  method: "unpdf" | "firecrawl";
}

export async function extractPdf(url: string): Promise<PdfExtractResult> {
  // 1) Try unpdf
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "SwedishAILibrarianBot/1.0" },
    });
    if (!res.ok) throw new Error(`fetch failed ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const pdf = await getDocumentProxy(buf);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    const merged = Array.isArray(text) ? text.join("\n\n") : text;
    const density = merged.length / Math.max(totalPages, 1);
    if (density >= 200) {
      return { text: merged, pages: totalPages, method: "unpdf" };
    }
    // density too low → fall through to Firecrawl OCR
  } catch (e) {
    console.warn("[pdf-extract] unpdf failed, falling back:", (e as Error).message);
  }

  // 2) Firecrawl fallback
  const fc = getFirecrawl();
  const result = await fc.scrape(url, {
    formats: ["markdown"],
    parsers: ["pdf"],
    onlyMainContent: false,
  } as unknown as Parameters<typeof fc.scrape>[1]);
  const md = (result as { markdown?: string }).markdown ?? "";
  return { text: md, pages: 0, method: "firecrawl" };
}
