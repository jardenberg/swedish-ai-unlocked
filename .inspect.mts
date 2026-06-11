import Firecrawl from "@mendable/firecrawl-js";
const fc = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });
const urls = [
  "https://www.ai.se/en/about-us/press-and-media",
  "https://www.ai.se/en/sector-initiatives-projects/healthcare",
  "https://www.ai.se/en/ai-labs/ai-security/updates-ai-security",
];
for (const u of urls) {
  const r: any = await fc.scrape(u, { formats: ["rawHtml"], includeTags: ["#block-zeus-theme-content"], onlyMainContent: false } as any);
  const html = r?.rawHtml ?? "";
  console.log("===", u, "len=", html.length);
  // find CAPTCHA / skip-link context
  for (const needle of ["CAPTCHA", "Skip to main content", "captcha"]) {
    const i = html.indexOf(needle);
    if (i >= 0) {
      console.log(`  found "${needle}" at`, i);
      // print surrounding 600 chars
      console.log(html.slice(Math.max(0,i-400), i+400).replace(/\s+/g," "));
      console.log("---");
    }
  }
}
