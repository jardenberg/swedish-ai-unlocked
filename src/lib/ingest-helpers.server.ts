// Shared server-only helpers for ingest + observability.
// Keeps count-query and pagination logic in one place so the 1k PostgREST
// cap can't reappear silently. Every numeric metric in the admin must come
// through here (count head queries) or be derived from sums of these counts.
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySb = SupabaseClient<any, any, any>;

export interface DocCounts {
  pending: number;
  scraped: number;
  embedded: number;
  failed: number;
  hidden: number;
  skipped_offsite: number;
  parked_unscrapable: number;
}

const STATUSES = [
  "pending",
  "scraped",
  "embedded",
  "failed",
  "skipped_offsite",
  "parked_unscrapable",
] as const;

export async function countBySource(sb: AnySb, sourceId: string): Promise<DocCounts> {
  const c: DocCounts = {
    pending: 0,
    scraped: 0,
    embedded: 0,
    failed: 0,
    hidden: 0,
    skipped_offsite: 0,
    parked_unscrapable: 0,
  };
  await Promise.all(
    STATUSES.map(async (st) => {
      const { count } = await sb
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("source_id", sourceId)
        .eq("status", st)
        .eq("hidden", false);
      c[st] = count ?? 0;
    }),
  );
  const { count: hiddenCount } = await sb
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("source_id", sourceId)
    .eq("hidden", true);
  c.hidden = hiddenCount ?? 0;
  return c;
}

export async function countChunksBySource(sb: AnySb, sourceId: string): Promise<number> {
  // chunks have no source_id; join via documents inner-select.
  const { count } = await sb
    .from("chunks")
    .select("id, documents!inner(source_id)", { count: "exact", head: true })
    .eq("documents.source_id", sourceId);
  return count ?? 0;
}

// Paginated select that bypasses the PostgREST 1k row cap. Use whenever
// you actually need rows (not counts) from documents/chunks at scale.
export async function fetchAllPages<T>(
  build: (
    from: number,
    to: number,
  ) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
  }
  return out;
}

// Write a corpus_snapshots row for one source. Best-effort — never throw.
export async function snapshotCorpusForSource(sb: AnySb, sourceId: string): Promise<void> {
  try {
    const counts = await countBySource(sb, sourceId);
    const chunks = await countChunksBySource(sb, sourceId);
    await sb.from("corpus_snapshots").insert({
      source_id: sourceId,
      embedded: counts.embedded,
      chunks,
      pending: counts.pending,
      scraped: counts.scraped,
      failed: counts.failed,
      hidden: counts.hidden,
    });
  } catch (e) {
    console.warn("[snapshot] failed for source", sourceId, (e as Error).message);
  }
}

export async function snapshotAllSources(sb: AnySb): Promise<void> {
  try {
    const { data: sources } = await sb.from("sources").select("id");
    await Promise.all(
      (sources ?? []).map((s: { id: string }) => snapshotCorpusForSource(sb, s.id)),
    );
  } catch (e) {
    console.warn("[snapshot] all-sources failed", (e as Error).message);
  }
}
