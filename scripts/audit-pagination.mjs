#!/usr/bin/env node
// Pagination audit: every documents/chunks .select() must be bounded by a
// count head query, an explicit .limit / .range, .single / .maybeSingle,
// OR call through fetchAllPages. Unbounded .select() silently truncates at
// PostgREST's default 1000-row cap and produces wrong numbers.
//
// Run: node scripts/audit-pagination.mjs
// Exits non-zero on violations.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");

const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(entry)) audit(p);
  }
}

function audit(file) {
  const src = readFileSync(file, "utf8");
  const re = /\.from\(\s*["'](documents|chunks)["']\s*\)([\s\S]{0,1200}?)\.select\(([\s\S]{0,400}?)\)([\s\S]{0,600})/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const [whole, table, before, , after] = m;
    const window = whole;
    const isCountHead = /count:\s*["']exact["']/.test(window) && /head:\s*true/.test(window);
    const hasLimit = /\.limit\s*\(/.test(after) || /\.limit\s*\(/.test(before);
    const hasRange = /\.range\s*\(/.test(after);
    const hasSingle = /\.(single|maybeSingle)\s*\(/.test(after);
    // `.in("col", arr)` is implicitly bounded by the array the caller passes.
    const hasIn = /\.in\s*\(\s*["'][^"']+["']\s*,/.test(after);
    const isFetchAllPages = /fetchAllPages\b/.test(src.slice(Math.max(0, m.index - 400), m.index));
    if (isCountHead || hasLimit || hasRange || hasSingle || hasIn || isFetchAllPages) continue;
    const line = src.slice(0, m.index).split("\n").length;
    violations.push({ file: relative(ROOT, file), line, table, snippet: whole.split("\n").slice(0, 3).join(" ⏎ ").slice(0, 240) });
  }
}

walk(SRC);

if (violations.length === 0) {
  console.log("✓ pagination audit clean — every documents/chunks .select() is bounded");
  process.exit(0);
}
console.error(`✗ pagination audit found ${violations.length} unbounded .select() on documents/chunks:`);
for (const v of violations) console.error(`  ${v.file}:${v.line}  [${v.table}]  ${v.snippet}`);
console.error("\nFix: add count head, .limit(...), .range(...), .single()/.maybeSingle(), or route through fetchAllPages().");
process.exit(1);
