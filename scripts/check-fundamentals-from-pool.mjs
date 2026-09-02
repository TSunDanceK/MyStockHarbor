// warm-fundamentals must not re-fetch what the price pool already holds, and
// the price pool must survive the hours the market is shut.
//
// WHY. warm-fundamentals' quote stage produced exactly two fields, marketCap
// and peRatio. batch-quote answers 402 on this plan, so it was ONE
// stable/quote call PER SYMBOL, hourly -- measured at 357 of 755 symbols per
// run with the entire 90s wait budget spent (the note above QUOTE_OFFSET_KEY in
// fundamentalsCache.ts). ~8,600 calls a day for two numbers already sitting in
// a Redis hash, for the same universe, because both jobs take their work list
// from getWarmTargetSymbols.
//
// Three things have to stay true for that saving to be real, and each fails
// quietly:
//
//   * The stage reads the pool rather than fetching. A revert reads as a
//     restored fallback, not a regression, and the only symptom is the bill.
//   * The pool is still there when it reads it. #395's market-hours gate
//     returned BEFORE the hash TTL reset, and HSET does not extend an existing
//     TTL -- so a 12-hour TTL against a 15-hour weeknight gap emptied the whole
//     pool at ~05:00 ET every day and all weekend. Nothing errored; picker
//     pages just fell back to end-of-day closes.
//   * The fallback stays capped. Uncapped, a cold pool silently reinstates the
//     per-symbol rotation and the job looks healthy while spending the universe.
//
//   node scripts/check-fundamentals-from-pool.mjs
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// Comments stripped everywhere: this file's whole subject is prose-heavy code,
// and a regex over raw source is satisfied by the note ABOUT the code as
// readily as by the code (claude/traps/grep-finds-the-comment-not-the-code.md).
const fund = readCodeOnly("lib/server/fundamentalsCache.ts");
const pool = readCodeOnly("lib/server/pricePool.ts");
const route = readCodeOnly("app/api/jobs/warm-fundamentals/route.ts");

// ── 1. The two fields come from the pool ────────────────────────────────────
console.log("\n1. marketCap and P/E are read, not fetched");

check(
  "warm-fundamentals reads the price pool",
  /readPricePoolBulk\(cleanSymbols\)/.test(fund),
  "one HMGET for the two fields the quote stage exists to produce"
);

// The load-bearing assertion: FMP is asked about MISSES, not about the
// universe. Scoped to the call site, because fetchQuoteFundamentals itself must
// still exist -- it is the fallback.
const fetchCall = (fund.match(/await fetchQuoteFundamentals\([^)]*\)/) ?? [])[0];
if (!fetchCall) {
  console.error(
    "FAIL: could not find the fetchQuoteFundamentals call site in " +
      "fundamentalsCache.ts — this script would otherwise pass by measuring nothing."
  );
  process.exit(1);
}
check(
  "and hands FMP only the pool misses, never the whole order",
  /fallbackOrder/.test(fetchCall) && !/quoteOrder/.test(fetchCall),
  `${fetchCall.replace(/\s+/g, " ")} — passing quoteOrder here restores the ` +
    `per-symbol rotation with nothing to show for it but the bill`
);

const cap = Number((fund.match(/QUOTE_FALLBACK_MAX_PER_RUN = (\d+)/) ?? [])[1]);
check(
  "the fallback is capped so a cold pool degrades visibly",
  cap > 0 && /poolMisses\.slice\(0, QUOTE_FALLBACK_MAX_PER_RUN\)/.test(fund),
  cap
    ? `${cap}/run — uncapped, an empty pool silently becomes the old rotation ` +
      `and the run still reports success`
    : "no cap found"
);
check(
  "a row carrying neither field counts as a miss, not a hit",
  /row\.marketCap != null \|\| row\.pe != null/.test(fund),
  "seedColdPricePoolRows writes a row with a price and a null pe; counting it " +
    "as covered would exclude that symbol from the one path that fills it in"
);
check(
  "the run reports where the two fields came from",
  ["poolHits", "poolMisses", "fallbackDeferred"].every((f) =>
    new RegExp(`${f}:`).test(route)
  ),
  "poolMisses climbing toward the universe is warm-price-pool failing, showing " +
    "up here — invisible unless it is counted"
);

// NO AGE TEST. Asserted as an absence because adding one is the plausible
// mistake: since #395 the pool only refreshes inside the session, so a row is
// legitimately 15 hours old at 07:00 and 63 across a weekend. Both fields are
// close-derived, so an overnight row is the CORRECT answer, and a freshness
// threshold here would re-fetch the universe every morning to receive the same
// numbers back.
const poolReadBlock = (fund.match(
  /const pool = await readPricePoolBulk\(cleanSymbols\);[\s\S]*?const poolHits = quoteMap\.size;/
) ?? [])[0];
if (!poolReadBlock) {
  console.error("FAIL: could not extract the pool-read block — measuring nothing.");
  process.exit(1);
}
check(
  "no freshness threshold is applied to a pooled row",
  !/\.ts\b/.test(poolReadBlock),
  "market cap is shares x last price and P/E is that price over trailing EPS — " +
    "overnight the last traded price IS the price, so age is not staleness here"
);

// ── 2. The pool is still there to be read ───────────────────────────────────
console.log("\n2. The pool survives the hours the market is shut");

const gateBlock = (pool.match(
  /if \(!isActiveMarketWindow\([\s\S]*?\n  \}/
) ?? [])[0];
if (!gateBlock) {
  console.error("FAIL: could not extract the market-hours gate — measuring nothing.");
  process.exit(1);
}
check(
  "a skipped run still resets the pool hash TTL",
  /redis\.expire\(PRICE_POOL_KEY, PRICE_POOL_HASH_TTL_SECONDS\)/.test(gateBlock),
  "#395 returned before the reset at the bottom of the function, and HSET does " +
    "not extend an existing TTL — so the hash expired mid-gap and the pool was " +
    "rebuilt from cold every morning"
);

// The arithmetic, over the real constants, because "12 hours felt like enough"
// is exactly how this broke. The TTL must outlast the longest run-to-run gap
// the gate creates, or the reset above is the only thing standing between the
// pool and expiry -- and a single failed skip run would empty it.
const ttlHours =
  Number((pool.match(/PRICE_POOL_HASH_TTL_SECONDS = (\d+) \* 60 \* 60/) ?? [])[1]);
const hours = readCodeOnly("lib/server/marketHours.ts");
// EVALUATE the arithmetic rather than picking numbers out of it. The first
// version of this read `9 * 60 + 30` by grabbing both capture groups and
// concatenating them, which produced 930 instead of 570 and reported a 6-hour
// weeknight gap against a real 15 — the check disagreed with the bug it was
// written to describe, which is how it was caught.
const evalMinutes = (name) => {
  const expr = (hours.match(new RegExp(`${name} = ([0-9*+ ]+);`)) ?? [])[1];
  return expr ? Function(`"use strict"; return (${expr});`)() : 0;
};
const openMin = evalMinutes("REGULAR_OPEN_MINUTES_ET");
const closeMin = evalMinutes("REGULAR_CLOSE_MINUTES_ET");
const preBuf = Number((hours.match(/PRE_OPEN_BUFFER_MINUTES = (\d+)/) ?? [])[1]);
const postBuf = Number((hours.match(/POST_CLOSE_BUFFER_MINUTES = (\d+)/) ?? [])[1]);

if (!ttlHours || !openMin || !closeMin || !preBuf || !postBuf) {
  console.error(
    `FAIL: could not read the window constants (ttl ${ttlHours}, open ${openMin}, ` +
      `close ${closeMin}, buffers ${preBuf}/${postBuf}) — the gap arithmetic would ` +
      `compare against NaN and pass by measuring nothing.`
  );
  process.exit(1);
}

const windowEnd = closeMin + postBuf; // minutes into the ET day
const windowStart = openMin - preBuf;
const weeknightGapHours = (24 * 60 - windowEnd + windowStart) / 60;
const weekendGapHours = weeknightGapHours + 48;

check(
  "the TTL is shorter than the closed-hours gap, so the reset is load-bearing",
  ttlHours < weeknightGapHours,
  `${ttlHours}h TTL against a ${weeknightGapHours}h weeknight gap ` +
    `(${weekendGapHours}h across a weekend) — this is not a failure, it is WHY the ` +
    `assertion above matters: without the reset the pool cannot survive one night`
);
