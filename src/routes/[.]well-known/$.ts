import { createFileRoute } from "@tanstack/react-router";

// Catch-all under /.well-known/*. More specific routes (server-card.json,
// agent-skills/*) win the match; this only fires for unknown paths.
// Returns a clean 404 instead of a 500.
const notFound = () =>
  new Response("Not Found", {
    status: 404,
    headers: { "Content-Type": "text/plain" },
  });

export const Route = createFileRoute("/.well-known/$")({
  server: {
    handlers: {
      GET: notFound,
      POST: notFound,
    },
  },
});
