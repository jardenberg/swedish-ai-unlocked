// Canonicalize URLs at ingest time so the unique(url) constraint actually dedupes
// host variants (ai.se vs www.ai.se), trailing slashes, fragments, and tracking
// query params. Path case is preserved (Drupal slugs can be case-sensitive).

const HOST_ALIASES: Record<string, string> = {
  "ai.se": "www.ai.se",
};

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_(cid|eid)$|ref$)/i;

export function canonicalizeUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return input.trim();
  }
  u.protocol = u.protocol === "http:" ? "https:" : u.protocol;
  u.hostname = (HOST_ALIASES[u.hostname.toLowerCase()] ?? u.hostname).toLowerCase();
  u.hash = "";
  // Strip tracking params
  const keep: [string, string][] = [];
  for (const [k, v] of u.searchParams) {
    if (!TRACKING_PARAMS.test(k)) keep.push([k, v]);
  }
  u.search = "";
  keep.sort(([a], [b]) => a.localeCompare(b));
  for (const [k, v] of keep) u.searchParams.append(k, v);
  // Trim trailing slash (but keep root "/")
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "");
  }
  // Drop default ports
  if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) {
    u.port = "";
  }
  let out = u.toString();
  if (out.endsWith("/") && u.pathname === "/") out = out.slice(0, -1);
  return out;
}
