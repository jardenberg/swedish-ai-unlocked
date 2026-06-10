import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { publicStats } from "@/lib/ingest.functions";

// Bump on each meaningful deploy. Format: v + YYYYMMDDHHMM (UTC-ish, short).
const VERSION = "v202606102145";
const PUBLISHED = "June 10, 2026";
const MCP_URL = "https://swedish-ai-unlocked.lovable.app/api/mcp";
const MCP_NAME = "rise-ai-sweden";
const PAGE_TITLE = "RISE & AI Sweden — Public MCP Server";

export const Route = createFileRoute("/")({
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
  const stats = useServerFn(publicStats);
  const { data } = useQuery({ queryKey: ["public-stats"], queryFn: () => stats() });

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
              Settings → Connectors → Add custom connector → paste the URL.
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
            Three tools, each returning JSON. Examples below show the actual shape your
            assistant receives.
          </p>

          <div className="mt-6 space-y-8">
            <ToolDoc
              name="search_swedish_ai"
              summary="Semantic search across all indexed RISE and AI Sweden content. Returns ranked passages with source URLs. Swedish and English."
              params={`{
  query: string,           // 2–500 chars
  source?: "rise" | "ai_sweden",
  lang?:   "en" | "sv",
  limit?:  number          // 1–25, default 10
}`}
              example={`{
  "query": "edge AI in manufacturing",
  "count": 2,
  "results": [
    {
      "url": "https://www.ri.se/en/what-we-do/projects/edge-ai-...",
      "title": "Edge AI for smart factories",
      "source": "rise",
      "sourceName": "RISE",
      "lang": "en",
      "score": 0.8421,
      "snippet": "RISE is developing edge AI models that run on...",
      "fetchedAt": "2026-06-08T14:22:11Z"
    },
    { "...": "..." }
  ]
}`}
            />

            <ToolDoc
              name="get_document"
              summary="Fetch full cleaned markdown for a single indexed URL. Use after search_swedish_ai to load complete context on the best hit."
              params={`{ url: string }`}
              example={`{
  "url": "https://www.ai.se/en/project/...",
  "title": "Project title",
  "lang": "en",
  "contentType": "html",
  "source": "ai_sweden",
  "sourceName": "AI Sweden",
  "fetchedAt": "2026-06-08T09:01:44Z",
  "content": "# Project title\\n\\nFull markdown body...",
  "truncated": false
}`}
            />

            <ToolDoc
              name="list_sources"
              summary="Discover scope: which sources are indexed and how many documents from each."
              params={`{}`}
              example={`{
  "sources": [
    { "slug": "rise",       "name": "RISE",      "rootUrl": "https://www.ri.se",  "documents": 412 },
    { "slug": "ai_sweden",  "name": "AI Sweden", "rootUrl": "https://www.ai.se",  "documents": 388 }
  ]
}`}
            />
          </div>
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
            </a>
            . This is a developing version — questions and comments very welcome.
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
