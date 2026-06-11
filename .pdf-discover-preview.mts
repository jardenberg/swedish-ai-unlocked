// Dry-run preview for discoverPdfs across the full corpus (both sources).
// Reports candidate new PDFs without inserting.
import { createClient } from "@supabase/supabase-js";
import { canonicalizeUrl } from "/dev-server/src/lib/url-canonical.server.ts";
import { detectLang, isJunkPdfUrl } from "/dev-server/src/lib/firecrawl.server.ts";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const PDF_RE = /\(([^)\s]+\.pdf)(?:[?#][^)\s]*)?\)|href=["']([^"'\s]+\.pdf)(?:[?#][^"'\s]*)?["']/gi;

async function preview(slug: string, apply: boolean) {
  const { data: source } = await sb.from("sources").select("*").eq("slug", slug).single();
  if (!source) { console.log(`[${slug}] not found`); return; }
  const baseHost = new URL(source.root_url).hostname.replace(/^www\./, "");

  // Full known URL set (paginated)
  const known = new Set<string>();
  {
    let from = 0; const P = 1000;
    for (;;) {
      const { data, error } = await sb.from("documents").select("url")
        .eq("source_id", source.id).order("id", { ascending: true })
        .range(from, from + P - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data) known.add(r.url);
      if (data.length < P) break;
      from += P;
    }
  }

  // Scan markdown for pdf links
  const found = new Set<string>();
  const samples: string[] = [];
  let scanned = 0;
  let from = 0; const PAGE = 200;
  for (;;) {
    const { data: page, error } = await sb.from("documents")
      .select("url, raw_markdown")
      .eq("source_id", source.id)
      .not("raw_markdown", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!page || page.length === 0) break;
    scanned += page.length;
    for (const d of page) {
      const md = (d as any).raw_markdown ?? "";
      let m: RegExpExecArray | null;
      PDF_RE.lastIndex = 0;
      while ((m = PDF_RE.exec(md)) !== null) {
        const raw = m[1] ?? m[2]; if (!raw) continue;
        let abs: string;
        try { abs = new URL(raw, (d as any).url).toString(); } catch { continue; }
        const u = canonicalizeUrl(abs);
        if (!u.toLowerCase().endsWith(".pdf")) continue;
        if (isJunkPdfUrl(u)) continue;
        try {
          const h = new URL(u).hostname.replace(/^www\./, "");
          if (h !== baseHost) continue;
        } catch { continue; }
        if (known.has(u) || found.has(u)) continue;
        found.add(u);
        if (samples.length < 8) samples.push(u);
      }
    }
    if (page.length < PAGE) break;
    from += PAGE;
  }

  console.log(`\n[${slug}] scanned=${scanned} known=${known.size} new_pdfs=${found.size}`);
  for (const s of samples) console.log(`  sample: ${s}`);

  if (apply && found.size > 0) {
    const rows = Array.from(found).map((url) => ({
      source_id: source.id, url, lang: detectLang(url),
      content_type: "pdf", status: "pending",
    }));
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const slice = rows.slice(i, i + 500);
      const { error } = await sb.from("documents")
        .upsert(slice, { onConflict: "url", ignoreDuplicates: true });
      if (error) console.error("upsert err", error.message);
      else inserted += slice.length;
    }
    console.log(`[${slug}] queued ${inserted} pending docs`);
  }
}

const apply = process.argv.includes("--apply");
await preview("rise", apply);
await preview("ai_sweden", apply);
console.log(`\n${apply ? "QUEUED." : "DRY RUN — pass --apply to queue."}`);
