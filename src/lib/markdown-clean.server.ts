// Strip Drupal / CMS boilerplate from scraped markdown before chunking.
// Targets RISE (ri.se) and AI Sweden (ai.se) layouts but conservative enough
// to apply universally: only removes lines/blocks matching known patterns.

const HEADER_NOISE_LINES = [
  /^skip to main content\b/i,
  /^skip to (content|navigation)\b/i,
  /^main menu\b/i,
  /^toggle (navigation|menu)\b/i,
  /^search\s*$/i,
  /^menu\s*$/i,
  /^close menu\b/i,
  /^language switcher\b/i,
  /^choose language\b/i,
  /^(svenska|english)\s*\|\s*(english|svenska)/i,
  /^(en|sv)\s*\|\s*(sv|en)\s*$/i,
  /^breadcrumbs?\s*$/i,
  /^you are here:?\s*$/i,
  /^home\s*[›»>/]\s*/i,
  /^cookie (settings|preferences|notice)/i,
];

// Footer cut markers — once we hit one, drop everything after.
const FOOTER_CUT_MARKERS = [
  /^#{1,6}\s*(subscribe to (our )?newsletter|newsletter signup|sign up (for|to) (our )?newsletter)/i,
  /^#{1,6}\s*(follow us|stay (in touch|connected)|connect with us|find us on)/i,
  /^#{1,6}\s*(contact (us|information)|kontakt(a oss)?)/i,
  /^#{1,6}\s*(quick links|footer|site map|sitemap)/i,
  /^#{1,6}\s*(prenumerera|nyhetsbrev|följ oss)/i,
  /^©\s*\d{4}/,
  /^copyright\s+©?\s*\d{4}/i,
];

// Lines that look like nav menu trees: bullet links to top-level sections,
// often repeated several times in a row at top of page.
const NAV_BULLET = /^\s*[-*]\s+\[[^\]]+\]\([^)]+\)\s*$/;

export function cleanMarkdown(md: string): string {
  if (!md) return md;
  const normalized = md.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  // 1. Find footer cut point
  let cut = lines.length;
  for (let i = Math.floor(lines.length * 0.4); i < lines.length; i++) {
    if (FOOTER_CUT_MARKERS.some((re) => re.test(lines[i].trim()))) {
      cut = i;
      break;
    }
  }
  let body = lines.slice(0, cut);

  // 2. Trim leading boilerplate: drop noise lines and pure nav bullets until
  // we hit the first real heading or 3+ lines of plain prose.
  let start = 0;
  let proseRun = 0;
  for (let i = 0; i < body.length; i++) {
    const ln = body[i].trim();
    if (!ln) {
      start = i + 1;
      continue;
    }
    if (HEADER_NOISE_LINES.some((re) => re.test(ln))) {
      start = i + 1;
      proseRun = 0;
      continue;
    }
    if (NAV_BULLET.test(body[i])) {
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

  // 3. Collapse runs of >2 blank lines
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
