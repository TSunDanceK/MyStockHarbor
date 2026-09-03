// What one /earnings-calendar view costs in Redis commands.
//
// THE PAGE IS NOT AN FMP PROBLEM. The window self-limits: once it is filled,
// populateNextMissingDate finds nothing and QUOTE_HOURLY_CAP bounds the filling
// globally. It is a REDIS AND LAMBDA problem, and Redis command volume is what
// suspended the database on 2026-08-28.
//
// COUNTED PER REQUEST, steady state, cold instance, BEFORE:
//
//   getMonthDaysWithEarnings  2   month rows + the stock-list name map
//   loadDay                   2   day items + the completeness marker
//   isDateFullyPopulated      1   the SAME marker, read a second time
//   getUpcomingTickerItems   14   TICKER_DAYS_AHEAD x readDayItemsCache
//   after(): populate         3   hour usage, fill frontier, frontier re-park
//                            --
//                            22
//
// AFTER: 21 cold (the duplicate marker read is gone) and ONE on a warm instance
// inside the memo window -- the failed SET NX on the scan gate. The point of
// the PR is the second number: a page that cost the same for the thousandth
// visitor as the first now costs one command.
//
// A CORRECTION TO THE BRIEF, since it changes what item 2 was for: the after()
// scan does NOT walk the ~95-day window when there is nothing to do. Once the
// frontier is parked past the window end, findNextIncompleteDate's loop runs
// zero times, so the short-circuit is three commands. The gate is about the
// THUNDERING HERD when the window rolls forward and every concurrent visitor
// starts filling it at once.
//
//   node scripts/check-earnings-calendar-cost.mjs
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const page = readCodeOnly("app/earnings-calendar/page.tsx");
const cal = readCodeOnly("lib/server/earningsCalendar.ts");

console.log("\n1. The fourteen ticker reads happen once per instance, not per view");

const memoFn = grabFunction(page, "readMemo");
const ttl = Number(
  Function(
    `"use strict"; return (${(page.match(/TICKER_MEMO_MS = ([0-9 *_]+);/) ?? [])[1] ?? "0"});`
  )()
);
if (!memoFn || !ttl) {
  console.error(
    `FAIL: could not extract readMemo (${!!memoFn}) or TICKER_MEMO_MS (${ttl}) — ` +
      `this script would otherwise pass by measuring nothing.`
  );
  process.exit(1);
}
const memo = await lift(memoFn);
const NOW = 1_800_000_000_000;
const held = { key: "2026-09-04", at: NOW, value: [{ symbol: "AAPL" }] };

check(
  "a hit inside the window returns the held value",
  memo.readMemo(held, "2026-09-04", NOW + ttl - 1, ttl)?.length === 1,
  `${ttl / 60_000} minutes — fourteen Redis GETs for a strip of upcoming names, ` +
    `identical for every visitor on a given day, was paid per request`
);
check(
  "a DIFFERENT day misses, rather than serving the wrong day",
  memo.readMemo(held, "2026-09-05", NOW, ttl) === null,
  "a memo that answers for a key it does not hold serves the wrong day's " +
    "earnings — a wrong answer, not a stale one"
);
check(
  "an expired entry misses",
  memo.readMemo(held, "2026-09-04", NOW + ttl, ttl) === null,
  ">= rather than >, so the boundary expires rather than lingering a request"
);
check(
  "no memo at all misses",
  memo.readMemo(null, "2026-09-04", NOW, ttl) === null,
  "the first request on a cold instance has to do the work"
);
check(
  "an unusable clock OR an unusable TTL misses rather than serving forever",
  memo.readMemo(held, "2026-09-04", NaN, ttl) === null &&
    memo.readMemo(held, "2026-09-04", NOW, undefined) === null,
  "`nowMs - at >= undefined` is false, so a missing TTL made the memo serve " +
    "forever — this assertion found that by calling readMemo with three " +
    "arguments instead of four, which is how the fail-open surfaced at all"
);
check(
  "an empty result is not memoised",
  /if \(items\.length\) tickerMemo =/.test(page),
  "an empty ticker is what a Redis blip returns, and holding it for five " +
    "minutes turns one bad read into five minutes of an empty strip"
);

console.log("\n2. The completeness marker is read once, not twice");

check(
  "the page shares one read between the render and the flag",
  /const loadDayComplete = cache\(/.test(page) &&
    /loadDayComplete\(selectedDate\),/.test(page) &&
    !/\n\s*isDateFullyPopulated\(selectedDate\),/.test(page),
  "getFullDayEarnings already reads the marker internally and the page read it " +
    "again through isDateFullyPopulated — two GETs for one fact"
);

console.log("\n3. The background scan runs once per window, not once per visitor");

const gateFn = grabFunction(cal, "claimCalendarScan");
const gateTtl = Number(
  Function(
    `"use strict"; return (${
      (cal.match(/CALENDAR_SCAN_GATE_SECONDS = ([0-9 *]+);/) ?? [])[1] ?? "0"
    });`
  )()
);
if (!gateFn || !gateTtl) {
  console.error("FAIL: could not extract claimCalendarScan or its TTL — measuring nothing.");
  process.exit(1);
}
const store = new Map();
globalThis.__CAL_GATE_STORE = store;
const gate = await lift(
  gateFn,
  `const CALENDAR_SCAN_GATE_KEY = "k";
const CALENDAR_SCAN_GATE_SECONDS = ${gateTtl};
const redis = {
  set: async (key, value, opts) => {
    if (opts && opts.nx && globalThis.__CAL_GATE_STORE.has(key)) return null;
    globalThis.__CAL_GATE_STORE.set(key, value);
    return "OK";
  },
};`
);
const first = await gate.claimCalendarScan(NOW);
const second = await gate.claimCalendarScan(NOW);
check(
  "one caller wins the scan and the next does not",
  first === true && second === false,
  `${gateTtl / 60} minutes — the window moves once a day, so 288 scans a day ` +
    `instead of one per visitor is already the whole win`
);
const noRedis = await lift(gateFn, `const CALENDAR_SCAN_GATE_KEY = "k";
const CALENDAR_SCAN_GATE_SECONDS = ${gateTtl};
const redis = null;`);
check(
  "with no Redis the gate fails CLOSED",
  (await noRedis.claimCalendarScan(NOW)) === false,
  "without a shared marker there is nothing to serialise on, and an ungated " +
    "scan is what this exists to stop"
);
check(
  "the after() block returns when it loses the claim",
  /if \(!\(await claimCalendarScan\(\)\)\) return;/.test(page),
  "the gate has to stop the WORK, not merely be consulted before doing it"
);

// AND THE CLAIM IS THE FIRST THING IN THE BLOCK, or the herd has already done
// the reads by the time it is asked.
const afterIdx = page.indexOf("after(async () => {");
const claimIdx = page.indexOf("claimCalendarScan()", afterIdx);
const workIdx = page.indexOf("getFullDayEarnings(selectedDate", afterIdx);
check(
  "...and it is claimed before any of the work",
  afterIdx !== -1 && claimIdx !== -1 && workIdx !== -1 && claimIdx < workIdx,
  `claim at ${claimIdx}, first work at ${workIdx} — a gate consulted after the ` +
    `fill has already run is a counter, not a gate`
);

console.log(
  failures === 0
    ? "\nThe fourteen reads are memoised, the marker is read once, and the scan is gated.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
