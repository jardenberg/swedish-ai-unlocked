import Firecrawl from "@mendable/firecrawl-js";
const fc = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });
const r: any = await fc.scrape("https://www.ai.se/en/ai-labs/ai-security/updates-ai-security", {
  formats: ["markdown"],
  onlyMainContent: true,
  excludeTags: ['.corpus-user-script', '.visually-hidden', 'a.focusable', '.grecaptcha-badge', '.rc-anchor', '[id^=hs-outer-captcha]', 'iframe'],
  waitFor: 1500,
} as any);
const md = r?.markdown ?? "";
console.log("len", md.length);
console.log("has CAPTCHA?", md.includes("CAPTCHA"), "has Skip?", md.includes("Skip to main content"));
const i = md.toLowerCase().indexOf("captcha");
if (i>=0) console.log(md.slice(Math.max(0,i-300), i+300));
