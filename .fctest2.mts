import Firecrawl from "@mendable/firecrawl-js";
const fc = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });
async function t(label:string, opts:any){
  const url="https://www.ri.se/en/artificial-intelligence/project/citcomai-ai-tef-scc";
  const r:any = await fc.scrape(url,{formats:["markdown"],...opts});
  const md=r.markdown??r.data?.markdown??"";
  console.log(`[${label}] len=${md.length} captcha=${/captcha/i.test(md)} menu=${/Jump directly|Skip to main/.test(md)}`);
  console.log("  end:",md.slice(-200).replace(/\n/g," "));
}
await t("main-tag",{includeTags:["main"]});
await t("main+excludes",{includeTags:["main"],excludeTags:[".captcha","form",".Paragraph-contact-card",".card__contact__drawer_form",".contact_card__trigger","header","footer","nav"]});
await t("onlyMain+excludes",{onlyMainContent:true,excludeTags:[".captcha","form",".Paragraph-contact-card",".card__contact__drawer_form",".contact_card__trigger"]});
