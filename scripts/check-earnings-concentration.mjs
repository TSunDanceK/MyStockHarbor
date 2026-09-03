// The season measurement has to be a measurement.
//
// WHY THIS IS CHECKED AT ALL. Nothing renders from this route -- it exists to
// produce ONE number that EARNINGS_BATCH_SIZE will then be sized on. That makes
// a quiet arithmetic error more expensive than a rendering bug: a rendering bug
// is visible, and a mis-sized constant just underperforms forever while looking
// deliberate. Every estimate this rebuild leaned on has been wrong ($5.7B vs a
// measured $9.66B floor; 23% vs 75% price-derived; the cap vs the minute
// guard), so the replacement for the estimate is worth asserting.
//
// THE TWO WAYS IT COULD LIE, both asserted below by RUNNING it:
//
//   COUNTING ROWS INSTEAD OF SYMBOL-DAYS. earnings-calendar routinely repeats a
//   symbol on one date, so a row count overstates the peak -- in the direction
//   that makes the batch look bigger than it needs to be.
//
//   READING AN EMPTY MONTH AS A FLAT ONE. fetchMonthRows returns [] for a 402,
//   a network failure and a genuinely empty month alike. A distribution built
//   on nothing is beautifully flat and means nothing.
//
//   node scripts/check-earnings-concentration.mjs
import ts from "typescript";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const route = readCodeOnly("app/api/debug/earnings-concentration/route.ts");
const distributeFn = (route.match(/function distribute\([\s\S]*?\n\}/) ?? [])[0];
const weekdayFn = (route.match(/function isWeekday\([\s\S]*?\n\}/) ?? [])[0];
if (!distributeFn || !weekdayFn) {
  console.error(
    `FAIL: could not extract distribute (${!!distributeFn}) or isWeekday ` +
      `(${!!weekdayFn}) — this script would otherwise pass by measuring nothing.`
  );
  process.exit(1);
}

const js = ts.transpileModule(`${weekdayFn}\nexport ${distributeFn}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;
const { distribute } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);

const pair = (symbol, date) => ({ symbol, date });
const SIZES = [1500, 3000];

console.log("\n1. It counts companies reporting, not rows returned");

const duped = distribute(
  "t",
  [pair("AAPL", "2026-01-15"), pair("AAPL", "2026-01-15"), pair("MSFT", "2026-01-15")],
  SIZES
);
check(
  "a symbol repeated on one date counts once",
  duped.busiestDay?.symbols === 2 && duped.distinctSymbols === 2,
  `${duped.busiestDay?.symbols} on the peak day — the calendar repeats a ticker ` +
    `across rows, and counting rows overstates the peak in the direction that ` +
    `makes the batch look bigger than it needs to be`
);

const weekend = distribute(
  "t",
  [pair("AAPL", "2026-01-17"), pair("MSFT", "2026-01-18"), pair("NVDA", "2026-01-15")],
  SIZES
);
check(
  "weekend dates are not trading days",
  weekend.tradingDays === 1 && weekend.busiestDay?.date === "2026-01-15",
  `${weekend.tradingDays} trading day(s) — a Saturday in the denominator ` +
    `flattens the curve with days the job would never work`
);

console.log("\n2. The shares are of WORK, and the peak is the peak");

// Three days: 6, 3, 1 = 10 symbol-days. Busiest 1 = 60%, busiest 2 = 90%.
const shaped = distribute(
  "t",
  [
    ...["A", "B", "C", "D", "E", "F"].map((s) => pair(s, "2026-01-15")),
    ...["G", "H", "I"].map((s) => pair(s, "2026-01-16")),
    pair("J", "2026-01-20"),
  ],
  SIZES
);
check(
  "the day curve is returned busiest-first, whole",
  shaped.byDay.map((d) => d.symbols).join(",") === "6,3,1",
  `${shaped.byDay.map((d) => `${d.date}:${d.symbols}`).join(" ")} — the curve, ` +
    `not a summary of it, because "70% in 20 days" is a claim about its shape`
);
check(
  "the busiest-N share is over symbol-days, not over distinct companies",
  Math.abs((shaped.shareInBusiest10Days ?? 0) - 1) < 1e-9 &&
    shaped.busiestDay?.symbols === 6,
  `busiest-10 = ${shaped.shareInBusiest10Days} of 10 symbol-days — a symbol that ` +
    `reports twice in the window is two pieces of work, and the question is how ` +
    `much work lands on the busy days`
);
check(
  "the implied refresh count uses the PEAK day, not the average",
  shaped.impliedPeakDayRefreshes?.["1500"] === 900 &&
    shaped.impliedPeakDayRefreshes?.["3000"] === 1800,
  `${shaped.impliedPeakDayRefreshes?.["1500"]} at 1,500 — 60% of the window's ` +
    `work on one day. Sizing on the mean (33%) would leave the batch short on ` +
    `precisely the days it matters`
);
check(
  "and it scales linearly with the universe",
  (shaped.impliedPeakDayRefreshes?.["3000"] ?? 0) ===
    2 * (shaped.impliedPeakDayRefreshes?.["1500"] ?? 1),
  "the whole point of asking at 1,500 AND 3,000 is to see where the wall lands"
);

console.log("\n3. Nothing measured is not a flat distribution");

const empty = distribute("t", [], SIZES);
check(
  "no rows produces null shares, not zeroes",
  empty.shareInBusiest10Days === null &&
    empty.shareInBusiest20Days === null &&
    empty.impliedPeakDayRefreshes === null &&
    empty.busiestDay === null,
  "0% concentration reads as 'earnings are perfectly spread' — the most " +
    "reassuring possible answer, produced by having no data at all"
);
check(
  "the route reports which months came back empty, and says ok:false",
  /const emptyMonths = perMonth\.filter\(\(m\) => m\.rows === 0\)/.test(route) &&
    /ok: emptyMonths\.length === 0 && truncatedMonths\.length === 0,/.test(route) &&
    /warning:/.test(route),
  "fetchMonthRows returns [] for a 402, a network failure and an empty month " +
    "alike — and a 402 is the likely answer for half this plan's endpoints"
);
// A FULL PAGE IS THE SAME CLASS OF ERROR AS AN EMPTY ONE -- an absence read as
// an answer -- and it is the one that actually happened: 2026-02 came back at
// EXACTLY 4,000 rows and the distribution built on it was reported as a result
// rather than as a floor. `ok` has to fall for it too, or the next reader does
// what the last one did.
check(
  "a month at the page cap also costs ok:false, and is named",
  /const truncatedMonths = perMonth\.filter\(\(m\) => m\.truncated\)/.test(route) &&
    /truncated: isTruncatedMonth\(rows\.length\)/.test(route) &&
    /truncatedMonths,/.test(route),
  "an exact round row count out of an endpoint with a page cap is a cap, not a " +
    "February — and nobody compared those two numbers by eye the first time"
);
check(
  "and the re-measurement can get past the daily cache",
  /const bypassCache = url\.searchParams\.get\("fresh"\) === "1";/.test(route) &&
    /fetchMonthRows\(year, mon, \{ bypassCache \}\)/.test(route),
  "the reference key holds a 24h TTL, so a re-run after raising the limit would " +
    "read yesterday's truncated month and report that the fix did nothing — a " +
    "fix that looks like a failure for a day is how a correct change gets reverted"
);
check(
  "it measures the mega-caps separately from the whole tape",
  /distribute\(\s*"preset",/.test(route) && /presetSet\.has\(p\.symbol\)/.test(route),
  "the calendar is ~10k names the site never warms; large caps cluster in the " +
    "middle weeks of a season rather than spreading like the tail, so the two " +
    "curves can disagree and the preset one is the one to size against"
);
// NAMED IN PROSE IS FINE; ASSIGNED IS NOT. The first version of this tested the
// whole file for the constant's NAME and failed on the route's own `howToRead`
// string, which explains what the number is for. An assertion that forbids
// mentioning the thing being measured would push the explanation out of the
// route and into somebody's memory.
check(
  "it changes no constant and writes nothing of its own",
  !/EARNINGS_BATCH_SIZE\s*=/.test(route) &&
    !/Redis\.fromEnv|redis\.set|writeReference/.test(route),
  "the constant comes after the measurement, and a probe that edits what it " +
    "measures is not a probe. (fetchMonthRows still fills the shared " +
    "earnings-calendar reference cache — that is its own caching, and it is " +
    "what keeps this to at most one FMP call per month asked for.)"
);
// THE PROHIBITION BECAME A REQUIREMENT. This used to forbid the string
// "warm-earnings" outright, to keep the probe from touching the job it
// measures. That was right when the route only counted rows, and wrong the
// moment it started computing a pass count: the per-run ceiling has to be THE
// REAL ONE, and a probe that reads 440 from a literal would answer the growth
// question against a number nothing enforces.
check(
  "the per-run ceiling is imported from warm-earnings, not retyped",
  /import \{ EARNINGS_MAX_CALLS_PER_RUN \} from "\.\.\/\.\.\/jobs\/warm-earnings\/route";/.test(
    route
  ) && /callsPerRun: EARNINGS_MAX_CALLS_PER_RUN,/.test(route),
  "check-earnings-minute-wall.mjs already asserts that constant is derived from " +
    "FMP_SAFE_CALLS_PER_MINUTE, the headroom and the run budget — importing it " +
    "is what makes the plan inherit all four of those checks"
);
check(
  "and the run cadence comes from the registry, not from a typed 24h",
  /cronIntervalSeconds\(JOBS\["warm-earnings"\]\.cron\)/.test(route) &&
    /runPeriodSeconds,/.test(route),
  "check-cache-health-page.mjs asserts the registry cron matches vercel.json in " +
    "both directions, so the cadence cannot drift out from under the plan — " +
    "#374 moved a cron and stretched full price coverage from ~12 to ~20 " +
    "minutes with no line of code changing and nobody noticing for months"
);

console.log(
  failures === 0
    ? "\nThe season measurement measures something.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
