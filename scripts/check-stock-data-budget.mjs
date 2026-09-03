// warm-stock-data spans minutes, and its slice is a slice rather than a wall.
//
// THE SAME DEFECT, A THIRD TIME. lib/server/stockDataCache.ts did:
//
//     if (!(await hasFmpCapacity(callsForSymbol(...), FMP_MIN_HEADROOM_CALLS))) break;
//
// `break`, not wait -- what #396 fixed in warmPricePool and #406 fixed in
// warm-earnings. FMP_SAFE_CALLS_PER_MINUTE is 200 and this module's
// FMP_MIN_HEADROOM_CALLS is 90, so the usable rate is 110/min and the run
// stopped after 22 symbols on the clock-only path (110/5) or 13 when filings
// were due (110/8).
//
// WHICH MAKES "RAISE REFRESH_SLICE_SIZE 25 -> 40, FREE SINCE #400" A NO-OP.
// The slice was never the binding constraint: at 25 the run already exceeded
// the wall, and at 40 it would still have stopped at ~22. Raising the constant
// alone would have shipped a growth step that changed nothing, and the run
// record would have gone on looking healthy.
//
// So this asserts BOTH halves, and the arithmetic that ties them:
//
//   the run waits for the next bucket and ends on its OWN clock
//   the slice fits inside what that budget can actually reach
//
// RUN, NOT GREPPED. "It waits rather than breaking" is a claim about control
// flow over responses; a regex cannot tell a wait from a break, because both
// are a capacity call followed by a keyword.
//
//   node scripts/check-stock-data-budget.mjs
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const cache = readCodeOnly("lib/server/stockDataCache.ts");
const route = readCodeOnly("app/api/jobs/warm-stock-data/route.ts");
const history = readCodeOnly("lib/server/historyCache.ts");

const num = (src, name) =>
  Number(
    Function(
      `"use strict"; return (${(src.match(new RegExp(`${name} = ([0-9_ *]+);`)) ?? [])[1] ?? "0"});`
    )()
  );

const slice = num(cache, "REFRESH_SLICE_SIZE");
const budgetMs = num(cache, "STOCK_DATA_RUN_BUDGET_MS");
const pollMs = num(cache, "STOCK_DATA_BUDGET_POLL_MS");
const headroom = num(cache, "FMP_MIN_HEADROOM_CALLS");
const safePerMinute = num(history, "FMP_SAFE_CALLS_PER_MINUTE");
const maxDuration = num(route, "maxDuration");
const waitFn = grabFunction(cache, "waitForStockDataBudget");

if (!slice || !budgetMs || !pollMs || !headroom || !safePerMinute || !maxDuration || !waitFn) {
  console.error(
    `FAIL: could not read REFRESH_SLICE_SIZE (${slice}), the run budget (${budgetMs}), ` +
      `the poll (${pollMs}), the headroom (${headroom}), safe/min (${safePerMinute}), ` +
      `maxDuration (${maxDuration}) or extract waitForStockDataBudget (${!!waitFn}). ` +
      `This script would otherwise pass by measuring nothing.`
  );
  process.exit(1);
}

console.log("\n1. An exhausted minute is a pause, not the end of the run");

globalThis.__SD_CAPACITY = async () => true;
const waited = await lift(
  `export ${waitFn}`,
  `const FMP_MIN_HEADROOM_CALLS = ${headroom};
const STOCK_DATA_BUDGET_POLL_MS = 1;
const hasFmpCapacity = (...args) => globalThis.__SD_CAPACITY(...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));`
);
const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(`never-returned:${label}`), ms)),
  ]);

let calls = 0;
let asked = null;
globalThis.__SD_CAPACITY = async (n) => {
  asked = n;
  return ++calls > 3;
};
const ok = await withTimeout(waited.waitForStockDataBudget(8, Date.now() + 60_000), 5_000, "ok");
check(
  "a busy minute is waited out, not treated as the end of the slice",
  ok === "ok" && calls === 4,
  `${calls} capacity checks before proceeding — the old code took the first ` +
    `false as final, so the run stopped after ${Math.floor(
      (safePerMinute - headroom) / 8
    )} symbols when filings were due`
);
check(
  "and it asks for the count it was given, not a flat eight",
  asked === 8,
  "a symbol on the clock-only path costs five, and asking for eight would make " +
    "the run wait for room it is not going to spend"
);

calls = 0;
globalThis.__SD_CAPACITY = async () => {
  calls++;
  return false;
};
const past = await withTimeout(
  waited.waitForStockDataBudget(5, Date.now() - 1),
  2_000,
  "past"
);
check(
  "a run past its own deadline does end",
  past === "out-of-time" && calls === 1,
  "the run's clock is the ONLY thing that ends it — but it must actually end " +
    "it, or a permanently exhausted bucket is an infinite loop in a Lambda"
);

calls = 0;
const soon = await withTimeout(waited.waitForStockDataBudget(5, Date.now() + 40), 2_000, "soon");
check(
  "it polls repeatedly before giving up",
  soon === "out-of-time" && calls > 1,
  `${calls} checks — one check followed by "out-of-time" is the original break ` +
    `wearing a longer name`
);

console.log("\n2. The slice fits what the budget can reach");

const usable = safePerMinute - headroom;
const ceiling = Math.floor(usable * (budgetMs / 60_000));
const worstCasePerSymbol = 8;
check(
  "the run budget leaves a tail inside maxDuration",
  budgetMs < maxDuration * 1000,
  `${budgetMs / 1000}s of ${maxDuration}s — a run that spends all of it has ` +
    `nothing left for the pipeline write, the staleness bookkeeping and the ` +
    `response, and is killed mid-write`
);
check(
  "the slice fits inside the budget even when every symbol has filings due",
  slice * worstCasePerSymbol <= ceiling,
  `${slice} x ${worstCasePerSymbol} = ${slice * worstCasePerSymbol} against ` +
    `${usable}/min x ${budgetMs / 60_000}min = ${ceiling} calls. THIS is what makes ` +
    `${slice} a slice size rather than another wall: before the wait, the run ` +
    `stopped at ${Math.floor(usable / worstCasePerSymbol)} regardless of the constant`
);
check(
  "the slice is bigger than the wall it used to hit",
  slice > Math.floor(usable / 5),
  `${slice} against the old clock-only wall of ${Math.floor(usable / 5)} — a slice ` +
    `at or under it would be indistinguishable from the broken behaviour, and ` +
    `the raise would prove nothing`
);
check(
  "the loop waits and ends on the run's clock",
  /const runDeadlineMs = nowMs \+ STOCK_DATA_RUN_BUDGET_MS;/.test(cache) &&
    /=== "out-of-time"\) \{\n\s*outOfTime = true;\n\s*break;/.test(cache),
  "the deadline is computed once from the run's start; a per-symbol deadline " +
    "would give every symbol a fresh four minutes"
);

console.log("\n3. A zero can say which zero it is");

// ANCHORED ON THE SUMMARY CALL, not found by lastIndexOf. This route records
// TWICE -- the catch block writes `{ error: message }` and nothing else -- and
// lastIndexOf finds that one, so all three assertions below failed against a
// record that was never going to carry the fields. The same trap
// check-earnings-minute-wall documented and this file walked into anyway.
const recordIdx = route.indexOf('recordJobRun("warm-stock-data", result.ok !== false, {');
const recordCall = recordIdx === -1 ? "" : route.slice(recordIdx, route.indexOf("});", recordIdx));
check(
  "the record carries the stamp count and the slice it is out of",
  /\bquarterlyStamped: result\.quarterlyStamped/.test(recordCall) &&
    /\bsliceSize: result\.sliceSize/.test(recordCall),
  recordCall
    ? "quarterlyRefreshes has read 0 on every run since #400 and could not say " +
      "whether nothing was due or nothing happened. 0 with all stamped is " +
      "healthy; 0 with none stamped is not"
    : "sliced the wrong recordJobRun call — this route records twice, and the " +
      "catch block carries only an error string"
);
check(
  "...and how many of the slice the earnings index knew about",
  /\bscheduleCovered: result\.scheduleCovered/.test(recordCall),
  "scheduleSize is GLOBAL — a healthy 11,662-entry index can still cover none " +
    "of this slice, and then every symbol here rides the 120-day floor in silence"
);
check(
  "...and whether the run ended early",
  /\boutOfTime: result\.outOfTime/.test(recordCall),
  "without it, a run that ran out of budget and one that drained its slice " +
    "produce the same record — which is how the break stayed invisible"
);
check(
  "the counters are incremented once per slice symbol, before the wait",
  /if \(scheduledLast\) scheduleCovered\+\+;/.test(cache) &&
    /quarterlyStamped\+\+;/.test(cache) &&
    cache.indexOf("quarterlyStamped++") < cache.indexOf("waitForStockDataBudget(callsForSymbol"),
  "counted after the wait, they would describe only the symbols the run " +
    "reached — and on a capacity-bound run that is the subset that says least"
);

console.log(
  failures === 0
    ? "\nThe run spans minutes, the slice fits, and a zero says which zero it is.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
