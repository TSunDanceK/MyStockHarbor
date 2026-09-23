// What layer 1 does to drone/defence copy, with the market-wide exclusion on.
//
// ── THE QUESTION, NARROWLY ─────────────────────────────────────────────────
// /stock/[symbol]/news picks art in layers and layer 1 reads the headline. On a
// drone company's own feed: how many headlines reach `aerospace-defence`, and
// what do the ones that reach nothing actually say? Neither half could be
// answered from the 2026-09-13 fixture, which holds none of these five symbols.
//
// THE CLASSIFIER IS THE SHIPPED ONE, run locally over a capture made on a
// runner — the same split as scripts/eventtype-sample.mjs, and for the same
// reason: a judgement made on the runner would describe a reimplementation.
//
// `nothing` IS NOT A FAILURE HERE. The picker has three more layers under this
// one, and for all five of these symbols layer 3 answers `aerospace-defence`
// (or `telecom` for ONDS). A headline that says nothing specific SHOULD fall
// through to the company's industry rather than be forced into a picture.
//
//   node scripts/newsart-drone-measure.mjs
import fs from "node:fs";
import { articleTopic } from "../lib/server/news/articleTopic.ts";
import { MARKET_WIDE_SUBJECTS } from "../lib/server/news/articleTopic.ts";

const read = (p) => fs.readFileSync(p, "utf8");
const stripSrc = read("lib/server/news/gnewsProvider.ts")
  .match(/export function stripPublisherSuffix\(title: string\): string \{[\s\S]*?\n\}/)[0]
  .replace("export function stripPublisherSuffix(title: string): string {", "export function stripPublisherSuffix(title) {");
const { stripPublisherSuffix } = await import(
  `data:text/javascript;base64,${Buffer.from(stripSrc).toString("base64")}`
);

const rows = read("scripts/fixtures/drone-headlines-2026-09-22.jsonl")
  .split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => JSON.parse(l));

const hits = [];
const dropped = [];
const nothing = [];
for (const row of rows) {
  const title = stripPublisherSuffix(row.title);
  const { subjects } = articleTopic(title, null);
  const specific = subjects.filter((t) => !MARKET_WIDE_SUBJECTS.has(t));
  const excluded = subjects.filter((t) => MARKET_WIDE_SUBJECTS.has(t));
  if (specific.length) hits.push({ ...row, title, tag: specific[0] });
  else if (excluded.length) dropped.push({ ...row, title, tag: excluded[0] });
  else nothing.push({ ...row, title });
}

const pc = (n) => `${((n / rows.length) * 100).toFixed(0)}%`;
console.log(`\n=== drone-headlines-2026-09-22.jsonl — ${rows.length} real headlines, 5 symbols ===\n`);
console.log(`  subject after the exclusion   ${String(hits.length).padStart(3)}  ${pc(hits.length)}`);
console.log(`  dropped as market-wide        ${String(dropped.length).padStart(3)}  ${pc(dropped.length)}`);
console.log(`  nothing (falls to the layers) ${String(nothing.length).padStart(3)}  ${pc(nothing.length)}`);

const byTag = {};
for (const h of hits) (byTag[h.tag] ??= []).push(h);
console.log(`\n=== what layer 1 matched ===\n`);
for (const [tag, list] of Object.entries(byTag).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${tag} (${list.length})`);
  for (const h of list) console.log(`      ${h.symbol.padEnd(5)} ${h.title.slice(0, 96)}`);
}
if (dropped.length) {
  console.log(`\n=== dropped by MARKET_WIDE_SUBJECTS (would have won without it) ===\n`);
  for (const d of dropped) console.log(`      ${d.tag.padEnd(10)} ${d.symbol.padEnd(5)} ${d.title.slice(0, 92)}`);
}
console.log(`\n=== reaching nothing at layer 1 (${nothing.length}) ===\n`);
for (const n of nothing) console.log(`      ${n.symbol.padEnd(5)} ${n.title.slice(0, 100)}`);
console.log();
