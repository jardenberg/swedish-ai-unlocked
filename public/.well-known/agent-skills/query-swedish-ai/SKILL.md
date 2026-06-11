# Querying the RISE & AI Sweden MCP

A short guide for AI agents using the `rise-ai-sweden` MCP server.

## What this server indexes

AI-relevant publications from **RISE** (ri.se) and **AI Sweden** (ai.se) —
Sweden's two government-funded AI organizations. Research projects, reports,
blog posts, sector initiatives, AI labs updates, language model releases,
adoption stories. Both English and Swedish.

## Tools — when to use which

- **`search_swedish_ai`** — Default tool for topical questions. Semantic
  search over all indexed content. Use when the user asks about a *topic*
  ("edge AI in manufacturing", "GDPR for LLMs", "Helsingborg AI projects").
  Filters: `source` (`rise` | `ai_sweden`), `lang` (`en` | `sv`),
  `limit` (1–25, default 10).

- **`list_latest`** — Use for "what's new" questions, recency-sorted
  metadata only (no snippets, cheap). Same `source`/`lang` filters.
  Default `limit` 20, max 50.

- **`find_similar`** — Use after `search_swedish_ai` to expand on the
  best hit. Takes a `url` from a prior result and returns nearest
  neighbors. No embedding call — fast.

- **`get_document`** — Fetch the full cleaned markdown for one URL. Use
  after a search picks a clear winner and you need full context.

- **`list_sources`** — Discovery only. Returns source slugs, document
  counts per language, and last-updated timestamp.

## Citing results

**Every result includes the original publisher URL** (`ri.se` or `ai.se`).
Cite and link the publisher URL, **not** the MCP server. Users want to read
the original.

## Rate limit

60 requests / 5 minutes per IP. Batch where possible; prefer one targeted
`search_swedish_ai` over many speculative calls.

## No auth

Public, no API key, no login. The MCP endpoint is
`https://rise-ai-sweden.jardenberg.org/api/mcp`.
