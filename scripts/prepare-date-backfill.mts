import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { extractPublishedAtFromMarkdown } from "../src/lib/published-date.server.ts";
const snapshot = JSON.parse(readFileSync(process.argv[2], "utf8"));
const changes = [],
  unresolved = [];
for (const d of snapshot.documents) {
  if (d.status !== "embedded" || d.hidden || d.content_type === "pdf") continue;
  const pub = extractPublishedAtFromMarkdown(d.header, d.url);
  if (pub && (pub.date !== d.published_at || pub.source !== d.published_at_source))
    changes.push({
      id: d.id,
      url: d.url,
      oldDate: d.published_at,
      oldSource: d.published_at_source,
      date: pub.date,
      source: pub.source,
      headerHash: createHash("md5").update(d.header).digest("hex"),
      header: d.header.split("\n").slice(0, 5).join("\n"),
    });
  else if (d.page_type === "news" && !pub)
    unresolved.push({
      url: d.url,
      date: d.published_at,
      source: d.published_at_source,
      header: d.header.slice(0, 350),
    });
}
writeFileSync(process.argv[3], JSON.stringify({ changes, unresolved }, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      changes: changes.length,
      unresolved: unresolved.length,
      samples: changes.slice(0, 3),
      unresolvedSamples: unresolved.slice(0, 8),
    },
    null,
    2,
  ),
);
