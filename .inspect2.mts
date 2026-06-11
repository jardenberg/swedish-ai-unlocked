import Firecrawl from "@mendable/firecrawl-js";
const fc = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });
const r: any = await fc.scrape("https://www.ai.se/en/about-us/press-and-media", { formats: ["rawHtml"] } as any);
const html = r?.rawHtml ?? "";
// Search for newsletter section structure
const idx = html.search(/Sign up for the latest in Swedish AI/i);
console.log("signup at", idx);
console.log(html.slice(Math.max(0,idx-2000), idx+500).replace(/<script[\s\S]*?<\/script>/g,""));
console.log("=== END BEFORE ===");
// find recaptcha context too
const r2 = html.search(/Recaptcha requires verification/i);
console.log("recaptcha at", r2);
console.log(html.slice(Math.max(0,r2-1500), r2+500).replace(/<script[\s\S]*?<\/script>/g,""));
