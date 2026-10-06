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
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const page = readCodeOnly("app/earnings-calendar/page.tsx");
const cal = readCodeOnly("lib/server/earningsCalendar.ts");

console.log("\n1. The fifty forward-section reads happen once per instance, not per view");

const memoFn = grabFunction(page, "readMemo");
const ttl = Number(
  Function(
    `"use strict"; return (${(page.match(/FORWARD_MEMO_MS = ([0-9 *_]+);/) ?? [])[1] ?? "0"});`
  )()
);
if (!memoFn || !ttl) {
  console.error(
    `FAIL: could not extract readMemo (${!!memoFn}) or FORWARD_MEMO_MS (${ttl}) — ` +
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
  `${ttl / 60_000} minutes — FIFTY Redis GETs for the committed cut's report-date ` +
    `records, identical for every visitor on a given day, would otherwise be paid ` +
    `per request. The ticker this memo used to guard cost fourteen; the due strip ` +
    `and the expected section that replaced it cost fifty, read once for both.`
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
  "a FAILED result is not memoised",
  /if \(value\.due\.kind !== "unavailable"\) \{\s*\n\s*forwardMemo =/.test(page),
  "the same rule the ticker memo carried, against a stronger test. The ticker " +
    "guarded on `items.length`, which cannot tell an empty read from a failed " +
    "one; the forward sections carry that distinction in the state itself, so " +
    "the guard now checks the thing that actually means 'we could not answer'. " +
    "Holding THAT for five minutes turns one bad read into five minutes of a " +
    "page telling every visitor it cannot answer"
);

console.log("\n2. The completeness marker is not read at all, and the figures are one MGET");

// SINCE THE WEEK PAGE (#552 COWORK #170) the rows are the day's candidates
// from the month index, so the day blob and its completeness marker (once
// read twice per render) are not read by the render at all; and the row
// figures for all seven days come back in one MGET, not per day or per row.
check(
  "the render reads no completeness marker, and no day blob",
  !/isDateFullyPopulated\(|loadDayComplete\(|getDayEarningsForRender\(|getCachedDayItems\(/.test(page),
  "the grid's per-day reads went with the grid"
);
{
  const store = fs.readFileSync("lib/server/earningsWeekStore.ts", "utf8");
  const fn = store.slice(store.indexOf("export async function readWeekFigures"), store.indexOf("/** What one symbol needs filled"));
  const oneMget = (src) => (src.match(/await redis\./g) ?? []).length === 1 && /await redis\.mget</.test(src);
  check("the strip's 14 figure keys are one MGET", oneMget(fn) && /readWeekFigures\(days\)/.test(page));
  check("MUTATION: a GET per day → caught",
    !oneMget(fn.replace("const vals = await redis.mget<unknown[]>(...keys);", "const vals = await Promise.all(keys.map((k) => redis.get(k)));")));
}

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
// ANCHORED ON THE CALL, NOT ON THE BARE NAME. `"claimCalendarScan()"` also
// matches a DECLARATION of the same function, so an anchor written that way is
// only correct while the declaration happens to sit outside the searched range
// -- which is a property of where the code is today, not of what is asserted.
// Ten defects have been caught in the failing direction here and this shape was
// the last of them; scripts/check-assertion-anchors.mjs now fails the build on
// it rather than leaving it to review.
const afterIdx = page.indexOf("after(async () => {");
const claimIdx = page.indexOf("await claimCalendarScan()", afterIdx);
const workIdx = page.indexOf("await fillWeekFigures(", afterIdx);
check(
  "...and it is claimed before any of the work",
  afterIdx !== -1 && claimIdx !== -1 && workIdx !== -1 && claimIdx < workIdx,
  `claim at ${claimIdx}, first work at ${workIdx} — a gate consulted after the ` +
    `fill has already run is a counter, not a gate`
);

// ── THE CUT IN ONE MGET (#552 COWORK #181) ──────────────────────────────
// Widened to 200 (#552 COWORK #186), one GET per record would be 200 commands
// a build. The forward sections read them in one MGET, and a failed MGET is
// "we could not read", never 200 filers with no record.
{
  const due = readCodeOnly("lib/server/dueInputs.ts");
  const fwd = grabFunction(due, "getCalendarForwardSections") ?? "";
  const bulkRule = (src) => /await readReportDatesBulk\(DUE_STRIP_CUT\)/.test(src) && !/readReportDates\(/.test(src);
  check("the forward sections read the cut in one bulk read, no per-symbol GET", bulkRule(fwd));
  check("MUTATION: back to one GET per symbol → caught",
    !bulkRule(fwd.replace("await readReportDatesBulk(DUE_STRIP_CUT)", "await Promise.all(DUE_STRIP_CUT.map((s) => readReportDates(s)))")));
  check("a failed bulk read resolves both sections to 'unavailable'",
    /if \(!read\.ok\) \{[\s\S]*?manifestRead: false[\s\S]*?expected: \{ kind: "unavailable" \}/.test(fwd));

  const store = readCodeOnly("lib/server/secReportDatesStore.ts");
  const bulk = grabFunction(store, "readReportDatesBulk") ?? "";
  const load = (src) => lift(`const reportDatesKey = (s) => "k:" + s;\n${src.replace(/^export /, "")}\nexport { readReportDatesBulk };`);
  const run = async (src, stub) => { globalThis.__redis = stub; return (await load(src.replace(/\bredis\b/g, "globalThis.__redis"))).readReportDatesBulk(["A", "B", "C"]); };
  let calls = 0;
  const good = await run(bulk, { mget: async (...keys) => { calls++; return keys.map((k) => (k === "k:B" ? null : { events: [] })); } });
  check("one MGET for three records, a missing one null", calls === 1 && good.ok && good.recs.get("A") !== null && good.recs.get("B") === null, `calls ${calls}`);
  const bad = await run(bulk, { mget: async () => { throw new Error("down"); } });
  check("a thrown MGET is ok:false, not three nulls", bad.ok === false);
  const folded = bulk.replace(/(bulk read failed[^\n]*\n\s*)return \{ ok: false \};/, "$1return { ok: true, recs: new Map() };");
  const swallowed = await run(folded, { mget: async () => { throw new Error("down"); } }).catch(() => ({ ok: false }));
  check("MUTATION: the failure folded into an empty set → caught", folded !== bulk && swallowed.ok === true);
}

console.log(
  failures === 0
    ? "\nThe forward reads (one MGET of the cut) are memoised, the render reads no marker, and the scan is gated.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
