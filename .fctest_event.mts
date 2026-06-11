import Firecrawl from "@mendable/firecrawl-js";
const fc = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });
const url = "https://www.ai.se/en/events/lindholmen-open-day";
const r:any = await fc.scrape(url, {
  formats:["markdown"],
  includeTags:["#block-zeus-theme-content"],
  excludeTags:[".corpus-user-script",".visually-hidden","a.focusable",".grecaptcha-badge",".rc-anchor","[id^=hs-outer-captcha]",".hs-form-frame","form",".form","iframe","[class*=hs-form]","[id*=hs-form]"]
});
const md = r.markdown ?? r.data?.markdown ?? "";
console.log("len", md.length, "captcha", /captcha/i.test(md), "skip", /Skip to main content/.test(md));
console.log("--- tail ---");
console.log(md.slice(-1200));
