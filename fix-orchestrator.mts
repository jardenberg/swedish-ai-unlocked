// One-shot orchestrator for the QA fixes:
//   1. Re-map ai_sweden (picks up /sv/ pages via extended url_filter_patterns)
//   2. Discover PDFs from already-scraped markdown (both sources)
//   3. Reset embedded -> scraped so they get re-embedded with cleanMarkdown
import { createClient } from "@supabase/supabase-js";
import Firecrawl from "@mendable/firecrawl-js";
import { canonicalizeUrl } from "/dev-server/src/lib/url-canonical.server.ts";
import { fetchSitemap, detectLang, urlMatchesFilters } from "/dev-server/src/lib/firecrawl.server.ts";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const fc = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });

async function remap(slug: string) {
  const { data: source } = await sb.from("sources").select("*").eq("slug", slug).single();
  if (!source) throw new Error("no source");
  console.log(`[remap ${slug}] root=${source.root_url}`);

  const sitemap = await fetchSitemap(source.root_url);
  console.log(`  sitemap: ${sitemap.length} entries`);
  const filteredSm = sitemap.filter((e) =>
    urlMatchesFilters(e.url, source.url_filter_patterns, source.exclude_patterns),
  );
  console.log(`  after filter: ${filteredSm.length}`);

  let mapLinks: string[] = [];
  try {
    const mr: any = await fc.map(source.root_url, { limit: 5000, includeSubdomains: false });
    mapLinks = (mr.links ?? []).map((l: any) => (typeof l === "string" ? l : l.url));
    console.log(`  firecrawl map: ${mapLinks.length}`);
  } catch (e) {
    console.warn(`  firecrawl map failed: ${(e as Error).message}`);
  }

  const byUrl = new Map<string, string | undefined>();
  for (const e of filteredSm) byUrl.set(canonicalizeUrl(e.url), e.lastmod);
  for (const link of mapLinks) {
    if (!urlMatchesFilters(link, source.url_filter_patterns, source.exclude_patterns)) continue;
    const c = canonicalizeUrl(link);
    if (!byUrl.has(c)) byUrl.set(c, undefined);
  }

  const rows = Array.from(byUrl.entries()).map(([url, lastmod]) => ({
    source_id: source.id,
    url,
    lang: detectLang(url),
    content_type: url.toLowerCase().endsWith(".pdf") ? "pdf" : "html",
    sitemap_lastmod: lastmod ?? null,
    status: "pending",
  }));

  let upserts = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500);
    const { error } = await sb.from("documents").upsert(slice, { onConflict: "url", ignoreDuplicates: true });
    if (error) console.error("upsert err", error.message);
    else upserts += slice.length;
  }
  console.log(`  upserted (ignore dup): ${upserts}`);
}

async function discoverPdfs(slug: string) {
  const { data: source } = await sb.from("sources").select("*").eq("slug", slug).single();
  if (!source) return;
  console.log(`[pdfs ${slug}]`);
  const baseHost = new URL(source.root_url).hostname.replace(/^www\./, "");
  const { data: existing } = await sb.from("documents").select("url").eq("source_id", source.id);
  const known = new Set((existing ?? []).map((d) => d.url));

  const PDF_RE = /\(([^)\s]+\.pdf)(?:[?#][^)\s]*)?\)|href=["']([^"'\s]+\.pdf)(?:[?#][^"'\s]*)?["']/gi;
  const found = new Set<string>();
  let from = 0;
  const PAGE = 200;
  for (;;) {
    const { data: page } = await sb
      .from("documents")
      .select("url, raw_markdown")
      .eq("source_id", source.id)
      .not("raw_markdown", "is", null)
      .range(from, from + PAGE - 1);
    if (!page || page.length === 0) break;
    for (const d of page) {
      const md = d.raw_markdown ?? "";
      let m: RegExpExecArray | null;
      PDF_RE.lastIndex = 0;
      while ((m = PDF_RE.exec(md)) !== null) {
        const raw = m[1] ?? m[2];
        if (!raw) continue;
        let abs: string;
        try { abs = new URL(raw, d.url).toString(); } catch { continue; }
        const u = canonicalizeUrl(abs);
        if (!u.toLowerCase().endsWith(".pdf")) continue;
        try {
          const h = new URL(u).hostname.replace(/^www\./, "");
          if (h !== baseHost) continue;
        } catch { continue; }
        if (known.has(u) || found.has(u)) continue;
        found.add(u);
      }
    }
    if (page.length < PAGE) break;
    from += PAGE;
  }
  console.log(`  found ${found.size} new PDFs`);
  const rows = Array.from(found).map((url) => ({
    source_id: source.id, url, lang: detectLang(url),
    content_type: "pdf", status: "pending",
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("documents")
      .upsert(rows.slice(i, i + 500), { onConflict: "url", ignoreDuplicates: true });
    if (error) console.error("pdf upsert err", error.message);
  }
}

async function resetForReembed() {
  // Mark all currently embedded docs as 'scraped' so they re-embed with cleanMarkdown
  const { count } = await sb.from("documents").select("*", { count: "exact", head: true }).eq("status", "embedded");
  console.log(`[reset] ${count} embedded -> scraped (will re-embed with cleaner)`);
  const { error } = await sb.from("documents").update({ status: "scraped" }).eq("status", "embedded");
  if (error) console.error("reset err", error.message);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--remap-ai-sweden") || args.length === 0) await remap("ai_sweden");
  if (args.includes("--remap-rise")) await remap("rise");
  if (args.includes("--pdfs") || args.length === 0) {
    await discoverPdfs("rise");
    await discoverPdfs("ai_sweden");
  }
  if (args.includes("--reset-embed") || args.length === 0) await resetForReembed();

  const counts = await sb.from("documents").select("status, content_type", { count: "exact" });
  console.log("DONE. Now run batch-ingest.mts.");
  console.log(counts);
}

main().catch((e) => { console.error(e); process.exit(1); });
