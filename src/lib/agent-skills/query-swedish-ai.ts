export const SKILL_MD = `# Querying the RISE & AI Sweden MCP

A short guide for AI agents using the \`rise-ai-sweden\` MCP server.

## What this server indexes

AI-relevant publications from **RISE** (ri.se) and **AI Sweden** (ai.se) —
Sweden's two government-funded AI organizations. Research projects, reports,
blog posts, sector initiatives, AI labs updates, language model releases,
adoption stories, events. Both English and Swedish.

Every document is labeled with a URL-derived \`page_type\` (\`event\`,
\`news\`, \`project\`, \`page\`). Relevance filtering is the client's job;
the server's job is honest labeling.

## Tools — when to use which

- **\`search_swedish_ai\`** — Default tool for topical questions. **Hybrid**
  (semantic + lexical) search: a vector arm for topical queries plus a
  lexical arm (Swedish/English stemming + trigram fallback) that catches
  proper nouns and short keyword queries. Reciprocal-rank-fusion merge;
  lexical arm weighted 2x when the query is ≤2 tokens. Use for *topic*
  questions ("edge AI in manufacturing", "GDPR for LLMs"). Filters:
  \`source\` (\`rise\` | \`ai_sweden\`), \`lang\` (\`en\` | \`sv\`),
  \`page_type\` (\`event\` | \`news\` | \`project\` | \`page\`),
  \`limit\` (1–50, default 20).

- **\`find_mentions\`** — Honest "everything that mentions X" primitive.
  Lexical only, no embeddings. Use for proper nouns, organization names,
  recall-style audits, or when the user asks "list every page that talks
  about Helsingborg". Returns one row per document with best snippet,
  plus a \`total\` that mirrors a direct
  \`count(DISTINCT id) WHERE raw_markdown ILIKE '%term%'\` SQL query —
  use it to sanity-check coverage. Filters: \`source\`, \`lang\`,
  \`page_type\`, \`limit\` (1–100, default 25).

- **\`list_latest\`** — "What's new" view, recency-sorted metadata only
  (no snippets, cheap). Same \`source\`/\`lang\`/\`page_type\` filters.
  Default \`limit\` 20, max 50.

- **\`find_similar\`** — Use after \`search_swedish_ai\` to expand on the
  best hit. Takes a \`url\` from a prior result and returns nearest
  neighbors. No embedding call — fast.

- **\`get_document\`** — Fetch the full cleaned markdown for one URL. Use
  after a search picks a clear winner and you need full context.

- **\`list_sources\`** — Discovery only. Returns source slugs, document
  counts per language, and last-updated timestamp.

## Heuristics

- Topical, multi-word query → \`search_swedish_ai\`.
- Bare proper noun, organization, city, or product name → \`search_swedish_ai\`
  works (hybrid handles it), but \`find_mentions\` gives complete recall and
  a reconcilable total.
- "Find every…" / "list all…" recall queries → \`find_mentions\`.
- Always pass \`page_type\` when the user explicitly wants one slice
  (e.g. "upcoming events" → \`page_type: "event"\`).

## Quirks and gotchas

- **URLs are canonicalized on input.** \`get_document\`, \`find_similar\`, and
  URL-shaped \`find_mentions\` terms are normalized (https, \`www.\` host form,
  no fragment, no tracking params, no trailing slash) before lookup — so
  \`https://ai.se/x/\` and \`https://www.ai.se/x?utm_source=y\` both resolve.
- **Offsite event redirects are excluded.** Many \`ai.se\` event pages
  301-redirect to third-party platforms (Invajo, Meetup). Those are parked as
  \`skipped_offsite\` and never indexed, so some event URLs in ai.se's sitemap
  have no document here. This is deliberate: only content served from
  \`ri.se\`/\`ai.se\` is stored.
- **Dates can be inferred.** \`publishedAt\` may come from page metadata,
  the sitemap \`lastmod\`, or a date in the URL path. Check
  \`publishedAtSource\` before treating it as authoritative.
- **Some PDFs are OCR'd.** When the in-process parser finds no text layer, the
  document is routed through Firecrawl OCR; \`extractionMethod\` and
  \`contentNote\` in \`get_document\` say so. OCR text can contain minor
  character errors.
- **A few PDFs were manually replaced** by the maintainer (oversized or corrupt
  originals). \`bytesReplacedAt\` marks those; the publisher URL is still
  canonical.
- **Short queries go literal.** \`search_swedish_ai\` weights the lexical arm
  2x for queries of ≤2 tokens. Add a word if a one-word topical query feels too
  keyword-y.
- **Freshness.** Sitemaps are re-checked daily (04:15 UTC) and changed pages
  re-scraped. \`list_sources\` reports the live last-fetch per source.

## Verification (signed responses) — spec 0.2

Every \`tools/call\` response carries a signed envelope. Everything here is
**additive** — tool data fields are unchanged.

- \`result._meta["org.jardenberg.verifiable-mcp"]\` =
  \`{ spec: "0.2", alg: "EdDSA", kid, signed: "wrapper", iat, payload_digest, jws }\`.
- The compact JWS covers a **wrapper**: \`{ iat, payload, provenance }\`, where
  \`payload\` is the tool result data (no provenance mirrored inside) and
  \`provenance\` holds \`server_operator\`, \`server\`, \`content_publisher\`,
  \`canonical_origin\`, \`publishers\`, \`legal_basis\`, \`content_hash\`,
  \`dataset_version\`, \`last_updated\`.
- Canonicalization is **RFC 8785 (JCS)** — normative for both the JWS payload
  and every digest.
- \`payload_digest\` = \`sha256:<hex>\` over the RFC 8785 canonical \`payload\`.
- **Content binding:** \`content[0].text\` IS the RFC 8785 canonical
  serialization of \`payload\`, so the bytes a model reads are the bytes signed.
- Key discovery: \`/.well-known/mcp.json\` (server card + JWKS) or the dedicated
  JWK at \`/.well-known/rise-ai-sweden-mcp-public-key.json\`
  (\`kid\` = RFC 7638 thumbprint).
- JSON-RPC **error** responses carry the same \`_meta\` envelope, with the error
  object as the wrapper payload.
- **Deprecated (removed in v0.3):** the v0.1 sibling \`result.signature\`
  (\`signed: "structuredContent"\`) and the \`provenance\` mirror inside
  \`structuredContent\` are still emitted for existing clients.

Verify in three steps:

1. Fetch \`/.well-known/mcp.json\` and pick the JWK whose \`kid\` matches
   \`_meta["org.jardenberg.verifiable-mcp"].kid\`.
2. Verify the compact JWS with EdDSA (\`jose\` in JS, \`python-jose\` / \`PyJWT\`
   in Python). The verified payload is the JCS-canonical wrapper.
3. Check \`JSON.parse(wrapper).payload\` JCS-canonicalizes to exactly
   \`content[0].text\`, and that its SHA-256 equals \`payload_digest\`.

Content is published by RISE and AI Sweden and remains © its publisher; this
server indexes it under the EU TDM exception (DSM art. 3-4) and claims no
licence over it. If the signing key is unavailable, responses are served
unsigned — signing never blocks a query.

## Citing results

**Every result includes the original publisher URL** (\`ri.se\` or \`ai.se\`).
Cite and link the publisher URL, **not** the MCP server. Users want to read
the original.

## Rate limit

60 requests / 5 minutes per IP. Batch where possible; prefer one targeted
\`search_swedish_ai\` or \`find_mentions\` over many speculative calls.

## No auth

Public, no API key, no login. The MCP endpoint is
\`https://rise-ai-sweden.jardenberg.org/api/mcp\`.
`;
