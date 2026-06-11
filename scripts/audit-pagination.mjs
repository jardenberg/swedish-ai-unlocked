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
  // Match `.from("documents")` or `.from("chunks")` followed within ~600 chars
  // by `.select(` — then check if the same chain has a bounding clause.
  const re = /\.from\(\s*["'](documents|chunks)["']\s*\)([\s\S]{0,600}?)\.select\(([\s\S]{0,200}?)\)([\s\S]{0,400})/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const [whole, table, before, selectArgs, after] = m;
    const isCountHead = /count:\s*["']exact["']/.test(selectArgs) && /head:\s*true/.test(selectArgs);
    const hasLimit = /\.limit\s*\(/.test(after) || /\.limit\s*\(/.test(before);
    const hasRange = /\.range\s*\(/.test(after);
    const hasSingle = /\.(single|maybeSingle)\s*\(/.test(after);
    const isFetchAllPages = new RegExp("fetchAllPages\\b").test(src.slice(Math.max(0, m.index - 400), m.index));
    if (isCountHead || hasLimit || hasRange || hasSingle || isFetchAllPages) continue;
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
