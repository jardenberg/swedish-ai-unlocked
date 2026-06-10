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
  /^s[öo]k\s*$/i,
  /^menu\s*$/i,
  /^meny\s*$/i,
  /^close menu\b/i,
  /^st[äa]ng meny\b/i,
  /^language switcher\b/i,
  /^choose language\b/i,
  /^select your language(\s*en\s*sv|\s*sv\s*en)?\s*$/i,
  /^v[äa]lj spr[åa]k\s*$/i,
  /^(svenska|english)\s*\|\s*(english|svenska)/i,
  /^(en|sv)\s*\|\s*(sv|en)\s*$/i,
  /^breadcrumbs?\s*$/i,
  /^you are here:?\s*$/i,
  /^home\s*[›»>/]\s*/i,
  /^hem\s*[›»>/]\s*/i,
  /^cookie (settings|preferences|notice)/i,
  // markdown-link wrapped forms (Firecrawl emits these literally)
  /^\[\s*skip to main content[^\]]*\]\([^)]+\)\s*$/i,
  /^\[\s*skip to (content|navigation)[^\]]*\]\([^)]+\)\s*$/i,
  /^\[\s*jump (directly )?to (main )?content[^\]]*\]\([^)]+\)\s*$/i,
  /^\[\s*hoppa till (huvudinneh[åa]ll|inneh[åa]ll)[^\]]*\]\([^)]+\)\s*$/i,
  // RISE breadcrumb home link e.g. [Hem](https://www.ri.se "Hem")
  /^\[\s*hem\s*\]\([^)]+"hem"\)\s*$/i,
  /^\[\s*home\s*\]\([^)]+"home"\)\s*$/i,
];

// Standalone image-link line, e.g. [![Home](.../logo.png)](https://...)
const IMAGE_LINK_LINE = /^\s*\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\)\s*$/;

// RISE-style breadcrumb bullets, e.g. "- [Artificial intelligence](...) /"
const BREADCRUMB_BULLET = /^\s*[-*]\s+\[[^\]]+\]\([^)]+\)\s*\/\s*$/;

// Lines that look like nav menu trees: bullet links to top-level sections.
const NAV_BULLET = /^\s*[-*]\s+\[[^\]]+\]\([^)]+\)\s*$/;

// RISE expand/contract menu-tree bullets, e.g.
//   "- [Expand/contract menu item](#)" or "- [Expandera/krympa menyalternativ](...)"
const MENU_EXPAND_BULLET =
  /^\s*[-*]\s+\[[^\]]*(?:expand\/contract|expandera\/krympa)[^\]]*\]\([^)]*\)\s*$/i;

// A loose "is this a link/header bullet that's part of nav?" check used inside body
// to drop contiguous menu blocks that appear AFTER the body started.
const ANY_LINK_BULLET = /^\s*[-*]\s+\[[^\]]+\]\([^)]+\)(\s*\/)?\s*$/;
const MENU_LINE_HINT =
  /\b(expand\/contract|expandera\/krympa|close menu|st[äa]ng meny|main navigation|huvudmeny)\b/i;

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
  normalized = normalized.replace(/```\s*```/g, "");

  let lines = normalized.split("\n");

  // 2) Drop expand/contract menu bullets and Hem/Home breadcrumb lines anywhere.
  lines = lines.filter((raw) => {
    const ln = raw.trim();
    if (!ln) return true;
    if (MENU_EXPAND_BULLET.test(raw)) return false;
    if (/^\[\s*hem\s*\]\([^)]+"hem"\)\s*$/i.test(ln)) return false;
    if (/^\[\s*home\s*\]\([^)]+"home"\)\s*$/i.test(ln)) return false;
    return true;
  });

  // 3) Drop runs of contiguous nav-bullet lines that contain menu hints
  //    (e.g. Search/Sök + Menu/Meny + Close menu/Stäng meny blocks).
  lines = dropNavBlocks(lines);

  // 4) Find footer cut point
  let cut = lines.length;
  for (let i = Math.floor(lines.length * 0.4); i < lines.length; i++) {
    if (FOOTER_CUT_MARKERS.some((re) => re.test(lines[i].trim()))) {
      cut = i;
      break;
    }
  }
  let body = lines.slice(0, cut);

  // 5) Trim leading boilerplate
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

  // 6) Collapse runs of >2 blank lines
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

// Drop contiguous blocks of link-only bullet lines where at least one line in
// the block matches MENU_LINE_HINT. Preserves prose link-bullet lists (TOCs,
// research-area lists) because those don't contain "Expand/contract", "Close
// menu", etc.
function dropNavBlocks(lines: string[]): string[] {
  const out: string[] = [];
  let block: string[] = [];
  let blockHasHint = false;

  const flush = () => {
    if (block.length && !blockHasHint) {
      out.push(...block);
    }
    block = [];
    blockHasHint = false;
  };

  for (const raw of lines) {
    const ln = raw.trim();
    const isBullet = ANY_LINK_BULLET.test(raw);
    if (isBullet || ln === "") {
      // A blank line inside a nav block keeps the block alive only if the
      // next non-blank line is also a bullet.
      if (isBullet) {
        block.push(raw);
        if (MENU_LINE_HINT.test(ln)) blockHasHint = true;
      } else {
        // blank — peek behavior handled by flush at next non-bullet
        block.push(raw);
      }
    } else {
      flush();
      out.push(raw);
    }
  }
  flush();
  return out;
}
