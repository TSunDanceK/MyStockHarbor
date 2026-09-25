// THE STORED-FACT-SET INDEX STAYS COMPLETE (#552 COWORK #59).
//
// The daily index unions msh:sec:facts:index:v1 into the manifest so every
// stored set is re-read (TSM and 53 others were not). That only holds if every
// path that WRITES a fact set also SADDs it, and every path that DELETES one
// also SREMs it. This pins each path structurally, with a mutation that drops
// the index call from each. The live cross-check (SCAN vs the index) is the
// relay drift probe, write-fact-set-index-drift.
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const manifest = readCodeOnly("lib/server/secManifest.ts");
const store = readCodeOnly("lib/server/secFactStore.ts");
const evict = readCodeOnly("lib/server/symbolEviction.ts");
const INDEX = (fs.readFileSync("lib/server/secManifest.ts", "utf8").match(/SEC_FACTS_INDEX_KEY = "([^"]+)"/) ?? [])[1];
const body = (src, name, len = 1600) => { const i = src.indexOf(name); return i < 0 ? "" : src.slice(i, i + len); };

console.log("1. the index key");
check("SEC_FACTS_INDEX_KEY is declared", INDEX === "msh:sec:facts:index:v1", String(INDEX));

console.log("\n2. every write SADDs");
// ONE write path, found rather than assumed: any other `.set(factKey(` or
// `.set(\`${SEC_FACTS_PREFIX}` in lib/ or app/ is a write the index cannot see.
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.tsx?$/.test(e.name)) files.push(f); } };
walk("lib"); walk("app");
const writers = files.filter((f) => /\.set\(\s*(factKey\(|`\$\{SEC_FACTS_PREFIX\})/.test(readCodeOnly(f, { minRetainedFraction: 0.005 })));
check("exactly one fact-set write in lib/ and app/, in secFactStore.ts", writers.length === 1 && writers[0].endsWith("secFactStore.ts"), writers.join(", "));
const writeOk = (src) => /redis\.set\(factKey\(set\.symbol\), set\);[\s\S]{0,400}redis\.sadd\(SEC_FACTS_INDEX_KEY, set\.symbol\.toUpperCase\(\)\)/.test(body(src, "export async function writeFactSet"));
check("writeFactSet SADDs the symbol (upper-cased, as factKey keys it) after the SET", writeOk(store));
check("...and CATCHES the SADD dropped", !writeOk(store.replace("await redis.sadd(SEC_FACTS_INDEX_KEY, set.symbol.toUpperCase());", "")));

console.log("\n3. every delete SREMs");
const discardOk = (src) => /redis\.del\([\s\S]{0,200}redis\.srem\(SEC_FACTS_INDEX_KEY/.test(body(src, "export async function discardFactSets"));
check("discardFactSets (CIK reassignment) SREMs what it DELs", discardOk(manifest));
check("...and CATCHES the SREM dropped", !discardOk(manifest.replace(/await redis\.srem\(SEC_FACTS_INDEX_KEY[^;]*;/, "")));
const evictOk = (src) => new RegExp(`PER_SYMBOL_SETS = \\[\\s*"${INDEX}"`).test(src) && /for \(const set of PER_SYMBOL_SETS\) p\.srem\(set, symbol\);/.test(body(src, "export async function evictSymbol", 4000));
check("evictSymbol SREMs the index (PER_SYMBOL_SETS carries the same key)", evictOk(evict));
check("...and CATCHES the eviction SREM dropped", !evictOk(evict.replace("for (const set of PER_SYMBOL_SETS) p.srem(set, symbol);", "")));
check("...and CATCHES the registry naming a different key", !evictOk(evict.replace(`"${INDEX}"`, '"msh:sec:facts:index:v0"')));
// The fact set's own DEL paths: PER_SYMBOL_KEYS (eviction) and discardFactSets.
const deleters = files.filter((f) => /\.del\([\s\S]{0,120}?SEC_FACTS_PREFIX/.test(readCodeOnly(f, { minRetainedFraction: 0.005 })));
check("the only direct fact-set DEL outside eviction is discardFactSets", deleters.length === 1 && deleters[0].endsWith("secManifest.ts"), deleters.join(", "));

console.log(failures ? `\n${failures} FAILED` : "\nThe fact-set index is written and cleared on every path.");
process.exit(failures ? 1 : 0);
