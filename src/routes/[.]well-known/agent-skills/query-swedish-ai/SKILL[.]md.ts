import { createFileRoute } from "@tanstack/react-router";
import { SKILL_MD } from "@/lib/agent-skills/query-swedish-ai";

export const Route = createFileRoute(
  "/.well-known/agent-skills/query-swedish-ai/SKILL.md",
)({
  server: {
    handlers: {
      GET: async () =>
        new Response(SKILL_MD, {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        }),
    },
  },
});
