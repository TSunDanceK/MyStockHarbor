// FMP-era items purged from the per-symbol news records (#553 COWORK #5).
//
// WHAT IS AT RISK: the owner's ruling is that FMP data is DELETED from caches,
// not left to age out. Two silent ways to miss it:
//   1. the rule lets an unstamped (FMP-era) item through, so nothing changes;
//   2. the rule exists but is only applied on read -- the page looks clean while
//      msh:news:v1:<SYM> keeps the FMP articles, which is the thing the ruling
//      is about. The purge has to sit in the store's dedupe step, which runs
//      over held + fetched items before the record is rewritten.
//
//   node scripts/check-news-purge.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const FILE = "lib/server/news/provenance.ts";
const src = fs.readFileSync(path.join(ROOT, FILE), "utf8");
let seq = 0;
async function load(source) {
  const file = path.join(ROOT, "lib/server/news", `.check-purge-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try { return await import(pathToFileURL(file).href); } finally { fs.unlinkSync(file); }
}

function suite(mod) {
  const fails = [];
  const ok = (label, cond) => { if (!cond) fails.push(label); };
  const active = new Set(["gnews", "wire", "sec"]);
  ok("an unstamped (FMP-era) item is dropped on the free stack", !mod.isFromActiveProvider({}, active, "free"));
  ok("an item stamped fmp is dropped on the free stack", !mod.isFromActiveProvider({ provider: "fmp" }, active, "free"));
  ok("an item from an active free adapter is kept", ["gnews", "wire", "sec"].every((p) => mod.isFromActiveProvider({ provider: p }, active, "free")));
  ok("an item from a provider that is NOT active is dropped", !mod.isFromActiveProvider({ provider: "cnbc" }, active, "free"));
  ok("under the NEWS_PROVIDER=fmp rollback everything is kept, as before",
    mod.isFromActiveProvider({}, active, "fmp") && mod.isFromActiveProvider({ provider: "fmp" }, active, "fmp"));
  return fails;
}

let failures = 0;
const real = suite(await load(src));
console.log("=== provenance rule ===");
console.log(real.length ? real.map((f) => `  FAIL  ${f}`).join("\n") : "  PASS  every assertion");
failures += real.length;

const MUTANTS = [
  ["unstamped items pass", `return typeof item.provider === "string" && activeIds.has(item.provider);`, `return !item.provider || activeIds.has(item.provider);`],
  ["the rollback filters too", `if (mode === "fmp") return true;`, ``],
  ["any stamped item passes", `return typeof item.provider === "string" && activeIds.has(item.provider);`, `return typeof item.provider === "string";`],
];
console.log("\n=== mutants ===");
for (const [label, from, to] of MUTANTS) {
  if (!src.includes(from)) { console.log(`  FAIL  mutant "${label}" no longer matches`); failures++; continue; }
  const caught = suite(await load(src.replace(from, to))).length > 0;
  console.log(`  ${caught ? "PASS" : "FAIL"}  mutant caught: ${label}`);
  if (!caught) failures++;
}

const code = readCodeOnly("lib/stock-news-data.ts");
const wiring = [
  ["the PURGE: the store's dedupe step drops FMP-era items before the record is rewritten",
    /dedupe: \(list\) => dedupeNews\(list\.filter\(fromActive\)\)/.test(code)],
  ["and the READ filters them while a pre-purge record is still cached", /return items\.filter\(fromActive\);/.test(code)],
  ["the rule is the shared one, with the active provider list and the mode",
    /const fromActive = \(item: NewsItem\) => isFromActiveProvider\(item, activeIds, mode\);/.test(code) &&
      /const mode = newsProviderMode\(\);/.test(code)],
  ["the page cache was re-keyed, so no pre-change payload is served", /msh-stock-news-base-data-v29-no-fmp-era-items/.test(code)],
  ["the provenance module imports nothing at runtime", !/^import (?!type )/m.test(readCodeOnly(FILE))],
];
console.log("\n=== wiring ===");
for (const [label, pass] of wiring) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) failures++;
}
console.log(failures ? `\nFAILED (${failures})` : "\nall passed");
process.exit(failures ? 1 : 0);
