// HOW MANY SYMBOLS THE SITE SERVES 404 ON /stock/<sym>/earnings.
//
// MSTY 404s while /stock/MSTY renders. The earnings route calls notFound() on
// cold.status === "no-cik", and a symbol is "no-cik" when the committed SEC
// registrant file (company_tickers_exchange.json) does not list its ticker.
//
// MSTY IS NOT UNREAD — IT IS UNREADABLE FROM THIS SOURCE. YieldMax ETFs are
// series of a trust: the trust is the registrant, the series ticker is not in
// that file, so no CIK will ever resolve and no later read changes it. The same
// is true of TSLY, NVDY, CONY and JEPI. SPY and QQQ ARE listed — they are their
// own registrants — so "ETF" is not the predictor; being in the file is.
//
// This counts the population against the site's OWN universe rather than
// guessing from five examples, and splits it by what the symbol looks like, so
// the fix can be worded for the case that actually dominates.
import fsSync from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const constant = (src, n) => (readCodeOnly(src).match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const TICKER_FILE = constant("lib/server/secTickerMap.ts", "TICKER_FILE");
const SEEN_KEY = constant("lib/server/dynamicUniverseCache.ts", "SEEN_KEY");
const SCORE_KEY = constant("lib/server/dynamicUniverseCache.ts", "SCORE_KEY");
const FACTS_PREFIX = constant("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");

const tickerSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tickerMod = await lift([
  grabFunction(tickerSrc, "padCik"),
  grabFunction(tickerSrc, "parseTickerFile"),
  "export { parseTickerFile };",
].join("\n"));
const { map: TICKERS, shape } = tickerMod.parseTickerFile(fsSync.readFileSync(TICKER_FILE, "utf8"));
console.log(`SEC registrant file: ${TICKERS.size} tickers, shape=${shape}`);

// ── THE SITE'S UNIVERSE, from every source that can put a symbol on a page ──
const universe = new Set();
const add = (s) => { const t = String(s || "").trim().toUpperCase(); if (t) universe.add(t); };

for (const [name, key, kind] of [
  ["dynamic-universe seen", SEEN_KEY, "hash"],
  ["dynamic-universe score", SCORE_KEY, "zset"],
]) {
  if (!key) { console.log(`  ${name}: key not found in source`); continue; }
  try {
    const before = universe.size;
    if (kind === "hash") for (const f of Object.keys((await redis.hgetall(key)) ?? {})) add(f);
    else for (const m of (await redis.zrange(key, 0, -1)) ?? []) add(m);
    console.log(`  ${name}: +${universe.size - before}`);
  } catch (e) { console.log(`  ${name}: FAILED — ${e.message}`); }
}

// Symbols that already have a stored fact set are, by definition, resolvable;
// counted so the totals below add up rather than double-counting.
const stored = new Set();
if (FACTS_PREFIX) {
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, { match: `${FACTS_PREFIX}:*`, count: 1000 });
    cursor = next;
    for (const k of keys) { const s = k.slice(FACTS_PREFIX.length + 1).toUpperCase(); stored.add(s); add(s); }
  } while (cursor !== "0");
  console.log(`  stored fact sets: ${stored.size}`);
}
console.log(`\nSITE UNIVERSE: ${universe.size} distinct symbols\n`);

// ── WHO 404s ──────────────────────────────────────────────────────────────
const missing = [...universe].filter((s) => !TICKERS.has(s)).sort();
console.log("=".repeat(80));
console.log(`SYMBOLS THE EARNINGS ROUTE 404s ON: ${missing.length} of ${universe.size}` +
  ` (${((missing.length / Math.max(universe.size, 1)) * 100).toFixed(1)}%)`);
console.log("=".repeat(80));

// A ticker with a suffix is a different problem from a fund: MER-PK resolves to
// a CIK and is handled by not-issuer-equity, and a dotted class share usually
// resolves too. Split them so the wording can match the dominant case.
const suffixed = missing.filter((s) => /[-.]/.test(s));
const plain = missing.filter((s) => !/[-.]/.test(s));
console.log(`  with a - or . in the ticker (class shares, preferreds, units): ${suffixed.length}`);
console.log(`  plain tickers (funds, ETFs, or genuinely unlisted):            ${plain.length}`);
console.log(`\n  plain, first 60:\n    ${plain.slice(0, 60).join(" ")}`);
if (plain.length > 60) console.log(`    ... and ${plain.length - 60} more`);
if (suffixed.length) console.log(`\n  suffixed, first 25:\n    ${suffixed.slice(0, 25).join(" ")}`);

// THE FIVE NAMED IN THE REPORT, stated individually so the answer to "is MSTY
// just unread" is not inferred from an aggregate.
console.log(`\n  named cases:`);
for (const t of ["MSTY", "TSLY", "NVDY", "CONY", "JEPI", "SPY", "QQQ", "AAPL"]) {
  const e = TICKERS.get(t);
  console.log(`    ${t.padEnd(6)} ${e ? `cik ${e.cik} (${e.exchange ?? "?"}) — resolves, would NOT 404` : "NOT in the registrant file — 404s, and no later read changes that"}` +
    `${universe.has(t) ? "  [in the site universe]" : ""}`);
}
