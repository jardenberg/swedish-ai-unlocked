// Boilerplate cleaning has moved to scrape time via Firecrawl include/exclude
// CSS selectors (see sources.include_tags / sources.exclude_tags). This helper
// now only normalizes whitespace so chunking is stable.
//
// Kept as an exported function so existing call sites (scrape batch, embed
// batch, reclean) continue to compile unchanged.

const EMPTY_FENCE_RE = /```[ \t]*\n[\s\n]*```/g;

export function cleanMarkdown(md: string): string {
  if (!md) return md;
  let s = md.replace(/\r\n/g, "\n");
  // Drop empty fenced code blocks (Firecrawl sometimes emits these around
  // hidden controls even when the rest of the chrome is filtered).
  s = s.replace(EMPTY_FENCE_RE, "");
  s = s.replace(/```\s*```/g, "");
  // Collapse runs of >1 blank lines and strip trailing whitespace per line.
  const lines = s.split("\n").map((l) => l.replace(/[ \t]+$/g, ""));
  const out: string[] = [];
  let blanks = 0;
  for (const ln of lines) {
    if (ln.trim() === "") {
      blanks++;
      if (blanks <= 1) out.push("");
    } else {
      blanks = 0;
      out.push(ln);
    }
  }
  return out.join("\n").trim();
}
