import {readConnector} from '../src/lib/human-client.ts';
import assert from 'node:assert/strict';
const base='https://rise-ai-sweden.jardenberg.org';
const original=globalThis.fetch;
globalThis.fetch=(url,opts)=>original(new URL(String(url),base),{...opts,headers:{...opts.headers,Origin:base}});
for(let round=0;round<2;round++){
 const [sources,latest,doc,info]=await Promise.all([
  readConnector('list_sources',{}),readConnector('list_latest',{limit:2}),
  readConnector('get_document',{url:'https://www.ai.se/sv/nyheter/nya-modeller-och-funktioner-forbattrar-svea'}),readConnector('server_info',{})
 ]);
 assert.equal(sources.sources.length,2);assert.equal(latest.results.length,2);assert.equal(doc.publishedAt.slice(0,10),'2025-06-12');assert(info.stats.documents>2300);
 console.log(`Concurrent browser read round ${round+1}: PASS (sources, latest, document, service status)`);
}
