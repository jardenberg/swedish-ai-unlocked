import Firecrawl from "@mendable/firecrawl-js";
const fc = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });

async function test(url: string, opts: any, label: string) {
  try {
    const r: any = await fc.scrape(url, { formats: ["markdown"], onlyMainContent: false, ...opts });
    const md = r.markdown ?? r.data?.markdown ?? "";
    const hasCaptcha = /captcha/i.test(md);
    const hasContactCard = /contact_card|Send message/i.test(md);
    const hasMenu = /Skip to main content|menu-item--expanded/i.test(md);
    console.log(`[${label}] len=${md.length} captcha=${hasCaptcha} contactCard=${hasContactCard} menu=${hasMenu}`);
    console.log("  first 200:", md.slice(0,200).replace(/\n/g," "));
    console.log("  last 300:", md.slice(-300).replace(/\n/g," "));
  } catch (e) { console.error(`[${label}] ERR`, (e as Error).message); }
}

const riseUrl = "https://www.ri.se/en/artificial-intelligence/project/citcomai-ai-tef-scc";
const aiUrl = "https://www.ai.se/en/news/ai-transformation";

await test(riseUrl, { onlyMainContent: true }, "rise-onlyMain");
await test(riseUrl, { includeTags: ["#main-content"], excludeTags: [".captcha", ".Paragraph-contact-card", ".card__contact__drawer_form", ".contact_card__trigger"] }, "rise-selectors");
await test(aiUrl, { onlyMainContent: true }, "ai-onlyMain");
await test(aiUrl, { includeTags: ["#block-zeus-theme-content"] }, "ai-selectors");
