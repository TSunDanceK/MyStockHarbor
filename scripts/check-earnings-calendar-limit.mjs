// A page cap that drops the oldest dates, and the slicing that answers it.
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
// #410 SENT A LIMIT AND THE PROBE ANSWERED: "limit-ignored: every limit
// returned the same rows". 0, 4,000, 10,000 and 20,000 all returned 4,000 rows
// and 821,701 bytes, identical sets. The parameter does nothing. Worse, the cap
// DROPS THE OLDEST DATES: a request for 2026-02-01..28 came back starting
// 2026-02-11, and nothing in the response said so.
//
// AND IT IS A PRODUCTION BUG, not a measurement one. fetchMonthRows feeds the
// earnings schedule index that decides when a symbol's fundamentals refresh, so
// a symbol reporting inside a dropped window never refreshes on filing -- it
// waits for QUARTERLY_FLOOR_DAYS. Dormant until January, because every month
// between now and then is under the cap.
//
// THE RULES THIS LOCKS DOWN:
//
//   a response AT the cap is split, not accepted -- RUN the splitter over a
//   fixture that returns a full page
//
//   merged slices carry no duplicate (symbol, date) -- boundaries overlap on
//   purpose, and a double count would inflate the very measurement this fixes
//
//   a single day at the cap is REPORTED, never returned short as though whole
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

const cap = num(calendar, "EARNINGS_CALENDAR_PAGE_CAP");
const fetchBudget = num(calendar, "MAX_CALENDAR_FETCHES");
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
  // Non-exported helpers are dependencies of the exported ones (midpointDate
  // needs addDays), and re-implementing them in a fixture would test the copy
  // rather than the code.
  //
  // LONGEST PREFIX FIRST. Matching bare `function ${name}(` against an
  // `export async function` starts the slice AFTER the `async`, and the lifted
  // body then has `await` inside a synchronous function -- a syntax error
  // rather than a wrong answer, which is the only reason it was noticed.
  let start = -1;
  for (const prefix of ["export async function ", "async function ", "export function ", "function "]) {
    const at = src.indexOf(`${prefix}${name}(`);
    if (at !== -1) {
      start = at;
      break;
    }
  }
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

const truncFn = grabFunction(calendar, "isCappedPage");
const perFn = grabFunction(plan, "fetchesPerReport");
const planFn = grabFunction(plan, "planEarningsDay");

if (!cap || !fetchBudget || !ttlDay || !nearTtl || !truncFn || !perFn || !planFn) {
  console.error(
    `FAIL: could not read EARNINGS_CALENDAR_PAGE_CAP (${cap}), ` +
      `MAX_CALENDAR_FETCHES (${fetchBudget}), EARNINGS_TTL_DAY ` +
      `(${ttlDay}), EARNINGS_TTL_NEAR_REPORT_SECONDS (${nearTtl}), or extract ` +
      `isCappedPage (${!!truncFn}) / fetchesPerReport (${!!perFn}) / ` +
      `planEarningsDay (${!!planFn}). This script would otherwise pass by ` +
      `measuring nothing.`
  );
  process.exit(1);
}

// ── 1. The cap is a fact about the endpoint, not a wish ────────────────────
console.log("\n1. The cap drives the split; the ignored parameter is gone");

check(
  "the ignored `limit` parameter is no longer sent",
  !/[?&]limit=/.test(calendar),
  `the probe proved it does nothing (0/4000/10000/20000 all returned 4,000 rows ` +
    `and byte-identical sets), and a request parameter that is provably ignored ` +
    `-- with an assertion saying we send it -- is a claim the code cannot keep`
);
check(
  "the constant is the OBSERVED cap",
  cap === 4000,
  `${cap}, measured 2026-09-03 and 2026-09-04. It is FMP's number, not ours, ` +
    `which is why it is named for what it is`
);
check(
  "there is a bound on how many fetches one range may cost",
  fetchBudget > 0 && fetchBudget < 64,
  `${fetchBudget} — a binary split over a month is ~5 levels and at most ~62 ` +
    `fetches even if every slice is capped, which would mean the endpoint had ` +
    `started returning 4,000 rows for a single day. Bounding it turns a runaway ` +
    `into a recorded stop`
);
// SLICED TO fetchCalendarRange. Testing the whole file for the call passed
// while the walk did NOT reserve, because getNameMap reserves too -- a grep
// satisfied by an unrelated call site one function over.
const rangeSrc = grabFunction(calendar, "fetchCalendarRange") ?? "";
check(
  "the range fetch reserves a call slot",
  /await reserveFmpCallSlot\(\);/.test(rangeSrc),
  "fmpFetch records BYTES for the usage meter but does not reserve a slot, so " +
    "the calendar has been spending the plan's rate limit invisibly — and the " +
    "warm jobs compute their own backoff from that counter, so an uncounted " +
    "call makes their pacing wrong in the direction of overspending. One a day " +
    "was easy to overlook; several per month per schedule rebuild is not"
);

// ── 2. A response AT the cap is a page, not a range ────────────────────────
console.log("\n2. A full page is split, not accepted");

const capped = await lift(grabFunction(calendar, "isCappedPage"), `const EARNINGS_CALENDAR_PAGE_CAP = ${cap};`);
check(
  "exactly the cap reads as capped",
  capped.isCappedPage(cap) === true && capped.isCappedPage(4000, 4000) === true,
  "4,000 out of 4,000 is a page, not a February"
);
check(
  "more than the cap too",
  capped.isCappedPage(cap + 1) === true,
  ">= rather than ===: a changed cap should still trip it"
);
check(
  "a short page is not",
  capped.isCappedPage(1655) === false && capped.isCappedPage(cap - 1) === false,
  "1,655 rows for an uncapped 2026-01 is what a whole month looks like — a gate " +
    "that fires on everything is an off switch"
);
check(
  "a nonsense count or cap refuses to vouch for the page",
  capped.isCappedPage(NaN) === true &&
    capped.isCappedPage(100, 0) === true &&
    capped.isCappedPage(100, NaN) === true,
  "absence is a reason to distrust the page, never a pass"
);

// THE SPLITTER, RUN. Whether a capped response causes a split is a claim about
// control flow over responses, and grepping for `walk(` cannot see it.
const midMod = await lift(
  `${grabFunction(calendar, "addDays")}\n${grabFunction(calendar, "midpointDate")}`
);
check(
  "the midpoint halves a range and never escapes it",
  midMod.midpointDate("2026-02-01", "2026-02-28") === "2026-02-14" &&
    midMod.midpointDate("2026-02-01", "2026-02-02") === "2026-02-01" &&
    midMod.midpointDate("2026-02-05", "2026-02-05") === "2026-02-05",
  "a two-day range must still make progress, and a one-day range must be the " +
    "fixed point the recursion stops at"
);

// ── 2b. The merge ─────────────────────────────────────────────────────────
console.log("\n2b. Overlapping slices merge without double-counting");

const merge = await lift(grabFunction(calendar, "mergeCalendarRows"));
const row = (symbol, date, extra = {}) => ({ symbol, date, ...extra });
const bag = new Map();
merge.mergeCalendarRows(bag, [row("AAPL", "2026-02-14"), row("MSFT", "2026-02-14")]);
merge.mergeCalendarRows(bag, [row("AAPL", "2026-02-14"), row("NVDA", "2026-02-15")]);
check(
  "a symbol-date arriving from two slices is stored once",
  bag.size === 3,
  "slices overlap by a day ON PURPOSE, so a boundary date arrives twice — and " +
    "double-counting it would inflate the concentration measurement this exists " +
    "to fix, which is the same hazard collapseDuplicateDates was written for"
);
const rich = new Map();
merge.mergeCalendarRows(rich, [row("AAPL", "2026-02-14", { epsActual: 1.2, epsEstimated: 1.1 })]);
merge.mergeCalendarRows(rich, [row("AAPL", "2026-02-14")]);
check(
  "the richer row wins, whichever order it arrives in",
  rich.get("AAPL|2026-02-14")?.epsActual === 1.2,
  "the feed itself repeats a symbol on one date (getCandidatesByDate says so), " +
    "and last-wins would let a sparser duplicate erase a populated row"
);
const richLater = new Map();
merge.mergeCalendarRows(richLater, [row("AAPL", "2026-02-14")]);
merge.mergeCalendarRows(richLater, [row("AAPL", "2026-02-14", { epsActual: 1.2 })]);
check(
  "...and that is not just first-wins in disguise",
  richLater.get("AAPL|2026-02-14")?.epsActual === 1.2,
  "ties go to first seen; more data wins outright"
);
check(
  "rows without a usable symbol or date are dropped, not keyed as blanks",
  (() => {
    const m = new Map();
    merge.mergeCalendarRows(m, [row("", "2026-02-14"), row("AAPL", ""), row("AAPL", "nope")]);
    return m.size === 0;
  })(),
  "a `|` key built from two empty strings collides every malformed row into one " +
    "entry that then reads as a real company"
);

// ── 2c. The splitter, run against a cap that behaves like FMP's ───────────
console.log("\n2c. A February that overflows the cap is recovered in full");

// THE FIXTURE DROPS THE OLDEST DATES, exactly as the real endpoint does. That
// is the whole bug: a request for 2026-02-01..28 came back starting 2026-02-11
// with nothing to say so. A stub that truncated the END instead would let a
// splitter that never revisits early dates pass.
const rangeFn = await lift(
  [
    grabFunction(calendar, "addDays"),
    grabFunction(calendar, "midpointDate"),
    grabFunction(calendar, "isCappedPage"),
    grabFunction(calendar, "mergeCalendarRows"),
    grabFunction(calendar, "fetchCalendarRange"),
  ].join("\n"),
  `const EARNINGS_CALENDAR_PAGE_CAP = ${cap};
const MAX_CALENDAR_FETCHES = ${fetchBudget};
const MONTH_CACHE_MS = 1000;
const reserveFmpCallSlot = async () => globalThis.__CAL_RESERVE();
const fmpFetch = async (url) => globalThis.__CAL_FETCH(url);`
);

// 7,000 symbol-days across February: 250 a day, every day. Above the 4,000 cap
// for the month, under it for either half.
const FEB_PER_DAY = 250;
const febRows = [];
for (let d = 1; d <= 28; d++) {
  const date = `2026-02-${String(d).padStart(2, "0")}`;
  for (let i = 0; i < FEB_PER_DAY; i++) febRows.push({ symbol: `S${d}_${i}`, date });
}
// A ROW ON THE SAFETY DAY ITSELF. Without one, the first slice's `from` of
// 2026-01-31 returns nothing outside the month and the trim assertion below
// passes with the filter deleted -- an assertion that cannot fail, found by
// deleting the filter and watching it stay green.
febRows.push({ symbol: "JANUARY", date: "2026-01-31" });
let fetchLog = [];
globalThis.__CAL_RESERVE = async () => {};
globalThis.__CAL_FETCH = async (url) => {
  const from = /from=(\d{4}-\d{2}-\d{2})/.exec(url)?.[1];
  const to = /to=(\d{4}-\d{2}-\d{2})/.exec(url)?.[1];
  fetchLog.push([from, to]);
  const inRange = febRows.filter((r) => r.date >= from && r.date <= to);
  // OLDEST DROPPED, newest kept -- the observed behaviour.
  const served = inRange.length > cap ? inRange.slice(inRange.length - cap) : inRange;
  return { ok: true, status: 200, text: async () => JSON.stringify(served) };
};

const feb = await rangeFn.fetchCalendarRange("2026-02-01", "2026-02-28", { apiKey: "k" });
check(
  "a full page is split rather than accepted",
  feb.fetches > 1 && feb.slices.some((s) => s.capped),
  `${feb.fetches} fetches, ${feb.slices.filter((s) => s.capped).length} of them capped — ` +
    `the unsliced code took the one capped page and returned it as a February`
);
check(
  "and every row of the month comes back, including the ones the cap dropped",
  feb.rows.length === 28 * FEB_PER_DAY,
  `${feb.rows.length} of ${28 * FEB_PER_DAY} (the 2026-01-31 row is trimmed). The ` +
    `single capped fetch would have ` +
    `returned ${cap}, missing the oldest ${28 * FEB_PER_DAY - cap} rows — ten days ` +
    `of peak Q4 season`
);
check(
  "the earliest day is present, which is the one the cap ate",
  feb.rows.some((r) => r.date === "2026-02-01") && feb.rows.some((r) => r.date === "2026-02-28"),
  "the observed truncation kept 2026-02-11 -> 2026-02-28 and silently dropped " +
    "the first ten days"
);
check(
  "no (symbol, date) appears twice after the merge",
  new Set(feb.rows.map((r) => `${r.symbol}|${r.date}`)).size === feb.rows.length,
  `${feb.rows.length} rows, ${new Set(feb.rows.map((r) => `${r.symbol}|${r.date}`)).size} keys — ` +
    `adjacent slices overlap by a day on purpose, so this is the assertion that ` +
    `stops the overlap inflating every count downstream`
);
check(
  "nothing outside the requested range survives the trim",
  feb.rows.every((r) => r.date >= "2026-02-01" && r.date <= "2026-02-28") &&
    !feb.rows.some((r) => r.symbol === "JANUARY"),
  "the safety day really does pull in 2026-01-31 here, so the filter is the only " +
    "thing keeping it out; the caller asked for a month"
);
check(
  "the slices really do overlap, rather than the trim hiding a gap",
  fetchLog.some(([from]) => from === "2026-01-31"),
  "`to` is demonstrably inclusive but nothing observed settles `from`, so each " +
    "slice asks from one day early — correct under both readings, where " +
    "assuming inclusivity and being wrong drops one day per boundary"
);
check(
  "no day is reported as unreadable when the range is merely dense",
  feb.cappedDays.length === 0 && feb.stoppedEarly === null,
  "a February at 250 reports a day splits cleanly; the alarm is for a cap that " +
    "moved, not for a busy month"
);

// A SINGLE DAY AT THE CAP -- the floor of the recursion, and the case the brief
// asked to be stated. It cannot be split further, so it must be NAMED rather
// than returned short as though it were whole.
const heavy = [];
for (let i = 0; i < cap + 10; i++) heavy.push({ symbol: `H${i}`, date: "2026-02-05" });
globalThis.__CAL_FETCH = async (url) => {
  const from = /from=(\d{4}-\d{2}-\d{2})/.exec(url)?.[1];
  const to = /to=(\d{4}-\d{2}-\d{2})/.exec(url)?.[1];
  const inRange = heavy.filter((r) => r.date >= from && r.date <= to);
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(inRange.slice(Math.max(0, inRange.length - cap))),
  };
};
const oneDay = await rangeFn.fetchCalendarRange("2026-02-05", "2026-02-05", { apiKey: "k" });
check(
  "a single day at the cap is NAMED, not returned short in silence",
  oneDay.cappedDays.includes("2026-02-05"),
  "it should be unreachable -- the busiest day measured is 710 symbols against " +
    "a 4,000 cap -- so if it ever fires the cap or the endpoint has changed. " +
    "Keeping an alarm that 'cannot' fire is the point: the last three of these " +
    "hid behind exactly that reasoning"
);
check(
  "...and it still returns the rows it did get, rather than nothing",
  oneDay.rows.length === cap,
  "a capped page is incomplete, not wrong — binning it would pay for the fetch " +
    "and throw the data away"
);
check(
  "...and does not recurse forever on a range it cannot split",
  oneDay.fetches === 1,
  "midpointDate is a fixed point at from === to, so the floor has to be an " +
    "explicit stop rather than a shrinking range"
);

// THE BUDGET, and the FMP guard, both run.
globalThis.__CAL_FETCH = async () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(Array.from({ length: cap }, (_, i) => ({ symbol: `X${i}`, date: "2026-02-10" }))),
});
// The alarm fires once per unsplittable day, which is right in production and
// eighteen lines of noise here. Silenced for this case only -- the single-day
// case above deliberately leaves its one line visible, because an alarm nobody
// has ever seen fire is one nobody trusts.
const realError = console.error;
console.error = () => {};
const runaway = await rangeFn.fetchCalendarRange("2026-01-01", "2026-12-31", { apiKey: "k" });
console.error = realError;
check(
  "an endpoint that caps everything stops at the fetch budget",
  runaway.stoppedEarly?.startsWith("fetch-budget") === true &&
    runaway.fetches <= fetchBudget,
  `${runaway.fetches} fetches, stopped: ${runaway.stoppedEarly} — a cap that ` +
    `moved to something tiny would otherwise walk a year down to single days`
);
globalThis.__CAL_RESERVE = async () => {
  throw new Error("capacity-timeout");
};
const noBudget = await rangeFn.fetchCalendarRange("2026-02-01", "2026-02-28", { apiKey: "k" });
check(
  "no FMP capacity stops the walk and says so, rather than throwing the month away",
  noBudget.stoppedEarly === "fmp-capacity" && noBudget.fetches === 0,
  "a partial month with a reason beats an empty one with none — and the reason " +
    "is what tells you it was the budget rather than the endpoint"
);
globalThis.__CAL_RESERVE = async () => {};
check(
  "no API key is a stated reason, not an empty month",
  (await rangeFn.fetchCalendarRange("2026-02-01", "2026-02-28", { apiKey: "" })).stoppedEarly ===
    "no-api-key",
  "[] for a missing key and [] for a quiet month are the same value and " +
    "opposite facts"
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
    ? "\nA full page is split, the merge de-duplicates, and the passes are derived.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
