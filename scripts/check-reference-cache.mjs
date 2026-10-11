// The two market-wide reference payloads, and why they are cached where they
// are.
//
// WHAT WAS WRONG. stock-list (3.04 MB) and the monthly earnings-calendar
// (697 KB) sat in a module-level Map plus Next's per-instance fetch cache.
// Neither layer is shared, so every cold lambda refetched the whole payload --
// 108 fetches per 30 days each, ~294 MB and ~73 MB.
//
// THE FAILURE MODE THIS GUARDS IS NOT THE CACHE MISSING. It is an EMPTY
// response being cached as though it were an answer. Both fetches parse a
// failed or restricted response to [], and writing that under a 24-hour or
// 30-day TTL would blank every consumer until it expired -- an absence held as
// data, which is the shape this repo keeps finding
// (claude/traps/absence-needs-the-producer-to-have-run.md).
//
//   node scripts/check-reference-cache.mjs
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const cache = readCodeOnly("lib/server/referenceCache.ts");
const cal = readCodeOnly("lib/server/earningsCalendar.ts");

console.log("\n=== 1. Both sets read the shared cache ===\n");

check(
  "the earnings calendar reads Redis before FMP",
  /readReference<RawEarningsRow\[\]>\(`earnings-calendar:/.test(cal),
  "the module Map is per-instance, so without this every cold lambda refetches the whole month"
);
// THE NAME MAP IS GONE (#535 COWORK #18 §3, 2026-09-23): the grid names come
// from SEC's committed ticker file and the directory snapshot
// (lib/server/secTickerNames.ts), so FMP's 3 MB /stable/stock-list is not
// fetched, cached or read. Asserted gone, so it cannot quietly come back.
check(
  "the FMP name map is not fetched, cached or read",
  !/stock-list/.test(cal) && !/getNameMap|nameMapCache/.test(cal) && /gridCompanyName\(symbol\)/.test(cal)
);
check(
  "the in-process month cache is still in front of Redis",
  /monthCache\.set/.test(cal),
  "Redis is a third layer under the module cache, not a replacement -- a warm instance should not pay a round-trip"
);

console.log("\n=== 2. An empty response is never cached ===\n");

// CONTAINMENT, NOT PROXIMITY. This was `{0,200}` between the guard and the
// write, and it broke twice for the same reason: readCodeOnly blanks comments
// in place rather than deleting them, so a comment growing between the two
// lines pushes them apart without moving a line of code. check-pricepool-ohlc
// had the identical failure earlier in this rebuild. The question is whether
// the write is INSIDE the guard, so slice the guard's block and look in it.
const guardStart = cal.indexOf("if (result.rows.length) {");
const guardBlock = guardStart === -1 ? "" : cal.slice(guardStart, cal.indexOf("\n  }", guardStart));
check(
  "the calendar guards on rows.length before writing",
  guardBlock.includes("writeReference(`earnings-calendar:"),
  guardStart === -1
    ? "could not find the guard to slice"
    : "a failed or restricted response parses to [], and a day of that blanks every consumer"
);

console.log("\n=== 3. The cadences are the ones that were argued for ===\n");

const monthly = Number(cache.match(/REFERENCE_TTL_MONTHLY_SECONDS = (\d+) \* 24 \* 60 \* 60;/)?.[1]);
const daily = /REFERENCE_TTL_DAILY_SECONDS = 24 \* 60 \* 60;/.test(cache);

check(
  "stock-list is monthly",
  monthly === 30,
  "probe Q8: ~150-300 US IPOs a year against 38,829 rows, and the consumer uses it for a display NAME -- staleness is cosmetic and self-correcting"
);
check(
  "the earnings calendar is daily",
  daily,
  "FMP's own rows carry a daily lastUpdated, so a shorter TTL buys refreshes nothing downstream can see"
);
check(
  "the calendar uses the DAILY ttl",
  /writeReference\(`earnings-calendar:\$\{key\}`, result\.rows, REFERENCE_TTL_DAILY_SECONDS\)/.test(cal),
  "a monthly TTL would hold a stale trigger for a month"
);

console.log("\n=== 4. The store's own rules ===\n");

check(
  "a read failure returns null rather than throwing",
  /catch \{[\s\S]{0,120}return null;/.test(cache),
  "the caller refetches; a throw here would take out the calendar entirely"
);
check(
  "the client passes PAGE_READ_CACHE",
  /Redis\.fromEnv\(PAGE_READ_CACHE\)/.test(cache),
  "the earnings calendar is reached from page render paths"
);

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\nFAILED (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
