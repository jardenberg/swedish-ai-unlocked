// Strip Drupal / CMS boilerplate from scraped markdown before chunking.
// Targets RISE (ri.se) and AI Sweden (ai.se) layouts but conservative enough
// to apply universally: only removes lines/blocks matching known patterns.

const HEADER_NOISE_LINES: RegExp[] = [
  // plain-text forms
  /^skip to main content\b/i,
  /^skip to (content|navigation)\b/i,
  /^jump (directly )?to (main )?content\b/i,
  /^hoppa till (huvudinneh[åa]ll|inneh[åa]ll)/i,
  /^main menu\b/i,
  /^toggle (navigation|menu)\b/i,
  /^search\s*$/i,
  /^menu\s*$/i,
  /^close menu\b/i,
  /^language switcher\b/i,
  /^choose language\b/i,
  /^select your language(\s*en\s*sv|\s*sv\s*en)?\s*$/i,
  /^v[äa]lj spr[åa]k\s*$/i,
  /^(svenska|english)\s*\|\s*(english|svenska)/i,
  /^(en|sv)\s*\|\s*(sv|en)\s*$/i,
  /^breadcrumbs?\s*$/i,
  /^you are here:?\s*$/i,
  /^home\s*[›»>/]\s*/i,
  /^cookie (settings|preferences|notice)/i,
  // markdown-link wrapped forms (Firecrawl emits these literally)
  /^\[\s*skip to main content[^\]]*\]\([^)]+\)\s*$/i,
  /^\[\s*skip to (content|navigation)[^\]]*\]\([^)]+\)\s*$/i,
  /^\[\s*jump (directly )?to (main )?content[^\]]*\]\([^)]+\)\s*$/i,
  /^\[\s*hoppa till (huvudinneh[åa]ll|inneh[åa]ll)[^\]]*\]\([^)]+\)\s*$/i,
];

// Standalone image-link line, e.g. [![Home](.../logo.png)](https://...)
const IMAGE_LINK_LINE = /^\s*\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\)\s*$/;

// RISE-style breadcrumb bullets, e.g. "- [Artificial intelligence](...) /"
const BREADCRUMB_BULLET = /^\s*[-*]\s+\[[^\]]+\]\([^)]+\)\s*\/\s*$/;

// Lines that look like nav menu trees: bullet links to top-level sections.
const NAV_BULLET = /^\s*[-*]\s+\[[^\]]+\]\([^)]+\)\s*$/;

// Empty fenced code block, possibly with whitespace inside.
const EMPTY_FENCE_RE = /```[ \t]*\n[\s\n]*```/g;

// Footer cut markers — once we hit one, drop everything after.
const FOOTER_CUT_MARKERS = [
  /^#{1,6}\s*(subscribe to (our )?newsletter|newsletter signup|sign up (for|to) (our )?newsletter)/i,
  /^#{1,6}\s*(follow us|stay (in touch|connected)|connect with us|find us on)/i,
  /^#{1,6}\s*(contact (us|information)|kontakt(a oss)?)/i,
  /^#{1,6}\s*(quick links|footer|site map|sitemap)/i,
  /^#{1,6}\s*(prenumerera|nyhetsbrev|f[öo]lj oss)/i,
  /^©\s*\d{4}/,
  /^copyright\s+©?\s*\d{4}/i,
];

export function cleanMarkdown(md: string): string {
  if (!md) return md;
  // 1) Strip empty fenced code blocks (Firecrawl emits these around hidden controls)
  let normalized = md.replace(/\r\n/g, "\n").replace(EMPTY_FENCE_RE, "");
  // Also handle truly empty back-to-back fences with no newline between them
  normalized = normalized.replace(/```\s*```/g, "");

  const lines = normalized.split("\n");

  // 2) Find footer cut point
  let cut = lines.length;
  for (let i = Math.floor(lines.length * 0.4); i < lines.length; i++) {
    if (FOOTER_CUT_MARKERS.some((re) => re.test(lines[i].trim()))) {
      cut = i;
      break;
    }
  }
  let body = lines.slice(0, cut);

  // 3) Trim leading boilerplate
  let start = 0;
  let proseRun = 0;
  for (let i = 0; i < body.length; i++) {
    const raw = body[i];
    const ln = raw.trim();
    if (!ln) {
      start = i + 1;
      continue;
    }
    if (HEADER_NOISE_LINES.some((re) => re.test(ln))) {
      start = i + 1;
      proseRun = 0;
      continue;
    }
    if (IMAGE_LINK_LINE.test(raw)) {
      start = i + 1;
      proseRun = 0;
      continue;
    }
    if (BREADCRUMB_BULLET.test(raw)) {
      start = i + 1;
      proseRun = 0;
      continue;
    }
    if (NAV_BULLET.test(raw)) {
      start = i + 1;
      proseRun = 0;
      continue;
    }
    // First H1 → keep from here.
    if (/^#\s+\S/.test(ln)) break;
    // Plain prose line — count it. After 3 in a row, stop trimming.
    proseRun++;
    if (proseRun >= 3) break;
  }
  body = body.slice(start);

  // 4) Collapse runs of >2 blank lines
  const out: string[] = [];
  let blanks = 0;
  for (const ln of body) {
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
