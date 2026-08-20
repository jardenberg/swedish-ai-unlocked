// Client-side stub: the Firecrawl SDK is server-only. It must never ship to the
// browser bundle (it imports node:events, which Vite cannot polyfill).
export default class FirecrawlStub {
  constructor() {
    throw new Error("Firecrawl SDK is server-only");
  }
}
