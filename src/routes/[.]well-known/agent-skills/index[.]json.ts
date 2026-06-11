import { createFileRoute } from "@tanstack/react-router";
import { SKILL_MD } from "@/lib/agent-skills/query-swedish-ai";
import { SITE_URL } from "@/lib/build-version";

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const Route = createFileRoute("/.well-known/agent-skills/index.json")({
  server: {
    handlers: {
      GET: async () => {
        const sha256 = await sha256Hex(SKILL_MD);
        const body = JSON.stringify(
          {
            $schema: "https://agent-skills.cloudflare.com/schema/v0.2.0.json",
            skills: [
              {
                name: "query-swedish-ai",
                type: "markdown",
                description:
                  "How to query the RISE & AI Sweden MCP effectively: tool selection, filters, citation guidance.",
                url:
                  SITE_URL +
                  "/.well-known/agent-skills/query-swedish-ai/SKILL.md",
                sha256,
              },
            ],
          },
          null,
          2,
        );
        return new Response(body, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
