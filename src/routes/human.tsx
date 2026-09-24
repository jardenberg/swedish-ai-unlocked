import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Search, ArrowUpRight, ArrowLeft, BookOpen, Copy, Check } from "lucide-react";
import { readConnector } from "@/lib/human-client";
import { VERSION } from "@/lib/build-version";

type Mode = "latest" | "search" | "mentions" | "sources";
type Browse = {
  mode: Mode;
  q: string;
  source: string;
  lang: string;
  kind: string;
  doc: string;
  limit: number;
  similar: string;
};
type Publication = {
  url: string;
  title: string;
  source?: string;
  sourceName?: string;
  lang?: string;
  pageType?: string;
  snippet?: string;
  publishedAt?: string;
  publishedAtSource?: string;
  fetchedAt?: string;
  matchMode?: string;
};
type Source = {
  slug: string;
  name: string;
  rootUrl: string;
  documents: number;
  languages: Record<string, number>;
  lastUpdated: string;
};
type Document = Publication & { content: string; truncated: boolean; contentNote?: string };
const cleanTitle = (s: string) =>
  s?.replace(/\s*\|\s*(AI Sweden|RISE)\s*$/i, "") || "Untitled publication";
const date = (s?: string) =>
  s && !Number.isNaN(Date.parse(s))
    ? new Date(s).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "Not available";
const queryPolicy = { staleTime: 60_000, retry: false as const, refetchOnWindowFocus: false };
export const Route = createFileRoute("/human")({
  validateSearch: (s: Record<string, unknown>): Browse => ({
    mode: ["latest", "search", "mentions", "sources"].includes(String(s.mode))
      ? (s.mode as Mode)
      : "latest",
    q: String(s.q || "").slice(0, 500),
    source: ["rise", "ai_sweden"].includes(String(s.source)) ? String(s.source) : "",
    lang: ["sv", "en"].includes(String(s.lang)) ? String(s.lang) : "",
    kind: ["news", "project", "event", "page"].includes(String(s.kind)) ? String(s.kind) : "",
    doc: /^https?:\/\//.test(String(s.doc)) ? String(s.doc) : "",
    similar: /^https?:\/\//.test(String(s.similar)) ? String(s.similar) : "",
    limit: Number(s.limit) === 50 ? 50 : 20,
  }),
  head: () => ({
    meta: [
      { title: "Explore Swedish AI research | RISE & AI Sweden" },
      {
        name: "description",
        content:
          "Search publications from RISE and AI Sweden. Read source documents, follow related research and explore the latest work.",
      },
    ],
  }),
  component: Human,
});

function Markdown({ text, excerpt = false }: { text: string; excerpt?: boolean }) {
  return (
    <div className={excerpt ? "human-excerpt" : "human-prose"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ src }) =>
            excerpt ? null : (
              <a href={src} target="_blank" rel="noopener noreferrer">
                View image at source ↗
              </a>
            ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
function Human() {
  const state = Route.useSearch();
  const navigate = Route.useNavigate();
  const [input, setInput] = useState(state.q);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  useEffect(() => {
    setInput(state.q);
    setCopied(false);
    setCopyError("");
  }, [state.q, state.doc, state.similar, state.mode, state.source, state.lang, state.kind, state.limit]);
  const change = (patch: Partial<Browse>) => navigate({ search: { ...state, ...patch } });
  const filters = {
    ...(state.source ? { source: state.source } : {}),
    ...(state.lang ? { lang: state.lang } : {}),
    ...(state.kind ? { page_type: state.kind } : {}),
  };
  const sources = useQuery({
    queryKey: ["human-sources"],
    queryFn: ({ signal }) => readConnector<{ sources: Source[] }>("list_sources", {}, signal),
    ...queryPolicy,
  });
  const tool = state.similar
    ? "find_similar"
    : state.mode === "mentions"
      ? "find_mentions"
      : state.mode === "search"
        ? "search_swedish_ai"
        : "list_latest";
  const args = state.similar
    ? {
        url: state.similar,
        ...(state.source ? { source: state.source } : {}),
        ...(state.lang ? { lang: state.lang } : {}),
        limit: 25,
      }
    : {
        ...filters,
        limit: state.limit,
        ...(state.mode === "search"
          ? { query: state.q }
          : state.mode === "mentions"
            ? { term: state.q }
            : {}),
      };
  const results = useQuery({
    queryKey: ["human-results", tool, args],
    queryFn: ({ signal }) =>
      readConnector<{ results: Publication[]; total?: number; returned?: number }>(
        tool,
        args,
        signal,
      ),
    enabled:
      !state.doc &&
      state.mode !== "sources" &&
      (!!state.similar || state.mode === "latest" || state.q.trim().length >= 2),
    ...queryPolicy,
  });
  const document = useQuery({
    queryKey: ["human-document", state.doc],
    queryFn: ({ signal }) => readConnector<Document>("get_document", { url: state.doc }, signal),
    enabled: !!state.doc,
    ...queryPolicy,
  });
  const related = useQuery({
    queryKey: ["human-related", state.doc],
    queryFn: ({ signal }) =>
      readConnector<{ results: Publication[] }>(
        "find_similar",
        { url: state.doc, limit: 5 },
        signal,
      ),
    enabled: !!document.data,
    ...queryPolicy,
  });
  const info = useQuery({
    queryKey: ["human-info"],
    queryFn: ({ signal }) =>
      readConnector<{
        version: string;
        serverOperator: string;
        rateLimit: string;
        stats: { chunks: number; documents: number };
        specVersion: string;
      }>("server_info", {}, signal),
    enabled: state.mode === "sources" && !state.doc,
    ...queryPolicy,
  });
  const open = (url: string) => change({ doc: url });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setCopyError("");
    } catch {
      setCopyError("Could not copy the link. Copy the address from your browser instead.");
      setCopied(false);
    }
  };
  const error = (e: Error, retry: () => unknown) => (
    <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm">
      <p>{e.message}</p>
      <button className="mt-3 underline" onClick={retry}>
        Try again
      </button>
    </div>
  );
  const card = (p: Publication, compact = false) => (
    <article key={p.url} className="human-card">
      <div className="mb-3 flex flex-wrap gap-2 text-xs font-medium text-teal-800">
        <span>{p.sourceName || (p.source === "rise" ? "RISE" : "AI Sweden")}</span>
        <span aria-hidden>·</span>
        <span>{p.lang === "sv" ? "Swedish" : p.lang === "en" ? "English" : p.lang}</span>
        {p.pageType && <span className="rounded bg-stone-100 px-2">{p.pageType}</span>}
      </div>
      <h3 className={compact ? "font-semibold leading-snug" : "text-xl font-semibold leading-snug"}>
        <button onClick={() => open(p.url)} className="text-left hover:underline">
          {cleanTitle(p.title)}
        </button>
      </h3>
      {!compact && p.snippet && (
        <div className="mt-3 text-sm leading-relaxed text-stone-600">
          <Markdown text={p.snippet} excerpt />
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-stone-500">
        <span>
          {p.publishedAt
            ? `${p.publishedAtSource === "sitemap" ? "Source updated" : p.publishedAtSource?.startsWith("pdf_") ? "Date inferred from PDF" : "Published"} ${date(p.publishedAt)}`
            : p.fetchedAt
              ? `Indexed ${date(p.fetchedAt)}`
              : ""}
        </span>
        <a
          href={p.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-teal-800 underline"
        >
          Original source <ArrowUpRight size={13} />
        </a>
      </div>
      {p.matchMode && (
        <p className="mt-2 text-xs text-stone-500">
          {p.matchMode === "exact" ? "Exact text match" : "Word-form match"}
        </p>
      )}
    </article>
  );
  return (
    <div className="human-page min-h-screen bg-stone-50 text-stone-900">
      <a href="#research-content" className="sr-only focus:not-sr-only">
        Skip to research
      </a>
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-5">
          <a href="/human" className="flex items-center gap-2 font-semibold">
            <BookOpen size={20} className="text-teal-800" /> RISE &amp; AI Sweden
          </a>
          <a href="/" className="text-sm font-medium text-teal-800 underline underline-offset-4">
            Connect your AI ↗
          </a>
        </div>
      </header>
      <main id="research-content" className="mx-auto max-w-6xl px-5 pb-16">
        {copyError && <p role="status" className="mt-4 text-sm text-amber-800">{copyError}</p>}
        {!state.doc && (
          <section className="py-10 sm:py-14">
            <p className="text-xs font-semibold uppercase tracking-widest text-teal-800">
              The public research collection
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
              Explore Swedish AI.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-stone-600">
              Research, projects and practical experience from RISE and AI Sweden. Ask a question,
              find a name, or follow the latest publications.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                change({
                  q: input.trim(),
                  mode: state.mode === "mentions" ? "mentions" : "search",
                  doc: "",
                  similar: "",
                  limit: 20,
                });
              }}
              className="mt-7 flex max-w-3xl flex-col gap-2 sm:flex-row"
            >
              <label className="sr-only" htmlFor="research-search">
                Search the research collection
              </label>
              <input
                id="research-search"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                minLength={2}
                maxLength={state.mode === "mentions" ? 200 : 500}
                required
                placeholder={
                  state.mode === "mentions"
                    ? "A project, organisation or person…"
                    : "What would you like to explore?"
                }
                className="min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-4 py-3.5 shadow-sm"
              />
              <button
                className="flex items-center justify-center gap-2 rounded-xl bg-teal-900 px-6 py-3.5 font-medium text-white"
                type="submit"
              >
                <Search size={18} /> {state.mode === "mentions" ? "Find mentions" : "Search"}
              </button>
            </form>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-stone-600">
              <span>Try:</span>
              {["Svea", "AI in healthcare", "Helsingborg"].map((q) => (
                <button
                  key={q}
                  className="rounded-full border border-stone-200 bg-white px-3 py-1 hover:border-teal-700"
                  onClick={() => change({ mode: "search", q, similar: "", limit: 20 })}
                >
                  {q}
                </button>
              ))}
            </div>
          </section>
        )}
        {state.doc ? (
          <section className="py-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <button
                onClick={() => change({ doc: "" })}
                className="flex items-center gap-2 text-sm text-teal-800"
              >
                <ArrowLeft size={16} /> Back to results
              </button>
              <button onClick={copy} className="flex items-center gap-2 text-sm">
                {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
                {copied ? "Link copied" : "Copy link"}
              </button>
            </div>
            {document.isPending && <p role="status">Loading the document…</p>}
            {document.error && error(document.error, () => document.refetch())}
            {document.data && (
              <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
                <article className="min-w-0 rounded-2xl border border-stone-200 bg-white p-6 sm:p-9">
                  <p className="text-sm font-medium text-teal-800">
                    {document.data.sourceName} ·{" "}
                    {document.data.lang === "sv" ? "Swedish" : "English"}
                  </p>
                  <h1 className="mt-3 text-3xl font-semibold leading-tight">
                    {cleanTitle(document.data.title)}
                  </h1>
                  <div className="my-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-stone-500">
                    <span>
                      {document.data.publishedAtSource?.startsWith("pdf_")
                        ? "Date inferred from PDF"
                        : "Publication date"}
                      : {date(document.data.publishedAt)}
                    </span>
                    <span>Indexed: {date(document.data.fetchedAt)}</span>
                  </div>
                  <a
                    href={document.data.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-medium text-teal-800 underline"
                  >
                    Read at the publisher <ArrowUpRight size={14} />
                  </a>
                  <p className="my-5 border-y border-stone-100 py-4 text-xs leading-relaxed text-stone-500">
                    Source text from the publisher, presented from the indexed copy. No AI summary
                    has been added. {document.data.contentNote}
                  </p>
                  {document.data.truncated && (
                    <p className="mb-5 rounded bg-amber-50 p-3 text-sm">
                      This indexed view is shortened. Open the original source for the complete
                      document.
                    </p>
                  )}
                  <Markdown text={document.data.content.replace(/^# [^\n]+\n+/, "")} />
                </article>
                <aside aria-label="Related publications">
                  <h2 className="mb-4 font-semibold">More like this</h2>
                  {related.isPending && (
                    <p role="status" className="text-sm">
                      Finding related reading…
                    </p>
                  )}
                  {related.error && error(related.error, () => related.refetch())}
                  <div className="space-y-3">{related.data?.results.map((p) => card(p, true))}</div>
                  {related.data?.results.length === 0 && (
                    <p className="text-sm text-stone-500">No related documents found.</p>
                  )}
                  <button
                    className="mt-5 text-sm text-teal-800 underline"
                    onClick={() => change({ doc: "", similar: state.doc, mode: "search" })}
                  >
                    Explore more related publications
                  </button>
                </aside>
              </div>
            )}
          </section>
        ) : (
          <>
            <nav
              aria-label="Browse the collection"
              className="flex flex-wrap gap-2 border-b border-stone-200 pb-4"
            >
              {(
                [
                  ["latest", "Latest publications"],
                  ["search", "Search"],
                  ["mentions", "Find mentions"],
                  ["sources", "Sources & status"],
                ] as const
              ).map(([m, label]) => (
                <button
                  aria-current={state.mode === m && !state.similar ? "page" : undefined}
                  key={m}
                  onClick={() => change({ mode: m, similar: "", limit: 20 })}
                  className={`rounded-full px-4 py-2 text-sm font-medium ${state.mode === m && !state.similar ? "bg-teal-900 text-white" : "bg-white text-stone-600 hover:bg-stone-100"}`}
                >
                  {label}
                </button>
              ))}
            </nav>
            {state.mode === "sources" ? (
              <section className="py-8">
                <h2 className="text-2xl font-semibold">Know what you’re searching.</h2>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-stone-600">
                  Public pages and documents within the connector’s configured source scope. Offsite
                  redirects are excluded. A recent fetch is not proof that every source page has
                  been checked.
                </p>
                {sources.isPending && (
                  <p role="status" className="mt-5">
                    Loading source information…
                  </p>
                )}
                {sources.error && error(sources.error, () => sources.refetch())}
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  {sources.data?.sources.map((s) => (
                    <article key={s.slug} className="human-card">
                      <h3 className="text-xl font-semibold">{s.name}</h3>
                      <p className="my-4 text-3xl font-semibold">
                        {s.documents.toLocaleString()}{" "}
                        <span className="text-sm font-normal text-stone-500">documents</span>
                      </p>
                      <p className="text-sm text-stone-600">
                        {s.languages.sv || 0} Swedish · {s.languages.en || 0} English
                      </p>
                      <p className="mt-2 text-sm text-stone-500">
                        Most recent document fetch: {date(s.lastUpdated)}
                      </p>
                      <div className="mt-5 flex flex-wrap gap-4 text-sm">
                        <button
                          onClick={() => change({ source: s.slug, mode: "latest" })}
                          className="text-teal-800 underline"
                        >
                          Explore publications
                        </button>
                        <a
                          href={s.rootUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          Visit publisher ↗
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
                {info.isPending && (
                  <p role="status" className="mt-5">
                    Loading service status…
                  </p>
                )}
                {info.error && error(info.error, () => info.refetch())}
                {info.data && (
                  <div className="mt-8 rounded-xl border border-stone-200 p-5 text-sm leading-7 text-stone-600">
                    <h3 className="font-semibold text-stone-900">About this service</h3>
                    <p>
                      Operated by {info.data.serverOperator}.{" "}
                      {info.data.stats.documents.toLocaleString()} documents in the collection.
                    </p>
                    <p>
                      Public, read-only access. No account or API key required. Shared limit:{" "}
                      {info.data.rateLimit}.
                    </p>
                    <p>
                      Service version: {info.data.version}. Responses carry signed provenance; this
                      browser does not independently verify signatures.
                    </p>
                    <a className="text-teal-800 underline" href="/#setup-heading">
                      Connection and verification details ↗
                    </a>
                  </div>
                )}
              </section>
            ) : (
              <>
                <div className="my-6 flex flex-wrap items-end gap-3">
                  {[
                    [
                      "source",
                      "Publisher",
                      [
                        ["", "Both publishers"],
                        ["ai_sweden", "AI Sweden"],
                        ["rise", "RISE"],
                      ],
                    ],
                    [
                      "lang",
                      "Language",
                      [
                        ["", "All languages"],
                        ["sv", "Swedish"],
                        ["en", "English"],
                      ],
                    ],
                    [
                      "kind",
                      "Content type",
                      [
                        ["", "All content"],
                        ["news", "News"],
                        ["project", "Projects"],
                        ["event", "Events"],
                        ["page", "Pages & reports"],
                      ],
                    ],
                  ].map(([key, label, options]) => (
                    <label key={key as string} className="text-xs font-medium text-stone-600">
                      {label as string}
                      <select
                        aria-label={label as string}
                        value={state[key as "source" | "lang" | "kind"]}
                        disabled={!!state.similar && key === "kind"}
                        onChange={(e) => change({ [key as string]: e.target.value, limit: 20 })}
                        className="mt-1 block rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm"
                      >
                        {(options as string[][]).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <button
                    onClick={() => change({ source: "", lang: "", kind: "", limit: 20 })}
                    className="px-2 py-2.5 text-xs text-teal-800 underline"
                  >
                    Reset filters
                  </button>
                  <button
                    onClick={copy}
                    className="ml-auto px-2 py-2.5 text-xs text-teal-800 underline"
                  >
                    {copied ? "Link copied" : "Copy this view"}
                  </button>
                </div>
                <h2 className="mb-2 text-2xl font-semibold">
                  {state.similar
                    ? "Related publications"
                    : state.mode === "latest"
                      ? "Latest in the collection"
                      : state.q
                        ? `${state.mode === "mentions" ? "Mentions of" : "Results for"} “${state.q}”`
                        : state.mode === "mentions"
                          ? "Find a project, organisation or person"
                          : "Ask a question or explore a topic"}
                </h2>
                {state.mode === "mentions" && (
                  <p className="mb-5 text-sm text-stone-600">
                    Find literal mentions and related word forms. Matches can also appear in a
                    publisher’s related-content links.
                  </p>
                )}
                {state.mode === "latest" && (
                  <p className="mb-5 text-sm text-stone-500">
                    Sorted by publication date where available; otherwise by the source’s update
                    date.
                  </p>
                )}
                {results.isFetching && (
                  <p role="status" className="my-6 text-sm text-teal-800">
                    {state.mode === "latest"
                      ? "Loading publications…"
                      : "Searching the collection…"}
                  </p>
                )}
                {results.error && error(results.error, () => results.refetch())}
                {!results.isFetching && results.data && (
                  <>
                    <p role="status" className="mb-4 text-sm text-stone-500">
                      Showing {results.data.results.length} publications
                      {state.mode === "mentions" && results.data.total !== undefined
                        ? `. ${results.data.total} documents contain the exact text; results may also include word forms.`
                        : "."}
                      {results.data.results.length >= Number(args.limit)
                        ? " This is a limited selection, not the complete collection."
                        : ""}
                    </p>
                    {results.data.results.length === 0 ? (
                      <div className="human-card">
                        <h3 className="font-semibold">No results for this view.</h3>
                        <p className="mt-2 text-sm text-stone-600">
                          Try a shorter phrase, another language, or reset the filters.
                        </p>
                        <button
                          onClick={() =>
                            change({
                              mode: "latest",
                              q: "",
                              source: "",
                              lang: "",
                              kind: "",
                              similar: "",
                            })
                          }
                          className="mt-4 text-sm text-teal-800 underline"
                        >
                          Browse latest publications
                        </button>
                      </div>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-2">
                        {results.data.results.map((p) => card(p))}
                      </div>
                    )}
                    {!state.similar &&
                      state.limit < 50 &&
                      results.data.results.length >= state.limit && (
                        <button
                          onClick={() => change({ limit: 50 })}
                          className="mt-6 rounded-lg border border-teal-800 px-5 py-3 text-sm text-teal-900"
                        >
                          Show up to 50 results
                        </button>
                      )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </main>
      <footer className="border-t border-stone-200 px-5 py-6 text-xs text-stone-500">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3">
          <span>Publisher content remains © its respective publisher.</span>
          <span>
            {VERSION} ·{" "}
            <a href="/CHANGELOG.md" className="underline">
              What’s changed
            </a>{" "}
            ·{" "}
            <a href="/" className="underline">
              Connect your AI
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
