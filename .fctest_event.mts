import Firecrawl from "@mendable/firecrawl-js";
const fc = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });
async function t(label:string, excludeExtra:string[]){
  const r:any = await fc.scrape("https://www.ai.se/en/events/lindholmen-open-day", {
    formats:["markdown"],
    includeTags:["#block-zeus-theme-content"],
    excludeTags:[".corpus-user-script",".visually-hidden","a.focusable",".grecaptcha-badge",".rc-anchor","[id^=hs-outer-captcha]", ...excludeExtra]
  });
  const md = r.markdown ?? r.data?.markdown ?? "";
  console.log(`[${label}] len=${md.length} captcha=${/captcha/i.test(md)} skip=${/Skip to main content/.test(md)}`);
}
await t("baseline", []);
await t("+hs-form-frame", [".hs-form-frame"]);
await t("+hs-form-frame+iframe", [".hs-form-frame","iframe"]);
