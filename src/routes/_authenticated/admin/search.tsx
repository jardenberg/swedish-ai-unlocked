import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { runSearchConsole } from "@/lib/admin-observability.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/admin/search")({
  component: SearchConsolePage,
});

type ToolName =
  | "search_swedish_ai"
  | "find_mentions"
  | "find_similar"
  | "list_latest"
  | "get_document"
  | "list_sources";

const TOOLS: { name: ToolName; fields: { key: string; type: "string" | "number" | "enum"; required?: boolean; options?: string[]; placeholder?: string }[] }[] = [
  {
    name: "search_swedish_ai",
    fields: [
      { key: "query", type: "string", required: true, placeholder: "e.g. secure AI in healthcare" },
      { key: "source", type: "enum", options: ["", "rise", "ai_sweden"] },
      { key: "lang", type: "enum", options: ["", "en", "sv"] },
      { key: "page_type", type: "enum", options: ["", "event", "news", "project", "page"] },
      { key: "limit", type: "number", placeholder: "10" },
    ],
  },
  {
    name: "find_mentions",
    fields: [
      { key: "term", type: "string", required: true, placeholder: "Helsingborg" },
      { key: "source", type: "enum", options: ["", "rise", "ai_sweden"] },
      { key: "lang", type: "enum", options: ["", "en", "sv"] },
      { key: "page_type", type: "enum", options: ["", "event", "news", "project", "page"] },
      { key: "limit", type: "number", placeholder: "25" },
    ],
  },
  {
    name: "find_similar",
    fields: [
      { key: "url", type: "string", required: true, placeholder: "https://www.ri.se/en/…" },
      { key: "source", type: "enum", options: ["", "rise", "ai_sweden"] },
      { key: "lang", type: "enum", options: ["", "en", "sv"] },
      { key: "limit", type: "number", placeholder: "10" },
    ],
  },
  {
    name: "list_latest",
    fields: [
      { key: "source", type: "enum", options: ["", "rise", "ai_sweden"] },
      { key: "lang", type: "enum", options: ["", "en", "sv"] },
      { key: "page_type", type: "enum", options: ["", "event", "news", "project", "page"] },
      { key: "limit", type: "number", placeholder: "20" },
    ],
  },
  {
    name: "get_document",
    fields: [{ key: "url", type: "string", required: true, placeholder: "https://www.ai.se/…" }],
  },
  { name: "list_sources", fields: [] },
];

function SearchConsolePage() {
  const [tool, setTool] = useState<ToolName>("search_swedish_ai");
  const [params, setParams] = useState<Record<string, string>>({});

  const runFn = useServerFn(runSearchConsole);
  const mut = useMutation({
    mutationFn: () => {
      const cleaned: Record<string, unknown> = {};
      const def = TOOLS.find((t) => t.name === tool)!;
      for (const f of def.fields) {
        const v = params[f.key];
        if (v == null || v === "") continue;
        cleaned[f.key] = f.type === "number" ? Number(v) : v;
      }
      return runFn({ data: { tool, params: cleaned } });
    },
  });

  const def = TOOLS.find((t) => t.name === tool)!;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Search console</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Call the public MCP tools directly. Rate-limited at 30/min per admin user.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b pb-2">
        {TOOLS.map((t) => (
          <Button
            key={t.name}
            size="sm"
            variant={t.name === tool ? "default" : "outline"}
            onClick={() => {
              setTool(t.name);
              setParams({});
            }}
          >
            {t.name}
          </Button>
        ))}
      </div>

      <Card className="p-4 space-y-3">
        {def.fields.length === 0 && (
          <p className="text-sm text-muted-foreground">No parameters.</p>
        )}
        {def.fields.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label className="text-xs">
              {f.key}
              {f.required && <span className="text-rose-600"> *</span>}
            </Label>
            {f.type === "enum" ? (
              <select
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={params[f.key] ?? ""}
                onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.value }))}
              >
                {f.options!.map((o) => (
                  <option key={o} value={o}>
                    {o === "" ? "(any)" : o}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                type={f.type === "number" ? "number" : "text"}
                value={params[f.key] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.value }))}
              />
            )}
          </div>
        ))}
        <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? "Running…" : "Run"}
        </Button>
      </Card>

      {mut.data && (
        <Card className="p-4">
          <div className="mb-2 flex justify-between text-xs text-muted-foreground">
            <span>{mut.data.tool} · {mut.data.durationMs}ms</span>
            {mut.data.error && <span className="text-rose-600">error: {mut.data.error}</span>}
          </div>
          <pre className="max-h-[600px] overflow-auto rounded bg-muted/40 p-3 font-mono text-xs">
            {mut.data.resultJson || mut.data.error || "(no output)"}
          </pre>
        </Card>
      )}
    </div>
  );
}
