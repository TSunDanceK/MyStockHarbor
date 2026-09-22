// MERGE THE SIX DESCRIPTION SHARDS into data/sec/descriptions.json (PR 3, #518).
//
// Shared by .github/workflows/descriptions-refresh.yml (the monthly rebuild,
// which opens a PR) and descriptions-commit.yml (merging hand-dispatched relay
// runs onto a branch). Refuses a partial merge: all six shards, nothing left
// unreached, and every registrant accounted for as a row or a miss.
//
//   node scripts/descriptions-merge.mjs <dir containing descriptions-part-*.json>
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("usage: node scripts/descriptions-merge.mjs <dir>");
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/^descriptions-part-\d+\.json$/.test(e.name)) files.push(p);
  }
})(dir);
const fail = (msg) => { console.error(`::error::${msg}`); process.exit(1); };
const shards = files.map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
const got = new Set(shards.map((s) => s.shard));
if (got.size !== 6 || shards.length !== 6) fail(`expected 6 distinct shards, got ${shards.length}: ${[...got].join(", ")}`);
const rows = {}, misses = {}, notReached = [];
for (const s of shards) { Object.assign(rows, s.rows); Object.assign(misses, s.misses); notReached.push(...s.notReached); }
if (notReached.length) fail(`${notReached.length} symbols not reached; re-run their shard`);
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const reg = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8"));
const total = Object.keys(reg.rows).length;
const seen = Object.keys(rows).length + Object.keys(misses).length;
if (seen !== total) fail(`${seen} symbols accounted for, registrants has ${total}`);
const out = {
  asOf: shards.map((s) => s.asOf).sort().at(-1),
  source: "SEC EDGAR: each registrant’s latest 10-K Item 1 / 20-F Item 4.B, located and cleaned by lib/server/secDescription.ts (scripts/sec-descriptions-build.mjs)",
  fields: ["form", "filedOn", "accession", "text"],
  rows: sorted(rows),
  misses: sorted(misses),
};
// ONE ROW PER LINE so a refresh diffs per symbol; each line is its own JSON.stringify.
const block = (o) => "{\n" + Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(",\n") + "\n}";
const text = `{"asOf":${JSON.stringify(out.asOf)},"source":${JSON.stringify(out.source)},"fields":${JSON.stringify(out.fields)},\n"rows":${block(out.rows)},\n"misses":${block(out.misses)}}\n`;
JSON.parse(text);
fs.writeFileSync("data/sec/descriptions.json", text);
const why = {};
for (const w of Object.values(misses)) { const k = w.replace(/\(\d+ chars\)/, "(n chars)").replace(/\d+x/, "Nx"); why[k] = (why[k] ?? 0) + 1; }
console.log(`${total} symbols · described ${Object.keys(rows).length} · no description ${Object.keys(misses).length}`);
for (const [w, n] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${w}`);
const jw = shards.reduce((n, s) => n + (s.joined?.words ?? 0), 0), jr = shards.reduce((n, s) => n + (s.joined?.rows ?? 0), 0);
console.log(`split words joined: ${jw} in ${jr} rows`);
