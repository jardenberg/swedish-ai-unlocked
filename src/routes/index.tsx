import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { publicStats } from "@/lib/ingest.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Swedish AI Librarian — MCP server for RISE & AI Sweden" },
      {
        name: "description",
        content: "A public MCP server indexing AI-relevant publications from RISE and AI Sweden, Sweden's two government-funded AI organizations. Plug into Claude, Cursor, or any MCP-compatible assistant.",
      },
      { property: "og:title", content: "Swedish AI Librarian — MCP server" },
      { property: "og:description", content: "Semantic search over the Swedish AI ecosystem's open publications." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const stats = useServerFn(publicStats);
  const { data } = useQuery({ queryKey: ["public-stats"], queryFn: () => stats() });

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-6 py-20">
        <h1 className="text-5xl font-semibold tracking-tight">
          Swedish AI Librarian
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          A public MCP server that indexes AI-relevant publications from{" "}
          <a href="https://www.ri.se" className="underline underline-offset-4">RISE</a>{" "}
          and{" "}
          <a href="https://www.ai.se" className="underline underline-offset-4">AI Sweden</a> —
          Sweden's two government-funded AI organizations.
        </p>

        <div className="mt-10 grid grid-cols-2 gap-4">
          <Stat label="Documents indexed" value={data?.documents ?? 0} />
          <Stat label="Searchable chunks" value={data?.chunks ?? 0} />
        </div>

        <section className="mt-12">
          <h2 className="text-xl font-semibold">Connect from an MCP client</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Point any MCP-compatible assistant at the URL below. No authentication required. 60 requests / 5 min per IP.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-4 text-sm">
{`{
  "mcpServers": {
    "swedish-ai": {
      "transport": { "type": "http", "url": "https://YOUR-DOMAIN/api/mcp" }
    }
  }
}`}
          </pre>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-semibold">Tools exposed</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li><code className="rounded bg-muted px-1.5 py-0.5">search_swedish_ai</code> — semantic search over all indexed content.</li>
            <li><code className="rounded bg-muted px-1.5 py-0.5">get_document</code> — fetch full markdown for a single URL.</li>
            <li><code className="rounded bg-muted px-1.5 py-0.5">list_sources</code> — discover scope and document counts.</li>
          </ul>
        </section>

        <footer className="mt-16 border-t pt-6 text-sm text-muted-foreground">
          <Link to="/admin" className="hover:text-foreground">Admin</Link>
        </footer>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="text-3xl font-semibold tabular-nums">{value.toLocaleString()}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </div>
  );
}
