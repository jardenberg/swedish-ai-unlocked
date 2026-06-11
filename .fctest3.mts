import Firecrawl from "@mendable/firecrawl-js";
const fc = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });
async function t(label:string,url:string,opts:any){
  try{
    const r:any = await fc.scrape(url,{formats:["markdown"],...opts});
    const md=r.markdown??r.data?.markdown??"";
    console.log(`[${label}] len=${md.length} captcha=${/captcha/i.test(md)} skip=${/Skip to|Jump directly/.test(md)}`);
    console.log("  end:",md.slice(-160).replace(/\n/g," "));
  }catch(e){console.error(`[${label}] ERR`,(e as Error).message);}
}
const RISE="https://www.ri.se/en/artificial-intelligence/project/citcomai-ai-tef-scc";
const AI="https://www.ai.se/en/news/ai-transformation";
// onlyCleanContent beta
await t("rise-clean",RISE,{onlyCleanContent:true} as any);
await t("ai-clean",AI,{onlyCleanContent:true} as any);
await t("rise-selectors+clean",RISE,{includeTags:["main"],excludeTags:[".captcha","form",".Paragraph-contact-card",".card__contact__drawer_form",".contact_card__trigger","header","footer","nav"],onlyCleanContent:true} as any);
