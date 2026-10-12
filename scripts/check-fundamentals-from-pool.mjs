// The price pool must survive the hours the market is shut.
//
// HISTORY. This check began as "warm-fundamentals must not re-fetch what the
// price pool already holds" (its section 1). That job was retired 2026-10-12
// (#553 COWORK #212); the pool half stands on its own:
//
//   * #395's market-hours gate returned BEFORE the hash TTL reset, and HSET
//     does not extend an existing TTL -- so a 12-hour TTL against a 15-hour
//     weeknight gap emptied the whole pool at ~05:00 ET every day and all
//     weekend. Nothing errored; picker pages just fell back to end-of-day
//     closes.
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
const pool = readCodeOnly("lib/server/pricePool.ts");

// ── 1. RETIRED 2026-10-12 (#553 COWORK #212) ────────────────────────────────
// Section 1 pinned warm-fundamentals' quote stage (pool first, FMP for capped
// misses only). The job is retired with FMP; the price pool it read from is
// not, and section 2 still holds it.

// ── 2. The pool is still there to be read ───────────────────────────────────
console.log("\n2. The pool survives the hours the market is shut");

const gateBlock = (pool.match(
  /if \(!isActiveMarketWindow\([\s\S]*?\n  \}/
) ?? [])[0];
if (!gateBlock) {
  console.error("FAIL: could not extract the market-hours gate — measuring nothing.");
  process.exit(1);
}
// THE RESET MAY BE INLINE OR BEHIND THE HELPER, and this assertion used to
// accept only the inline form. It matched `redis.expire(PRICE_POOL_KEY, ...)`
// literally inside the gate, so when the same call was moved into
// `keepPricePoolAlive()` -- which does exactly that expire and nothing else --
// the check went red against CORRECT code and stayed red on main. A red check
// that describes a fixed bug is worse than no check: it teaches everyone that
// red is normal, and the next real failure arrives into an audience that has
// stopped reading. See claude/traps/a-regex-over-source-has-no-scope.md.
//
// So the property is asserted in TWO parts, because accepting the helper name
// alone would let a future no-op helper satisfy it:
//   (a) the gate resets the TTL, inline or via the helper, before returning
//   (b) the helper actually issues the expire
const resetsInline =
  /redis\.expire\(PRICE_POOL_KEY, PRICE_POOL_HASH_TTL_SECONDS\)/.test(gateBlock);
const resetsViaHelper = /keepPricePoolAlive\(\)/.test(gateBlock);
check(
  "a skipped run still resets the pool hash TTL",
  resetsInline || resetsViaHelper,
  "#395 returned before the reset at the bottom of the function, and HSET does " +
    "not extend an existing TTL — so the hash expired mid-gap and the pool was " +
    "rebuilt from cold every morning" +
    (resetsViaHelper ? " (satisfied via keepPricePoolAlive)" : "")
);

// (b). Only meaningful when the gate delegates -- an inline reset is its own
// evidence. Without this, renaming the helper's body to a no-op would leave the
// assertion above green while the pool expired again exactly as it did in #395.
if (resetsViaHelper && !resetsInline) {
  const helperBlock = (pool.match(
    /export async function keepPricePoolAlive\([\s\S]*?\n\}/
  ) ?? [])[0];
  check(
    "and the helper it delegates to actually issues the expire",
    Boolean(helperBlock) &&
      /redis\.expire\(PRICE_POOL_KEY, PRICE_POOL_HASH_TTL_SECONDS\)/.test(helperBlock),
    "the gate calling a helper proves nothing on its own — this is what stops " +
      "the indirection from hollowing out the guarantee it was refactored into"
  );
}

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
