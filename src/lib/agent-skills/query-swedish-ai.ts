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
