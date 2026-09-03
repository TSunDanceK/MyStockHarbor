// A limit that is never sent, and a page cap read as a month.
//
// WHAT HAPPENED. lib/server/earningsCalendar.ts fetched a whole month of
// earnings dates and sent NO `limit`, so it got FMP's default page. The
// concentration probe run on 2026-09-03 read 2026-01 as 1,655 rows and 2026-02
// as EXACTLY 4,000 -- and an exact round number out of an endpoint that was
// sent no limit is a page cap, not a February. Every figure derived from it
// (93.4% of reports in the busiest 20 trading days, 710 symbols on the peak
// day, 190/380 implied refreshes at 1,500/3,000) is a FLOOR.
//
// It is probe Q1 one endpoint over: SCREENER_LIMIT sat at 1000 because nobody
// had tried raising it, and the coverage floor the whole plan reasoned from was
// wrong by an order of magnitude.
//
// TWO RULES, AND THE SECOND IS THE ONE THAT WOULD HAVE CAUGHT IT:
//
//   the limit must actually be SENT -- "a limit that was never sent silently
//   capped a measurement, and the same mistake in the fix would be worse than
//   the original"
//
//   a response AT the limit must be treated as truncated -- because the first
//   failure was not that the cap existed, it was that 4,000 exactly went past
//   a reader unremarked
//
// And a third, from the decision that rests on all of it: the pass count must
// be DERIVED from peak demand and the per-run ceiling. A hand-typed
// `15,27,39 7 * * *` encodes "3" with no link to the arithmetic that produced
// it -- the PRICE_TARGET_RUNS shape this rebuild removed once already.
//
//   node scripts/check-earnings-calendar-limit.mjs
import ts from "typescript";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const calendar = readCodeOnly("lib/server/earningsCalendar.ts");
const plan = readCodeOnly("lib/server/earningsPlan.ts");
const probe = readCodeOnly("app/api/debug/earnings-calendar-limit/route.ts");
const store = readCodeOnly("lib/server/earningsStore.ts");

const lift = async (src, extra = "") => {
  const js = ts.transpileModule(`${extra}\n${src}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
};

const num = (src, name) =>
  Number(
    Function(
      `"use strict"; return (${(src.match(new RegExp(`${name} = ([0-9_ *]+);`)) ?? [])[1] ?? "0"});`
    )()
  );

const limit = num(calendar, "EARNINGS_CALENDAR_LIMIT");
const ttlDay = num(store, "EARNINGS_TTL_DAY");
const nearTtl = num(store, "EARNINGS_TTL_NEAR_REPORT_SECONDS");
// BRACE-MATCHED, NOT `[\s\S]*?\n\}`. planEarningsDay takes an inline object
// type, so its parameter list closes with `}): EarningsDayPlan | null {` -- a
// brace in column 0 several lines BEFORE the function body starts. The lazy
// form stopped there and lifted a signature fragment, and the module then
// exported no such function. That is the same failure this repo has now seen
// four times, and it is only ever caught by the assertion below blowing up
// rather than passing.
// TYPES ERASED FIRST, THEN BRACE-MATCHED. Locating a function body in
// TypeScript source by looking for braces failed twice here in one sitting:
// `[\s\S]*?\n\}` stopped at planEarningsDay's inline PARAMETER type, which
// closes with `}): ... {` in column 0; brace-matching from the first `{` after
// the parameter list then stopped at compareSets' inline RETURN type,
// `): { added: number; ... }`. Both produced a signature fragment that
// transpiled to a module exporting nothing -- and a lift that silently exports
// nothing is an assertion that cannot fail.
//
// A TS signature can contain any number of balanced brace groups, so no rule
// over the ANNOTATED text is safe. The emitted JS has none of them:
// `function planEarningsDay(input) {`. So each file is transpiled once and the
// functions are taken from the output.
const erase = (src) =>
  ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  }).outputText;

const grabFunction = (tsSrc, name) => {
  const src = erase(tsSrc);
  const start = src.indexOf(`export function ${name}(`);
  if (start === -1) return null;
  const bodyStart = src.indexOf("{", src.indexOf(")", start));
  if (bodyStart === -1) return null;
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
};

const truncFn = grabFunction(calendar, "isTruncatedMonth");
const perFn = grabFunction(plan, "fetchesPerReport");
const planFn = grabFunction(plan, "planEarningsDay");

if (!limit || !ttlDay || !nearTtl || !truncFn || !perFn || !planFn) {
  console.error(
    `FAIL: could not read EARNINGS_CALENDAR_LIMIT (${limit}), EARNINGS_TTL_DAY ` +
      `(${ttlDay}), EARNINGS_TTL_NEAR_REPORT_SECONDS (${nearTtl}), or extract ` +
      `isTruncatedMonth (${!!truncFn}) / fetchesPerReport (${!!perFn}) / ` +
      `planEarningsDay (${!!planFn}). This script would otherwise pass by ` +
      `measuring nothing.`
  );
  process.exit(1);
}

// ── 1. The limit is sent ───────────────────────────────────────────────────
console.log("\n1. The limit reaches the URL, which is the whole defect");

check(
  "the earnings-calendar fetch sends the limit",
  /earnings-calendar\?from=\$\{from\}&to=\$\{to\}&limit=\$\{limit\}&apikey=/.test(calendar),
  `EARNINGS_CALENDAR_LIMIT is ${limit} — this PR exists because a limit that ` +
    `was never sent silently capped a measurement, so the same mistake in the ` +
    `fix would be worse than the original`
);
check(
  "the value sent is the constant, or an explicit override",
  /const limit = options\.limit \?\? EARNINGS_CALENDAR_LIMIT;/.test(calendar),
  "the probe passes its own limits; everything else gets the one constant, so " +
    "there is no second place a page cap can be decided"
);
check(
  "the limit is well clear of the cap that truncated the measurement",
  limit >= 2 * 4000,
  `${limit} against the observed 4,000 — a value that merely nudges past the ` +
    `cap answers nothing when the truth is 8,000, and isTruncatedMonth is what ` +
    `says so if even this is short`
);

// ── 2. A full page is not a measurement ────────────────────────────────────
console.log("\n2. A response AT the limit is truncated, not complete");

const trunc = await lift(truncFn, `const EARNINGS_CALENDAR_LIMIT = ${limit};`);
check(
  "exactly the limit reads as truncated",
  trunc.isTruncatedMonth(limit) === true && trunc.isTruncatedMonth(4000, 4000) === true,
  "4,000 out of 4,000 is a page cap, not a February — the number was sitting in " +
    "a probe result and was read as a month"
);
check(
  "more than the limit is truncated too",
  trunc.isTruncatedMonth(limit + 1) === true,
  ">= rather than ===: if FMP's own default is lower than ours and wins, the " +
    "count never equals ours, and a response larger than we asked for is its " +
    "own kind of wrong"
);
check(
  "a short month is not",
  trunc.isTruncatedMonth(1655) === false && trunc.isTruncatedMonth(limit - 1) === false,
  "1,655 rows for 2026-01 is what an untruncated month looks like — the gate " +
    "must not fire on every month or it is an off switch"
);
check(
  "a nonsense count or limit refuses to vouch for the month",
  trunc.isTruncatedMonth(NaN) === true &&
    trunc.isTruncatedMonth(100, 0) === true &&
    trunc.isTruncatedMonth(100, NaN) === true,
  "absence is a reason to distrust the month, never a pass — the recurring " +
    "defect in this repo is a missing value reading as health"
);
check(
  "a full page is logged where the fetch happens",
  /if \(isTruncatedMonth\(rows\.length, limit\)\) \{/.test(calendar) &&
    /console\.warn\(/.test(calendar),
  "the first failure was not that the cap existed, it was that nobody noticed " +
    "the number; a signal nothing emits is a signal nobody reads"
);

// ── 3. The pass count is derived, not typed ────────────────────────────────
console.log("\n3. The pass count comes from arithmetic, not from a cron string");

const planMod = await lift(`${perFn}\n${planFn}`);
const DAY = 24 * 60 * 60;

check(
  "one report costs two fetches at the live daily cadence",
  planMod.fetchesPerReport(DAY, ttlDay, nearTtl) === 2,
  `run period ${DAY / 3600}h, lead ${ttlDay / 3600}h, near-report TTL ` +
    `${nearTtl / 3600}h — the long TTL expires one day before the report, the ` +
    `next run refetches, and the run after that catches the date passing`
);
check(
  "and three if the job ever runs twice a day",
  planMod.fetchesPerReport(DAY / 2, ttlDay, nearTtl) === 3,
  "which is the point of deriving it: a number typed as 'x2' would not have " +
    "moved when the cadence did, and that is the PRICE_TARGET_RUNS failure"
);
check(
  "runs more frequent than the near-report TTL do not add fetches",
  planMod.fetchesPerReport(DAY / 8, ttlDay, nearTtl) ===
    planMod.fetchesPerReport(nearTtl, ttlDay, nearTtl),
  "whichever of the two is longer gates the refetch — a run that finds the key " +
    "still warm does nothing, and counting it would overstate demand"
);
check(
  "a missing input refuses to answer rather than guessing one fetch",
  Number.isNaN(planMod.fetchesPerReport(0, ttlDay, nearTtl)) &&
    Number.isNaN(planMod.fetchesPerReport(DAY, NaN, nearTtl)),
  "returning 1 would make every plan below look comfortably affordable"
);

const planAt = (universeSize, peakDayShare, callsPerRun) =>
  planMod.planEarningsDay({
    universeSize,
    peakDayShare,
    callsPerRun,
    runPeriodSeconds: DAY,
    leadSeconds: ttlDay,
    nearReportTtlSeconds: nearTtl,
  });

// THE FIXTURE IS THE ACTUAL 2026-09-03 RUN, and getting it wrong the first time
// is worth recording: I used 710/4,000 -- the peak day over the RAW ROW COUNT --
// and the denominator is total symbol-days after de-duplication and weekday
// filtering, not rows. The run's own output settles it: impliedPeakDayRefreshes
// was 190 at 1,500 and 380 at 3,000, so the share it measured is 190/1500 =
// 380/3000 = 0.1267. Reading a share off the wrong denominator moved the answer
// by a whole extra pass at both sizes.
//
// STILL A FLOOR. 2026-02 was truncated at 4,000, so the true peak share can
// only be higher than this.
const TRUNCATED_PEAK_SHARE = 190 / 1500;

// THE CEILING IS READ FROM THE ROUTE, not typed as 440. It is itself derived
// from three constants there and asserted by check-earnings-minute-wall.mjs;
// typing it here would be the same magic number one file over.
const earnings = readCodeOnly("app/api/jobs/warm-earnings/route.ts");
const history = readCodeOnly("lib/server/historyCache.ts");
const CEILING = Math.floor(
  (num(history, "FMP_SAFE_CALLS_PER_MINUTE") - num(earnings, "EARNINGS_MIN_HEADROOM_CALLS")) *
    (num(earnings, "EARNINGS_RUN_BUDGET_MS") / 60_000)
);
if (!CEILING) {
  console.error("FAIL: could not derive the per-run ceiling — measuring nothing.");
  process.exit(1);
}
const smallest = planAt(762, TRUNCATED_PEAK_SHARE, CEILING);
const mid = planAt(1500, TRUNCATED_PEAK_SHARE, CEILING);
const large = planAt(3000, TRUNCATED_PEAK_SHARE, CEILING);

check(
  "the peak run is charged for both fetches, not one",
  smallest.callsOnPeakRun === smallest.peakDayReporters * 2,
  `${smallest.peakDayReporters} reporters -> ${smallest.callsOnPeakRun} calls — ` +
    `fetch 1 for a symbol reporting on D lands on the run of D-1 and fetch 2 on ` +
    `the run of D, so the busiest run carries two days' work`
);
check(
  "one pass covers 762 and 1500, and does not cover 3000",
  smallest.onePassSuffices === true &&
    mid.onePassSuffices === true &&
    large.onePassSuffices === false &&
    large.passesNeeded === 2,
  `762 -> ${smallest.callsOnPeakRun} calls, 1500 -> ${mid.callsOnPeakRun}, ` +
    `3000 -> ${large.callsOnPeakRun}, against a ${CEILING}/run ceiling. ` +
    `1500 sits at ${Math.round((mid.callsOnPeakRun / CEILING) * 100)}% of it ON ` +
    `TRUNCATED DATA, so a true measurement can push 1500 over on its own`
);
// THE HEADROOM AT 1,500 IS THE ANSWER'S WEAK POINT, so it is asserted rather
// than mentioned. The 3,000 verdict is safe -- it fails by more than the
// truncation could plausibly close in the other direction -- but the 1,500
// verdict rests on 380 of 440, and the measurement behind it is a floor.
check(
  "1500's margin is thin enough that the true measurement can overturn it",
  mid.callsOnPeakRun / CEILING > 0.75,
  `${mid.callsOnPeakRun}/${CEILING} — a peak share only ` +
    `${(CEILING / mid.callsOnPeakRun).toFixed(2)}x the truncated one puts 1500 ` +
    `into two passes, and February was cut off at exactly 4,000 rows. Recommend ` +
    `one pass at 1500 only once the untruncated month has been read`
);
// EXACTLY AT THE CEILING, AND ONE REPORTER PAST IT. 220 reporters cost 440
// calls, which is the ceiling exactly and must still be one pass; 221 cost 442
// and must be two.
check(
  "the pass count is a ceiling division, exact at the boundary",
  planAt(1000, CEILING / 2 / 1000, CEILING).passesNeeded === 1 &&
    planAt(1000, (CEILING / 2 + 0.1) / 1000, CEILING).passesNeeded === 2,
  `${CEILING / 2} reporters = ${CEILING} calls is one pass; one more is two. ` +
    `Off-by-one here is a season of silent shortfall`
);
check(
  "the batch a pass would need is reported with the pass count",
  large.batchPerPass === Math.ceil(large.callsOnPeakRun / large.passesNeeded) &&
    large.batchPerPass <= CEILING,
  `${large.batchPerPass} per pass at 3,000 — a pass count without the batch it ` +
    `implies is half an answer, and the half that gets typed into a cron`
);
check(
  "demand scales with the universe",
  mid.callsOnPeakRun > smallest.callsOnPeakRun &&
    large.callsOnPeakRun > mid.callsOnPeakRun,
  "the whole question is where the wall lands between 762, 1500 and 3000"
);
check(
  "a missing measurement produces no plan rather than a reassuring one",
  planAt(1500, 0, CEILING) === null && planAt(0, 0.1, CEILING) === null,
  "a peak share of zero is what an unmeasured or truncated-to-nothing month " +
    "gives, and it would otherwise read as 'one pass is plenty'"
);

// ── 4. The probe can actually answer the question ──────────────────────────
console.log("\n4. The probe compares sets, not just counts");

// RUN, NOT GREPPED. The first version of these two asserted that the
// comparison loop and the verdict strings EXISTED -- and both survived a
// mutation that threw the result away (`vsBaseline = null`) or bypassed the
// branch entirely (`if (false)`). Two assertions that could not fail, in the
// file whose whole subject is a number nobody checked. Both are pure exported
// functions now, so the claim is about behaviour.
// LIFTED AS TYPESCRIPT, unmodified. The first attempt regex-stripped the type
// annotations before transpiling and mangled the source into a module that
// exported nothing -- transpileModule erases types without needing them to
// resolve, so `Pick<Probe, ...>` referring to a type left behind in the route
// is fine. Rewriting source to make it liftable is how a fixture stops being
// the code it claims to test.
const probeMod = await lift(
  `${grabFunction(probe, "compareSets")}\n${grabFunction(probe, "verdictFor")}`
);
const setOf = (...keys) => new Set(keys);
check(
  "a larger set that ADDS rows is reported as added, not just bigger",
  (() => {
    const r = probeMod.compareSets(setOf("A|1"), setOf("A|1", "B|2"));
    return r.added === 1 && r.removed === 0 && r.identical === false;
  })(),
  "this is what a limit being honoured looks like: strictly more of the same month"
);
check(
  "an identical set is identical even though nothing about the size says so",
  probeMod.compareSets(setOf("A|1", "B|2"), setOf("B|2", "A|1")).identical === true,
  "a 200 that ignores the parameter returns the same rows — 'the count did not " +
    "change' and 'the endpoint ignored me' are different claims, and only the " +
    "set separates them"
);
check(
  "a same-SIZE different SLICE is not identical",
  (() => {
    const r = probeMod.compareSets(setOf("A|1", "B|2"), setOf("A|1", "C|3"));
    return r.identical === false && r.added === 1 && r.removed === 1;
  })(),
  "a server-side hard cap can return the same count from a different window, " +
    "and comparing counts alone would call that 'ignored'"
);
check(
  "it flags a count that lands exactly on its own limit",
  /probe\.looksCapped = limit > 0 && rows\.length === limit;/.test(probe),
  "otherwise raising the limit and hitting a higher cap reads as success"
);
check(
  "it reports bytes, from the raw text",
  /const text = await res\.text\(\);/.test(probe) && /probe\.bytes = text\.length;/.test(probe),
  "the answer decides what a daily reference-cache write carries; measuring a " +
    "re-serialised object instead of the transfer would understate it"
);
check(
  "it goes to FMP rather than through the cached month",
  /cache: "no-store"/.test(probe) && !/fetchMonthRows/.test(probe),
  "the reference key holds a 24h TTL, so a probe reading it would measure the " +
    "cache and report on the endpoint"
);
const P = (rows, looksCapped = false, identical = null) => ({
  rows,
  looksCapped,
  vsBaseline: identical === null ? null : { added: 0, removed: 0, identical },
});
check(
  "identical sets at every limit -> limit-ignored",
  probeMod.verdictFor([P(4000), P(4000, false, true), P(4000, false, true)]).startsWith(
    "limit-ignored"
  ),
  "which is the world where the answer is date slicing, and that is a different " +
    "change — saying so is the deliverable, not a disappointment"
);
check(
  "the biggest probe landing on its own limit -> still truncated",
  probeMod
    .verdictFor([P(4000), P(4000, true, false), P(10000, true, false)])
    .startsWith("hard-cap-or-still-truncated"),
  "otherwise raising the limit and hitting a HIGHER cap reads as success — the " +
    "original failure repeated one order of magnitude up"
);
check(
  "a count that moves and stops short of its limit -> honoured",
  probeMod
    .verdictFor([P(4000), P(4000, true, false), P(7318, false, false)])
    .startsWith("limit-honoured"),
  "the row count moves with the parameter and the largest probe is under its " +
    "own limit, so it is a whole month"
);
check(
  "nothing came back -> nothing is established",
  probeMod.verdictFor([P(null), P(0)]).startsWith("no-data"),
  "an all-failed probe must not fall through to a reassuring verdict; that is " +
    "the absence-read-as-health defect this repo keeps finding"
);

console.log(
  failures === 0
    ? "\nThe limit is sent, a full page is not a measurement, and the passes are derived.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
