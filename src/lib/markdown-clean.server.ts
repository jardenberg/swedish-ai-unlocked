// Boilerplate cleaning has moved to scrape time via Firecrawl include/exclude
// CSS selectors (see sources.include_tags / sources.exclude_tags). This helper
// normalizes whitespace AND strips a small set of chrome lines that occasionally
// leak through include selectors (e.g. skip-links inside the main content
// block on a handful of templates).

const EMPTY_FENCE_RE = /```[ \t]*\n[\s\n]*```/g;

// Lines that are pure chrome regardless of where they appear. Kept tight so
// we never strip real content.
const CHROME_LINE_RES: RegExp[] = [
  /^\s*\[Skip to main content\][^\n]*$/i,
  /^\s*Skip to main content\s*$/i,
  /^\s*Expand\/contract\s+[^\n]*$/i,
  /^\s*CAPTCHA\s*$/i,
  /^\s*This question is for testing[^\n]*$/i,
];

export function cleanMarkdown(md: string): string {
  if (!md) return md;
  let s = md.replace(/\r\n/g, "\n");
  s = s.replace(EMPTY_FENCE_RE, "");
  s = s.replace(/```\s*```/g, "");
  // reCAPTCHA newsletter widgets render as a multi-line block at the bottom
  // of certain ai.se pages (signup forms). Truncate from the first marker.
  const reCapIdx = s.search(/\n\s*reCAPTCHA\s*\n/i);
  if (reCapIdx >= 0) s = s.slice(0, reCapIdx);
  const lines = s.split("\n").map((l) => l.replace(/[ \t]+$/g, ""));
  const out: string[] = [];
  let blanks = 0;
  for (const ln of lines) {
    if (CHROME_LINE_RES.some((re) => re.test(ln))) continue;
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
