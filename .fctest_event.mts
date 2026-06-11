import Firecrawl from "@mendable/firecrawl-js";
const fc = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });
async function t(label:string, opts:any){
  try{
    const r:any = await fc.scrape("https://www.ai.se/en/events/lindholmen-open-day", {formats:["markdown"], ...opts});
    const md = r.markdown ?? r.data?.markdown ?? "";
    console.log(`[${label}] len=${md.length} captcha=${/captcha/i.test(md)} skip=${/Skip to main content/.test(md)}`);
    if(md.length) console.log("  head:", md.slice(0,200).replace(/\n/g,' '));
  }catch(e){console.error(`[${label}] ERR`, (e as Error).message);}
}
await t("nothing", {});
await t("inc-only", {includeTags:["#block-zeus-theme-content"]});
