// THE DIFF RUN (#552 COWORK #70): every stored Layer 2 fact set against the
// same symbol REBUILT FROM THE ARCHIVE through the shipped pipeline --
// rowsToFacts → withPredecessorFacts (the predecessor also from the archive)
// → extractForSymbol → toStoredSet -- and compared with lib/secArchiveDiff.mjs.
// NOTHING IS WRITTEN: no Redis write, no R2 write, no switch. The switch is
// its own PR, after Cowork reads this.
//
// Reads: the fact-set index, the manifest and the stored sets (Upstash REST,
// the READ-ONLY token; ~2 + ceil(n/25) commands), and one R2 GET per filer.
// Prints counts, the per-field difference table, and the SYMBOLS in each
// non-identical class (tickers only, never a value), plus the named
// no-companyfacts filers.
//
//   UPSTASH_REDIS_REST_URL/TOKEN (read-only) + R2_… · node scripts/sec-archive-diff.mjs
//   (workflow: .github/workflows/sec-archive.yml, task "diff")
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { r2Client, decodeFacts, rowsToFacts } from "../lib/secArchive.mjs";
import { compareSets } from "../lib/secArchiveDiff.mjs";

const { extractForSymbol } = await import("../lib/server/secExtractFor.ts");
const { withPredecessorFacts } = await import("../lib/server/secSuccession.ts");
const { toStoredSet } = await import("../lib/server/secFactBuild.ts");
const { defaultSources } = await import("../lib/server/fxRates.ts");
const { SEC_FIELD_KEYS } = await import("../lib/server/secFields.ts");
// THE KEYS, READ FROM THE SOURCE (secManifest.ts imports the Redis client,
// which this workflow does not install; the constants are all it needs).
const keyOf = (n) => (fs.readFileSync("lib/server/secManifest.ts", "utf8").match(new RegExp(`export const ${n} = "([^"]+)"`)) ?? [])[1];
const SEC_MANIFEST_KEY = keyOf("SEC_MANIFEST_KEY"), SEC_FACTS_PREFIX = keyOf("SEC_FACTS_PREFIX"), SEC_FACTS_INDEX_KEY = keyOf("SEC_FACTS_INDEX_KEY");
if (!SEC_MANIFEST_KEY || !SEC_FACTS_PREFIX || !SEC_FACTS_INDEX_KEY) { console.log("stopped: key constants not found in secManifest.ts"); process.exit(1); }

const URL_ = process.env.UPSTASH_REDIS_REST_URL, TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!URL_ || !TOKEN) { console.log("stopped: Upstash (read) credentials are not configured"); process.exit(1); }
let commands = 0;
async function redis(cmd) {
  commands++;
  const res = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`Upstash: ${String(j.error).slice(0, 60)}`);
  return j.result;
}
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);

const r2 = r2Client();
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const symbols = ((await redis(["SMEMBERS", SEC_FACTS_INDEX_KEY])) ?? []).map(String).sort();
const manifest = parse(await redis(["GET", SEC_MANIFEST_KEY])) ?? { symbols: {} };
const stored = new Map();
for (let i = 0; i < symbols.length; i += 25) {
  const chunk = symbols.slice(i, i + 25);
  const got = await redis(["MGET", ...chunk.map((s) => `${SEC_FACTS_PREFIX}:${s}`)]);
  chunk.forEach((s, j) => stored.set(s, got?.[j] ? parse(got[j]) : null));
}
const archiveIndex = JSON.parse((await r2.get("index.json")).toString("utf8"));

// THE NO-COMPANYFACTS FILERS, NAMED: index entries with no facts object.
const byCik = new Map();
for (const [sym, r] of Object.entries(REG)) {
  const c = String(r.cik).padStart(10, "0");
  if (!byCik.has(c)) byCik.set(c, []);
  byCik.get(c).push(sym);
}
const noFacts = Object.entries(archiveIndex.entries).filter(([, e]) => !e.factsSha).map(([c]) => `${(byCik.get(c) ?? ["?"]).join("/")}`).sort();

const archiveFacts = async (cik) => {
  const buf = await r2.get(`facts/${String(cik).padStart(10, "0")}.ndjson.br`);
  if (!buf) return null;
  const { header, rows } = decodeFacts(buf);
  return rowsToFacts(header, rows);
};
const fx = new Map();
const tally = { stored: symbols.length, "identical": 0, "identical-plus-newer": 0, "differs": 0, "hash-differs": 0, "rebuilt-empty": 0, "no-stored-set": 0, "no-cik": 0, error: 0 };
const lists = { "identical-plus-newer": [], "differs": [], "hash-differs": [], "rebuilt-empty": [], "no-cik": [], error: [] };
const fieldSets = {};
let coverDiffers = 0, teStoredOnly = 0, predecessorsRead = 0;
const errorSample = [];
const started = Date.now();
for (const sym of symbols) {
  const s = stored.get(sym);
  if (!s) { tally["no-stored-set"]++; continue; }
  const cik = manifest.symbols?.[sym]?.cik ?? s.cik ?? REG[sym]?.cik ?? null;
  if (!cik) { tally["no-cik"]++; lists["no-cik"].push(sym); continue; }
  try {
    const facts = await archiveFacts(cik);
    let rebuilt = null;
    if (facts && Object.keys(facts.facts ?? {}).length) {
      const merged = await withPredecessorFacts(cik, { ...facts, cik: Number(cik) }, async (pred) => {
        predecessorsRead++;
        return (await archiveFacts(pred)) ?? { cik: Number(pred), facts: {} };
      });
      rebuilt = await toStoredSet(extractForSymbol(sym, merged), defaultSources(), fx);
    }
    const c = compareSets(s, rebuilt, SEC_FIELD_KEYS);
    tally[c.verdict]++;
    if (lists[c.verdict]) lists[c.verdict].push(sym);
    for (const f of Object.keys(c.fields)) (fieldSets[f] ??= []).push(sym);
    if (rebuilt && (s.cover?.val ?? null) !== (rebuilt.cover?.val ?? null)) coverDiffers++;
    if (s.te && !rebuilt?.te) teStoredOnly++;
  } catch (e) {
    tally.error++; lists.error.push(sym);
    if (errorSample.length < 5) errorSample.push(`${sym}: ${String(e?.message ?? e).replace(/https?:\/\/\S+/g, "<url>").slice(0, 80)}`);
  }
}

console.log(`\nstored sets ${tally.stored} · identical ${tally.identical} · identical + newer periods in the archive ${tally["identical-plus-newer"]} · differs ${tally.differs} · stored under another field hash ${tally["hash-differs"]} · rebuilt empty ${tally["rebuilt-empty"]} · no stored set ${tally["no-stored-set"]} · no CIK ${tally["no-cik"]} · errors ${tally.error}`);
console.log(`outside the archive (not counted as differences): cover count differs ${coverDiffers} · stored instance-EPS frame the rebuild cannot make ${teStoredOnly} · predecessor CIKs read from the archive ${predecessorsRead}`);
console.log("\nfields that differ on a shared period (field: sets):");
for (const [f, ss] of Object.entries(fieldSets).sort((a, b) => b[1].length - a[1].length)) console.log(`  ${f}: ${ss.length} · ${ss.join(" ")}`);
for (const [k, ss] of Object.entries(lists)) if (ss.length) console.log(`\n${k} (${ss.length}): ${ss.join(" ")}`);
if (errorSample.length) console.log(`\nerror sample: ${errorSample.join(" | ")}`);
console.log(`\nno companyfacts in the archive (${noFacts.length}): ${noFacts.join(" ")}`);
console.log(`\nRedis commands ${commands} (reads only) · ${Math.round((Date.now() - started) / 1000)}s`);
