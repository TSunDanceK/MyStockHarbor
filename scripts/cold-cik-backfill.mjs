// THE ONE-OFF BACKFILL: stored fact sets whose manifest entry cannot select them.
//
// ── WHAT recordColdCik DOES NOT FIX ───────────────────────────────────────
// `recordColdCik` fires inside fetchAndStore, on the WRITE path. A symbol whose
// set was written BEFORE that existed is never re-fetched from a render — the
// populated branch returns the stored set without touching SEC — so it never
// reaches the recording site and never enters the hash.
//
// MEASURED (relay 35090016820): ONDS has a stored fact set, NO manifest entry
// at all, and nothing in the cold-CIK hash. Fact sets carry no TTL
// (secFactStore.writeFactSet is a bare SET), so that state is permanent: a page
// served forever from a set no queue will ever refresh. Visiting it does not
// help, because visiting is exactly what does not fetch.
//
// So the recording mechanism handles everything from now on and this handles
// what is already there. ONE RUN, not a schedule.
//
// ── WHERE THE CIK COMES FROM ──────────────────────────────────────────────
// THE STORED SET'S OWN `cik`, first. It is what the fetch that wrote the set
// actually used, so it is the most authoritative value available and needs no
// map lookup. The ticker map is the fallback for a set written before that
// field, and a symbol neither can resolve is REPORTED, never guessed.
//
// A DISAGREEMENT IS NEVER APPLIED, the same rule drainColdCiks follows: if an
// entry already carries a different CIK, reconcileCiks owns that decision --
// it has the change threshold and the shape-change guard.
//
// ── DRY RUN BY DEFAULT ────────────────────────────────────────────────────
// The manifest is 417 KB and the cron read-modify-writes it. This prints what
// it would do and writes NOTHING unless --apply is passed, and it refuses to
// write at all if the scan came back implausibly short -- the same spirit as
// reconcileCiks's threshold: a partial read must not rewrite the manifest.
//
// Run it when the cron is not: a write here races the job's own single write.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";
import { lookupBySpelling } from "../lib/symbolSpellings.mjs";

const redis = Redis.fromEnv();
const APPLY = process.argv.includes("--apply");

const manifestSrc = fs.readFileSync("lib/server/secManifest.ts", "utf8");
const pick = (name) => (manifestSrc.match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const SEC_MANIFEST_KEY = pick("SEC_MANIFEST_KEY");
const SEC_FACTS_PREFIX = pick("SEC_FACTS_PREFIX");
const TICKER_REDIS_KEY = (
  fs.readFileSync("lib/server/secTickerMap.ts", "utf8").match(/TICKER_REDIS_KEY = "([^"]+)"/) ?? []
)[1];
for (const [n, v] of [["SEC_MANIFEST_KEY", SEC_MANIFEST_KEY], ["SEC_FACTS_PREFIX", SEC_FACTS_PREFIX],
  ["TICKER_REDIS_KEY", TICKER_REDIS_KEY]]) {
  if (!v) { console.error(`FATAL: could not read ${n}`); process.exit(2); }
}

// THE SHIPPED emptyEntry, not a hand-written object literal. An entry missing a
// field the queues read is an entry that is present and still unselectable,
// which is the exact bug this is fixing.
const man = await lift(
  grabFunction(readCodeOnly("lib/server/secManifest.ts"), "emptyEntry")
    .replace("SEC_SCORE_VERSION", JSON.stringify(
      (manifestSrc.match(/SEC_SCORE_VERSION = (\d+)/) ?? [])[1] ?? 1
    )) + "\nexport { emptyEntry };"
);

const manifest = await redis.get(SEC_MANIFEST_KEY);
if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }

const storedTickers = await redis.get(TICKER_REDIS_KEY);
const tickerMap = storedTickers?.map ? new Map(Object.entries(storedTickers.map)) : new Map();
console.log(
  `manifest holds ${Object.keys(manifest.symbols).length} SYMBOLS; ` +
    `ticker map holds ${tickerMap.size} (source: ${storedTickers?.map ? "redis" : "NONE"})`
);

// ── EVERY STORED FACT SET, BY SCAN ────────────────────────────────────────
// Not derived from the manifest, deliberately: the symbols this is looking for
// are precisely the ones the manifest does not list.
const storedSymbols = [];
let cursor = "0";
do {
  const [next, keys] = await redis.scan(cursor, { match: `${SEC_FACTS_PREFIX}:*`, count: 500 });
  cursor = next;
  for (const k of keys) storedSymbols.push(k.slice(SEC_FACTS_PREFIX.length + 1));
} while (cursor !== "0");
storedSymbols.sort();
console.log(`scan found ${storedSymbols.length} stored fact sets\n`);

// THE SPIKE GUARD. A partial scan must not be read as "these are all the sets
// there are" — nothing below deletes, but a short scan would under-report the
// gap and be quoted as a clean bill of health.
const MIN_PLAUSIBLE_SETS = 100;
if (storedSymbols.length < MIN_PLAUSIBLE_SETS) {
  console.error(
    `FATAL: scan returned ${storedSymbols.length} sets, under the plausibility floor of ` +
      `${MIN_PLAUSIBLE_SETS}. Refusing to report or write off a partial read.`
  );
  process.exit(2);
}

const created = [];
const filled = [];
const conflicts = [];
const unresolved = [];
const fine = [];

for (let i = 0; i < storedSymbols.length; i += 50) {
  const chunk = storedSymbols.slice(i, i + 50);
  const sets = await redis.mget(...chunk.map((s) => `${SEC_FACTS_PREFIX}:${s}`));
  chunk.forEach((symbol, j) => {
    const entry = manifest.symbols[symbol];
    if (entry?.cik) { fine.push(symbol); return; }
    const set = sets[j];
    const cik = set?.cik || lookupBySpelling(tickerMap, symbol)?.value?.cik || null;
    const from = set?.cik ? "stored set" : cik ? "ticker map" : "nowhere";
    if (!cik) { unresolved.push(symbol); return; }
    if (!entry) {
      created.push({ symbol, cik, from });
      if (APPLY) manifest.symbols[symbol] = man.emptyEntry(cik);
    } else {
      // entry exists with a null cik
      filled.push({ symbol, cik, from });
      if (APPLY) entry.cik = cik;
    }
  });
}

// Entries with no CIK and NO stored set — the scan above cannot see them, and
// they are a different case: nothing to strand, nothing to fix here.
const noCikNoSet = Object.entries(manifest.symbols)
  .filter(([s, e]) => !e?.cik && !storedSymbols.includes(s))
  .map(([s]) => s)
  .sort();

console.log("=".repeat(74));
console.log(`BEFORE: ${Object.values(manifest.symbols).filter((e) => !e?.cik).length + (APPLY ? created.length + filled.length : 0)} ` +
  `manifest SYMBOLS could not be selected by a queue (no CIK), of ${Object.keys(manifest.symbols).length}`);
console.log("");
console.log(`  ENTRY CREATED (stored set, no manifest entry at all): ${created.length}`);
for (const c of created) console.log(`    ${c.symbol.padEnd(8)} ${c.cik}  from the ${c.from}`);
console.log(`  CIK FILLED (entry present, cik null, set stored): ${filled.length}`);
for (const c of filled) console.log(`    ${c.symbol.padEnd(8)} ${c.cik}  from the ${c.from}`);
console.log(`  UNRESOLVED (stored set, and neither the set nor the map has a CIK): ${unresolved.length}` +
  (unresolved.length ? ` — ${unresolved.join(", ")}` : ""));
console.log(`  NO CIK AND NO STORED SET (nothing stranded; only a cold write can fix): ` +
  `${noCikNoSet.length}` + (noCikNoSet.length ? ` — ${noCikNoSet.join(", ")}` : ""));
console.log(`  ALREADY SELECTABLE: ${fine.length}`);
console.log("");

if (!APPLY) {
  console.log("DRY RUN — nothing written. Re-run with --apply to write the manifest.");
} else if (!created.length && !filled.length) {
  console.log("Nothing to apply; manifest NOT written.");
} else {
  await redis.set(SEC_MANIFEST_KEY, { ...manifest, updatedAt: Date.now() });
  const after = Object.values(manifest.symbols).filter((e) => !e?.cik).length;
  console.log(
    `APPLIED: ${created.length} entries created, ${filled.length} CIKs filled. ` +
      `AFTER: ${after} manifest SYMBOLS still without a CIK, of ${Object.keys(manifest.symbols).length}.`
  );
  for (const { symbol } of [...created, ...filled]) {
    console.log(`  ${symbol}: queue-selectable now = ${manifest.symbols[symbol]?.cik ? "YES" : "NO"}`);
  }
}
