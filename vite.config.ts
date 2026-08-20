// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { fileURLToPath } from "node:url";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

const firecrawlStub = fileURLToPath(new URL("./src/lib/firecrawl-client-stub.ts", import.meta.url));

// The Firecrawl SDK is server-only (it imports node:events). API route files live in
// the client route tree, so their dynamic server imports would otherwise drag the SDK
// into the browser bundle and break the build. Swap it for a throwing stub client-side.
function stubFirecrawlInClient(): Plugin {
  return {
    name: "stub-firecrawl-in-client",
    enforce: "pre",
    resolveId(source) {
      if (source === "@mendable/firecrawl-js" && this.environment?.name === "client") {
        return firecrawlStub;
      }
      return null;
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [stubFirecrawlInClient()],
  },
});
