import { canonicalJson, sha256Hex } from "./signing.server";

export const SERVER_OPERATOR = "Studio Jardenberg";
export const SERVER_HOST = "rise-ai-sweden.jardenberg.org";
export const LEGAL_BASIS =
  "EU TDM exception (DSM art. 3-4); all content remains © its publisher";

const PUBLISHERS: Record<string, { publisher: string; canonical_origin: string }> = {
  rise: { publisher: "RISE", canonical_origin: "https://www.ri.se" },
  ai_sweden: { publisher: "AI Sweden", canonical_origin: "https://www.ai.se" },
};

type Fingerprint = { dataset_version: string; last_updated: string | null };

let cached: { at: number; value: Fingerprint } | null = null;
const TTL_MS = 60_000;

async function loadFingerprint(): Promise<Fingerprint> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [{ count }, latestDoc, latestSnap] = await Promise.all([
    supabaseAdmin
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("status", "embedded")
      .eq("hidden", false),
    supabaseAdmin
      .from("documents")
      .select("fetched_at")
      .eq("status", "embedded")
      .eq("hidden", false)
      .order("fetched_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("corpus_snapshots")
      .select("captured_at")
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const lastUpdated =
    (latestDoc.data?.fetched_at as string | null) ??
    (latestSnap.data?.captured_at as string | null) ??
    null;
  const stamp = (latestSnap.data?.captured_at as string | null) ?? lastUpdated;
  const day = stamp ? stamp.slice(0, 10).replace(/-/g, "") : "00000000";
  return { dataset_version: `d${day}.${count ?? 0}`, last_updated: lastUpdated };
}

export async function getFingerprint(): Promise<Fingerprint> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.value;
  try {
    const value = await loadFingerprint();
    cached = { at: now, value };
    return value;
  } catch {
    return cached?.value ?? { dataset_version: "unknown", last_updated: null };
  }
}

/** Collect the source slugs referenced anywhere in a tool payload. */
export function collectSources(payload: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if ((k === "source" || k === "slug") && typeof val === "string" && PUBLISHERS[val]) {
          found.add(val);
        }
        walk(val);
      }
    }
  };
  walk(payload);
  return [...found].sort();
}

export type Provenance = Record<string, unknown>;

/**
 * Build the additive provenance block for a tool payload.
 * content_hash is SHA-256 over the canonical (sorted-keys, UTF-8) JSON of the
 * payload WITHOUT the provenance block itself — i.e. the result items as returned.
 */
export async function buildProvenance(payloadWithoutProvenance: unknown): Promise<Provenance> {
  const slugs = collectSources(payloadWithoutProvenance);
  const fingerprint = await getFingerprint();
  const content_hash = await sha256Hex(canonicalJson(payloadWithoutProvenance));

  const publishers = (slugs.length ? slugs : Object.keys(PUBLISHERS).sort()).map((slug) => ({
    source: slug,
    content_publisher: PUBLISHERS[slug].publisher,
    canonical_origin: PUBLISHERS[slug].canonical_origin,
  }));

  return {
    server_operator: SERVER_OPERATOR,
    server: SERVER_HOST,
    content_publisher:
      slugs.length === 1 ? PUBLISHERS[slugs[0]].publisher : publishers.map((p) => p.content_publisher),
    canonical_origin:
      slugs.length === 1 ? PUBLISHERS[slugs[0]].canonical_origin : publishers.map((p) => p.canonical_origin),
    publishers,
    legal_basis: LEGAL_BASIS,
    content_hash,
    content_hash_alg: "sha256",
    content_hash_scope:
      "SHA-256 over the canonical (sorted-keys, UTF-8, no whitespace) JSON of this response object with the `provenance` key removed",
    dataset_version: fingerprint.dataset_version,
    last_updated: fingerprint.last_updated,
  };
}
