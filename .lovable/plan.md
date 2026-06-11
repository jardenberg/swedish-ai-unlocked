
# Agent-readiness pass (app-level only)

Six small additions, in the order you specified. All TanStack app code, no Cloudflare config.

## 1. `public/robots.txt` — Content-Signal

Append one line above the `Sitemap:` directive:

```
Content-Signal: ai-train=yes, search=yes, ai-input=yes
```

Keep the existing `facebookexternalhit`, `Facebot`, and `*` allow blocks intact.

## 2. MCP Server Card — `src/routes/.well-known/mcp/server-card[.]json.ts`

New TanStack server route returning static JSON with `Content-Type: application/json` and `Cache-Control: public, max-age=3600`. GET only; other methods → 405.

Payload (single source of truth for `VERSION` imported from a tiny shared constant so the landing page and server card stay in sync; new file `src/lib/build-version.ts`):

```json
{
  "$schemaNote": "Tracks MCP SEP-1649 server-card draft (revision 2025-05); update as the spec lands.",
  "serverInfo": {
    "name": "rise-ai-sweden",
    "version": "v202606102145",
    "title": "RISE & AI Sweden Public MCP"
  },
  "transport": {
    "type": "streamable-http",
    "endpoint": "https://rise-ai-sweden.jardenberg.org/api/mcp"
  },
  "authentication": { "type": "none", "note": "Public, no auth, no API key. Rate limited to 60 req / 5 min per IP." },
  "capabilities": {
    "tools": [
      { "name": "search_swedish_ai", "description": "Semantic search across RISE and AI Sweden publications (sv/en)." },
      { "name": "list_latest", "description": "Newest documents across both sources; lightweight metadata only." },
      { "name": "find_similar", "description": "Given an indexed URL, return semantically nearest other documents." },
      { "name": "get_document", "description": "Full cleaned markdown for a single indexed URL." },
      { "name": "list_sources", "description": "Sources covered, document counts, language breakdown, last-updated." }
    ]
  },
  "documentation": "https://rise-ai-sweden.jardenberg.org/",
  "contact": { "email": "joakim@jardenberg.com" }
}
```

Refactor `src/routes/index.tsx` to import `VERSION` from the new shared file.

## 3. `/llms.txt` — `src/routes/llms[.]txt.ts`

TanStack server route returning `text/plain; charset=utf-8`. Static markdown body, compressed landing page for agent readers:

- H1 + one-line blockquote summary
- What it is, who runs it (RISE + AI Sweden, built by Joakim Jardenberg)
- MCP endpoint URL + "no auth"
- `## Tools` — the five tools with one-liners
- `## Rate limit` — 60 req / 5 min per IP
- `## Sources` — RISE and AI Sweden, with live corpus counts fetched at request time via `supabaseAdmin` (same query shape as `list_sources` tool, just rendered as markdown). Short cache header (`max-age=600`).
- `## Links` — canonical landing page, server card, agent-skills index

## 4. Link header on `/`

Add a `loader` to `src/routes/index.tsx` (or a tiny `beforeLoad`) that calls `setResponseHeader` from `@tanstack/react-start/server`:

```
Link: </.well-known/mcp/server-card.json>; rel="service-desc", </llms.txt>; rel="describedby"
```

The loader will be a no-op data-wise (`return null`) — purely for the header side effect. Safe on the public `/` route (no auth middleware, runs at SSR).

## 5. Agent-skills — two new server routes

**`src/routes/.well-known/agent-skills/index[.]json.ts`** returns JSON per Cloudflare agent-skills RFC v0.2.0:

```json
{
  "$schema": "https://agent-skills.cloudflare.com/schema/v0.2.0.json",
  "skills": [
    {
      "name": "query-swedish-ai",
      "type": "markdown",
      "description": "How to query the RISE & AI Sweden MCP effectively.",
      "url": "https://rise-ai-sweden.jardenberg.org/.well-known/agent-skills/query-swedish-ai/SKILL.md",
      "sha256": "<computed at request time>"
    }
  ]
}
```

`sha256` is computed at request time from the SKILL.md string constant (both files import the same `SKILL_MD` constant from `src/lib/agent-skills/query-swedish-ai.ts`) so the hash can never drift from the served content. Uses Web Crypto `crypto.subtle.digest('SHA-256', ...)` — Worker-safe.

**`src/routes/.well-known/agent-skills/query-swedish-ai/SKILL[.]md.ts`** returns the same `SKILL_MD` string as `text/markdown; charset=utf-8`. Content covers:

- When to use `search_swedish_ai` (semantic query) vs `list_latest` (freshness) vs `find_similar` (more-like-this)
- `lang` and `source` filter values
- That `get_document` returns full cleaned markdown for a single URL
- That every result includes the original publisher URL — agents should cite/link those, not the MCP
- Rate limit reminder

## 6. `/.well-known/*` returns clean 404 instead of 500

Currently any unmatched `/.well-known/*` path 500s (caught by the scanner on `/api-catalog`). Add a splat fallback:

**`src/routes/.well-known/$.ts`** — server route at `/.well-known/$` whose GET handler returns `new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } })`. TanStack matches more specific routes first, so this only fires for unmatched paths.

(If the existing 500 turns out to come from somewhere other than a missing route — e.g. a thrown error in `__root` for unmatched server paths — I'll trace it during implementation and fix at the actual source. The splat route is the expected fix.)

## File list

New:
- `src/lib/build-version.ts` (shared `VERSION` constant)
- `src/lib/agent-skills/query-swedish-ai.ts` (shared `SKILL_MD` string)
- `src/routes/.well-known/mcp/server-card[.]json.ts`
- `src/routes/.well-known/agent-skills/index[.]json.ts`
- `src/routes/.well-known/agent-skills/query-swedish-ai/SKILL[.]md.ts`
- `src/routes/.well-known/$.ts`
- `src/routes/llms[.]txt.ts`

Edited:
- `public/robots.txt` (one line)
- `src/routes/index.tsx` (import `VERSION`, add loader that sets Link header)

## Verification

After implementation, from the published URL:

1. `curl -I https://rise-ai-sweden.jardenberg.org/` — assert Link header present
2. `curl -i` each of: `/.well-known/mcp/server-card.json`, `/llms.txt`, `/.well-known/agent-skills/index.json`, `/.well-known/agent-skills/query-swedish-ai/SKILL.md` — assert 200 + correct content-type
3. `curl -i https://rise-ai-sweden.jardenberg.org/.well-known/nonsense` — assert 404
4. `sha256sum` the served SKILL.md, compare to the `sha256` field in the served index.json
5. POST to `https://isitagentready.com/api/scan` and report the score delta

## Out of scope (explicit)

API catalog, OAuth/PRM/auth.md, WebMCP, DNS-AID — skipped per your call.
