import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { uploadManualPdf } from "@/lib/ingest.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/admin/upload")({
  component: UploadPage,
});

const MAX_BYTES = 50 * 1024 * 1024;

function UploadPage() {
  const upload = useServerFn(uploadManualPdf);
  const [file, setFile] = useState<File | null>(null);
  const [canonicalUrl, setCanonicalUrl] = useState("");
  const [title, setTitle] = useState("");
  const [sourceSlug, setSourceSlug] = useState<"rise" | "ai_sweden">("rise");
  const [lang, setLang] = useState<"en" | "sv">("en");

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Pick a PDF file");
      if (file.type !== "application/pdf") throw new Error("File must be application/pdf");
      if (file.size > MAX_BYTES) throw new Error(`File exceeds 50 MB (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
      const buf = new Uint8Array(await file.arrayBuffer());
      // Base64-encode in chunks to avoid call-stack overflow on large files
      let bin = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < buf.length; i += CHUNK) {
        bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
      }
      const fileBase64 = btoa(bin);
      return upload({
        data: {
          canonicalUrl: canonicalUrl.trim(),
          title: title.trim(),
          sourceSlug,
          lang,
          fileBase64,
          mimeType: "application/pdf",
        },
      });
    },
    onSuccess: (res) => {
      toast.success(`Uploaded — document id ${res.id}. It will appear in the Documents list as 'pending' and will be processed by the next scrape+embed run.`);
      setFile(null);
      setCanonicalUrl("");
      setTitle("");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Upload PDF</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          For form-gated or otherwise un-crawlable publications. The file is stored privately; the canonical URL you enter is what appears in all citations.
        </p>
      </div>
      <Card className="p-6">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="file">PDF file (max 50 MB)</Label>
            <Input
              id="file"
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="canonical">Canonical landing-page URL</Label>
            <Input
              id="canonical"
              type="url"
              placeholder="https://www.ai.se/en/news/state-of-ai-rise-2025"
              value={canonicalUrl}
              onChange={(e) => setCanonicalUrl(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              The public page where this PDF is offered. Used as the document URL so citations point to the publisher, not our storage.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={500} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="source">Source</Label>
              <select
                id="source"
                className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                value={sourceSlug}
                onChange={(e) => setSourceSlug(e.target.value as "rise" | "ai_sweden")}
              >
                <option value="rise">RISE</option>
                <option value="ai_sweden">AI Sweden</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lang">Language</Label>
              <select
                id="lang"
                className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                value={lang}
                onChange={(e) => setLang(e.target.value as "en" | "sv")}
              >
                <option value="en">English</option>
                <option value="sv">Swedish</option>
              </select>
            </div>
          </div>
          <Button type="submit" disabled={mutation.isPending || !file}>
            {mutation.isPending ? "Uploading…" : "Upload PDF"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
