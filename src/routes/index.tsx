import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";

import { publicStats } from "@/lib/ingest.functions";
import { VERSION, PUBLISHED, MCP_ENDPOINT as MCP_URL, MCP_NAME } from "@/lib/build-version";

const PAGE_TITLE = "RISE & AI Sweden — Public MCP Server";

const setLinkHeader = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { setResponseHeader } = await import("@tanstack/react-start/server");
    setResponseHeader(
      "Link",
      '</.well-known/mcp/server-card.json>; rel="service-desc", </llms.txt>; rel="describedby"',
    );
  } catch {
    // not in a server request context (e.g. prerender) — ignore
  }
  return null;
});

const statsQuery = queryOptions({
  queryKey: ["public-stats"],
  queryFn: () => publicStats(),
});

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    await Promise.all([
      setLinkHeader(),
      context.queryClient.ensureQueryData(statsQuery),
    ]);
    return null;
  },


  head: () => ({
    meta: [
      { title: PAGE_TITLE },
      {
        name: "description",
        content:
          "A public, no-auth MCP server indexing AI-relevant publications from RISE and AI Sweden. Plug into Claude, Cursor, ChatGPT, or any MCP-compatible assistant.",
      },
      { property: "og:title", content: PAGE_TITLE },
      {
        property: "og:description",
        content:
          "Semantic search over the open publications of RISE and AI Sweden, provided in good faith to support the agentic AI ecosystem.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { data } = useSuspenseQuery(statsQuery);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-6 py-16">
        {/* ── Top: normie-friendly ───────────────────────────────── */}
        <header>
          <h1 className="text-5xl font-semibold tracking-tight">
            RISE &amp; AI Sweden — Public MCP
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            A public MCP server that indexes AI-relevant publications from{" "}
            <a href="https://www.ri.se" className="underline underline-offset-4">RISE</a>{" "}
            and{" "}
            <a href="https://www.ai.se" className="underline underline-offset-4">AI Sweden</a> —
            Sweden's two government-funded AI organizations. Provided in good faith to
            support the growth of the agentic AI ecosystem.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="rounded bg-muted px-2 py-0.5 font-mono">{VERSION}</span>
            <span>Published {PUBLISHED}</span>
            <span>·</span>
            <span>Developing version, constantly in progress</span>
          </div>
        </header>

        {/* ── The one thing most people need ─────────────────────── */}
        <section className="mt-10 rounded-lg border bg-card p-6">
          <h2 className="text-xl font-semibold">Add it to your AI assistant</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            In most modern MCP-compatible tools, this URL is all you need. No login,
            no API key, no authentication.
          </p>

          <div className="mt-4 space-y-3">
            <Field label="Server URL" value={MCP_URL} />
            <Field label="Suggested name" value={MCP_NAME} />
            <Field label="Authentication" value="None" />
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <Stat label="Documents indexed" value={data?.documents ?? 0} />
            <Stat label="Searchable chunks" value={data?.chunks ?? 0} />
          </div>
        </section>

        {/* ── Where to paste it in popular tools ────────────────── */}
        <section className="mt-10">
          <h2 className="text-xl font-semibold">Where to add it</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            These menus change often — if something looks different, search the app's
            settings for &ldquo;MCP&rdquo;.
          </p>

          <div className="mt-4 space-y-4 text-sm">
            <Tool name="Claude Desktop">
              Settings → Developer → Edit Config, then add an entry under{" "}
              <code className="rounded bg-muted px-1">mcpServers</code> with the URL
              above.
            </Tool>
            <Tool name="Claude.ai (web)">
              Customize → Connectors → + → Add custom connector → paste the URL.
            </Tool>
            <Tool name="ChatGPT (Pro/Team)">
              Settings → Connectors → Add → MCP server → paste the URL.
            </Tool>
            <Tool name="Cursor">
              Settings → MCP → Add new server → paste the URL.
            </Tool>
            <Tool name="Codex CLI / others">
              Add an entry to your <code className="rounded bg-muted px-1">mcpServers</code>{" "}
              config pointing at the URL.
            </Tool>
          </div>
        </section>

        {/* ── How to use it in a chat ────────────────────────────── */}
        <section className="mt-10">
          <h2 className="text-xl font-semibold">How to use it in a chat</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Once added, just mention the name in your prompt. For example:
          </p>
          <blockquote className="mt-3 rounded-md border-l-4 border-primary bg-muted/40 p-4 text-sm italic">
            &ldquo;Use <strong>{MCP_NAME}</strong> to give me the most important
            content related to Helsingborg.&rdquo;
          </blockquote>
        </section>

        {/* ── Geekier: JSON config ──────────────────────────────── */}
        <section className="mt-12">
          <h2 className="text-xl font-semibold">JSON config (for tools that need it)</h2>
          <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-4 text-sm">
{`{
  "mcpServers": {
    "${MCP_NAME}": {
      "transport": { "type": "http", "url": "${MCP_URL}" }
    }
  }
}`}
          </pre>
          <p className="mt-2 text-xs text-muted-foreground">
            Rate limit: 60 requests / 5 minutes per IP.
          </p>
        </section>

        {/* ── Tools + sample responses ──────────────────────────── */}
        <section className="mt-12">
          <h2 className="text-xl font-semibold">Tools exposed</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Six tools, each returning JSON. Most accept a{" "}
            <code className="rounded bg-muted px-1">page_type</code> filter
            (<code className="rounded bg-muted px-1">event</code> ·{" "}
            <code className="rounded bg-muted px-1">news</code> ·{" "}
            <code className="rounded bg-muted px-1">project</code> ·{" "}
            <code className="rounded bg-muted px-1">page</code>). Examples below show the actual shape your
            assistant receives.
          </p>

          <div className="mt-6 space-y-8">
            <ToolDoc
              name="search_swedish_ai"
              summary="Hybrid (semantic + lexical) search across all indexed RISE and AI Sweden content. Vector arm for topical queries; lexical arm (Swedish/English stemming + trigram fallback) for proper nouns and short keyword queries. Reciprocal-rank-fusion merge; lexical weighted 2x when query is ≤2 tokens."
              params={`{
  query: string,                                     // 2–500 chars
  source?:    "rise" | "ai_sweden",
  lang?:      "en" | "sv",
  page_type?: "event" | "news" | "project" | "page",
  limit?:     number                                 // 1–50, default 20
}`}
              example={`{
  "query": "Helsingborg",
  "count": 2,
  "hybrid": { "rrfK": 60, "weights": { "vector": 1, "lexical": 2 }, "tokenCount": 1 },
  "results": [
    {
      "url": "https://www.ai.se/en/sector-initiatives-projects/.../national-city-lab",
      "title": "National City Lab",
      "source": "ai_sweden",
      "sourceName": "AI Sweden",
      "lang": "en",
      "pageType": "project",
      "score": 0.0312,
      "arms": { "vector": 0.4912, "lexical": 0.0821 },
      "snippet": "The National City Lab in Helsingborg...",
      "fetchedAt": "2026-06-10T08:14:22Z"
    },
    { "...": "..." }
  ]
}`}
            />

            <ToolDoc
              name="find_mentions"
              summary="Lexical 'everything that mentions X' primitive. No embeddings — stemmed tsquery + exact-substring fallback. Includes a total field that mirrors a direct count(DISTINCT id) WHERE raw_markdown ILIKE '%term%' SQL query."
              params={`{
  term: string,                                      // 1–200 chars
  source?:    "rise" | "ai_sweden",
  lang?:      "en" | "sv",
  page_type?: "event" | "news" | "project" | "page",
  limit?:     number                                 // 1–100, default 25
}`}
              example={`{
  "term": "Helsingborg",
  "total": 39,
  "totalNote": "Exact-substring document count (ILIKE) matching the same filters. Reconciles with raw SQL.",
  "returned": 25,
  "results": [
    {
      "url": "https://www.ai.se/en/news/helsingborg-opens-national-city-lab",
      "title": "Helsingborg opens the National City Lab",
      "source": "ai_sweden",
      "sourceName": "AI Sweden",
      "lang": "en",
      "pageType": "news",
      "matchMode": "exact",
      "rank": 0.0912,
      "snippet": "Helsingborg opens the National City Lab...",
      "fetchedAt": "2026-06-09T07:32:10Z"
    },
    { "...": "..." }
  ]
}`}
            />

            <ToolDoc
              name="list_latest"
              summary="Cheap 'what's new' view. Without arguments, returns the newest documents across both sources. Pass source / page_type to slice. No snippets — lightweight metadata only."
              params={`{
  source?:    "rise" | "ai_sweden",
  lang?:      "en" | "sv",
  page_type?: "event" | "news" | "project" | "page",
  limit?:     number                                 // 1–50, default 20
}`}
              example={`{
  "count": 2,
  "results": [
    {
      "url": "https://www.ai.se/en/news/...",
      "title": "New language model release",
      "source": "ai_sweden",
      "sourceName": "AI Sweden",
      "lang": "en",
      "pageType": "news",
      "publishedAt": "2026-06-09T00:00:00Z",
      "publishedAtSource": "meta",
      "sitemapLastmod": "2026-06-09T00:00:00Z",
      "fetchedAt": "2026-06-10T08:14:22Z"
    },
    { "...": "..." }
  ]
}`}
            />

            <ToolDoc
              name="find_similar"
              summary="Given a URL already in the index, return semantically nearest other documents. Uses the seed document's centroid embedding (average of all its chunks) so navigation chrome doesn't dominate matches. Great for 'more like this' after picking a hit. URLs are canonicalized on input, so bare-host, trailing-slash, and tracking-param variants all resolve."
              params={`{
  url: string,             // a URL from search_swedish_ai / list_latest
  source?: "rise" | "ai_sweden",
  lang?:   "en" | "sv",
  limit?:  number          // 1–25, default 10
}`}
              example={`{
  "seedUrl": "https://www.ri.se/en/what-we-do/projects/edge-ai-...",
  "count": 2,
  "results": [
    {
      "url": "https://www.ri.se/en/what-we-do/projects/tinyml-...",
      "title": "TinyML for industrial sensors",
      "source": "rise",
      "sourceName": "RISE",
      "lang": "en",
      "score": 0.7912,
      "snippet": "Running compact ML models on microcontrollers...",
      "fetchedAt": "2026-06-07T11:02:08Z"
    },
    { "...": "..." }
  ]
}`}
            />

            <ToolDoc
              name="get_document"
              summary="Fetch full cleaned markdown for a single indexed URL. Use after search_swedish_ai to load complete context on the best hit. Body is capped at 80 000 chars — check `truncated` before assuming you have the whole document. `contentNote` / `extractionMethod` surface provenance (e.g. Firecrawl OCR for image-only PDFs, manually replaced stored copies)."
              params={`{ url: string }`}
              example={`{
  "url": "https://www.ai.se/en/project/...",
  "title": "Project title",
  "lang": "en",
  "pageType": "project",
  "contentType": "html",
  "source": "ai_sweden",
  "sourceName": "AI Sweden",
  "publishedAt": "2026-05-14T00:00:00Z",
  "publishedAtSource": "meta",
  "fetchedAt": "2026-06-08T09:01:44Z",
  "bytesReplacedAt": null,
  "extractionMethod": null,
  "contentNote": null,
  "content": "# Project title\\n\\nFull markdown body...",
  "truncated": false
}`}
            />

            <ToolDoc
              name="list_sources"
              summary="Discover scope and freshness: which sources are indexed, document counts, language breakdown, and the most recent fetch per source."
              params={`{}`}
              example={`{
  "sources": [
    {
      "slug": "rise",
      "name": "RISE",
      "rootUrl": "https://www.ri.se",
      "documents": 412,
      "languages": { "en": 280, "sv": 132 },
      "lastUpdated": "2026-06-10T08:14:22Z"
    },
    {
      "slug": "ai_sweden",
      "name": "AI Sweden",
      "rootUrl": "https://www.ai.se",
      "documents": 388,
      "languages": { "en": 250, "sv": 138 },
      "lastUpdated": "2026-06-10T07:55:01Z"
    }
  ]
}`}
            />
          </div>
        </section>

        {/* ── Trust & verification ───────────────────────────────── */}
        <section className="mt-12">
          <h2 className="text-xl font-semibold">Trust &amp; verification</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Every <code className="rounded bg-muted px-1">tools/call</code> response is
            cryptographically signed and carries a provenance block. This is a working
            pilot of verifiable MCP responses — in the spirit of C2PA content credentials,
            but for tool output. No MCP client verifies these signatures automatically
            yet; the point is that you <em>can</em>, today, with any standard JOSE library.
          </p>

          <h3 className="mt-6 font-medium">What is signed</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Scope: the response's{" "}
              <code className="rounded bg-muted px-1">structuredContent</code> — the same
              JSON object as the text arm, including its{" "}
              <code className="rounded bg-muted px-1">provenance</code> block.
            </li>
            <li>
              Algorithm: <strong>EdDSA (Ed25519)</strong>, compact JWS, attached as a
              sibling <code className="rounded bg-muted px-1">signature</code> object:{" "}
              <code className="rounded bg-muted px-1">
                {`{ alg, kid, signed: "structuredContent", jws }`}
              </code>
              .
            </li>
            <li>
              Canonicalization: JSON with lexicographically sorted object keys, UTF-8, no
              insignificant whitespace.
            </li>
            <li>
              Public key (JWK, with <code className="rounded bg-muted px-1">kid</code> =
              RFC 7638 thumbprint):{" "}
              <a
                href="/.well-known/rise-ai-sweden-mcp-public-key.json"
                className="underline underline-offset-4 hover:text-foreground"
              >
                /.well-known/rise-ai-sweden-mcp-public-key.json
              </a>
            </li>
            <li>
              Provenance per response: operator, content publisher(s) and their canonical
              origins, legal basis, a SHA-256{" "}
              <code className="rounded bg-muted px-1">content_hash</code>,{" "}
              <code className="rounded bg-muted px-1">dataset_version</code> and{" "}
              <code className="rounded bg-muted px-1">last_updated</code>. Content is
              published by RISE and AI Sweden and remains © its publisher — indexing rests
              on the EU TDM exception (DSM art. 3–4). This server claims no licence over it.
            </li>
          </ul>

          <h3 className="mt-6 font-medium">Verify it yourself — three steps</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Fetch the JWK from{" "}
              <code className="rounded bg-muted px-1">
                /.well-known/rise-ai-sweden-mcp-public-key.json
              </code>{" "}
              and check that its <code className="rounded bg-muted px-1">kid</code> matches
              the one in the response signature.
            </li>
            <li>
              Split the compact JWS (
              <code className="rounded bg-muted px-1">header.payload.signature</code>) and
              verify it with EdDSA — <code className="rounded bg-muted px-1">jose</code>{" "}
              (JS) or <code className="rounded bg-muted px-1">python-jose</code> / {""}
              <code className="rounded bg-muted px-1">PyJWT</code> (Python).
            </li>
            <li>
              Re-canonicalize the response's{" "}
              <code className="rounded bg-muted px-1">structuredContent</code> (sorted
              keys, UTF-8) and confirm it is byte-identical to the verified JWS payload.
              Then drop the <code className="rounded bg-muted px-1">provenance</code> key,
              canonicalize the rest, and SHA-256 it — that reproduces{" "}
              <code className="rounded bg-muted px-1">provenance.content_hash</code>.
            </li>
          </ol>

          <div className="mt-4">
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{`// Node — npm i jose
import { compactVerify, importJWK } from "jose";

const canon = (v) => JSON.stringify(sort(v));
const sort = (v) =>
  Array.isArray(v) ? v.map(sort)
  : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]))
    : v;

const jwk = await (await fetch(
  "${SITE}/.well-known/rise-ai-sweden-mcp-public-key.json"
)).json();
const key = await importJWK({ kty: jwk.kty, crv: jwk.crv, x: jwk.x }, "EdDSA");

const { result } = mcpResponse;                       // one tools/call result
const { payload } = await compactVerify(result.signature.jws, key);
console.log(new TextDecoder().decode(payload) === canon(result.structuredContent));`}</pre>
          </div>

          <p className="mt-3 text-sm text-muted-foreground">
            If the signing key is ever unavailable, responses are served unsigned — signing
            never blocks a query. Data fields are unchanged by this layer; signature and
            provenance are purely additive.
          </p>
        </section>

        {/* ── FAQ ────────────────────────────────────────────────── */}
        <section className="mt-12">

          <h2 className="text-xl font-semibold">FAQ</h2>
          <dl className="mt-4 space-y-5 text-sm">
            <Faq q="Is this open source?">
              Yes — code lives at{" "}
              <a
                href="https://github.com/jardenberg/swedish-ai-unlocked"
                className="underline underline-offset-4 hover:text-foreground"
              >
                github.com/jardenberg/swedish-ai-unlocked
              </a>
              . Issues and PRs welcome.
            </Faq>
            <Faq q="Do I need an API key?">
              No. Public endpoint, no auth. Rate limit: 60 requests / 5 minutes per IP.
            </Faq>
            <Faq q="What's indexed?">
              Public web pages and PDFs from ri.se and ai.se. No paywalled or internal
              content. Use <code className="rounded bg-muted px-1">list_sources</code> for
              current counts and the most recent fetch per source.
            </Faq>
            <Faq q="How fresh is it?">
              Sitemaps are re-checked automatically every day at 04:15 UTC. New and
              changed documents are scraped, cleaned, chunked, and embedded in the same
              pass.{" "}
              {data?.lastRefresh ? (
                <>
                  Last completed refresh:{" "}
                  <strong>
                    {new Date(data.lastRefresh).toISOString().replace("T", " ").slice(0, 16)} UTC
                  </strong>
                  .
                </>
              ) : null}{" "}
              <code className="rounded bg-muted px-1">list_sources</code> always reports the
              live per-source last-fetch timestamps.
            </Faq>
            <Faq q="Why does find_mentions return fewer rows than `total`?">
              <code className="rounded bg-muted px-1">total</code> is a reconciliation
              count — distinct documents whose markdown contains the exact substring,
              matching a direct SQL <code className="rounded bg-muted px-1">ILIKE</code>{" "}
              query. <code className="rounded bg-muted px-1">returned</code> is what the
              tool hands back, capped by <code className="rounded bg-muted px-1">limit</code>{" "}
              (max 100).
            </Faq>
            <Faq q="Why doesn't my AI Sweden event URL show up?">
              Many ai.se event pages 301-redirect to third-party sites (Invajo, Meetup,
              etc.). Those are deliberately skipped — the index only stores content served
              from ri.se and ai.se themselves.
            </Faq>
            <Faq q="How short-query search works">
              For queries of ≤2 tokens, the lexical arm is weighted 2× over the vector
              arm. Good for proper nouns and organization names; if a one-word topical
              query feels too literal, add a second word.
            </Faq>
            <Faq q="Can I trust the dates?">
              <code className="rounded bg-muted px-1">publishedAt</code> comes from page
              metadata or PDF path when available, falling back to sitemap last-modified.
              <code className="rounded bg-muted px-1">publishedAtSource</code> tells you
              which (<code>meta</code> · <code>path</code> · <code>sitemap</code>).
            </Faq>
            <Faq q="Why does a PDF look OCR'd?">
              Image-only PDFs and oversized files (~&gt;20 MB) are routed through Firecrawl
              OCR. <code className="rounded bg-muted px-1">get_document</code> surfaces this
              via <code className="rounded bg-muted px-1">extractionMethod: "firecrawl"</code>{" "}
              and a human-readable <code className="rounded bg-muted px-1">contentNote</code>.
            </Faq>
            <Faq q="What does page_type mean?">
              It's URL-derived, not editorial. <code className="rounded bg-muted px-1">project</code>{" "}
              means the URL lives under a <code>/projects/</code> path, not that someone
              curated it as a project.
            </Faq>
          </dl>
        </section>



        {/* ── About / contact ───────────────────────────────────── */}
        <footer className="mt-16 border-t pt-6 text-sm text-muted-foreground">
          <p>
            Built by{" "}
            <a
              href="mailto:joakim@jardenberg.com"
              className="underline underline-offset-4 hover:text-foreground"
            >
              joakim@jardenberg.com
            </a>{" "}
            and Lovable.
          </p>
          <p className="mt-2">
            This is a developing version — questions and comments very welcome.
          </p>



        </footer>
      </main>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 break-all rounded bg-muted px-3 py-2 font-mono text-sm">
        {value}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Tool({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-medium text-foreground">{name}</div>
      <div className="mt-1 text-muted-foreground">{children}</div>
    </div>
  );
}

function ToolDoc({
  name,
  summary,
  params,
  example,
}: {
  name: string;
  summary: string;
  params: string;
  example: string;
}) {
  return (
    <div>
      <h3 className="font-mono text-base font-semibold">{name}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
      <div className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">
        Parameters
      </div>
      <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-3 text-xs">{params}</pre>
      <div className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">
        Example response
      </div>
      <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-3 text-xs">{example}</pre>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-medium text-foreground">{q}</dt>
      <dd className="mt-1 text-muted-foreground">{children}</dd>
    </div>
  );
}
