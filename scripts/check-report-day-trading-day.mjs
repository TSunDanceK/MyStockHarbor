// AN ESTIMATED REPORT DAY IS A TRADING DAY (#552 COWORK #199/#200 item 1).
//
// The rule: an estimated day landing on a Saturday, Sunday or NYSE holiday
// moves to the nearest trading day IN THE DIRECTION OF THE FILER'S HABIT (the
// weekday its past 8-K 2.02 announcements fall on), otherwise the following
// trading day. Kind, window and confidence are unchanged. Both producers of an
// estimated day carry it: secReportDates.estimateNextReport (the stored `next`)
// and expectedToReport.expectedFrom (the dashboard card and the calendar's
// "Coming up", which add `daysAway` to today).
//
//   1. the NYSE holiday calendar against NYSE's published lists, 2021-2027;
//   2. the filer's weekday habit;
//   3. NFLX and GOOGL, the two the owner saw on a Sunday, through expectedFrom;
//   4. estimateNextReport: a weekend date moves, a deadline-clamped one never
//      moves past the deadline;
//   5. mutants, each caught.
//
//   node scripts/check-report-day-trading-day.mjs
import ts from "typescript";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const transpile = (src) => ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const strip = (src) => src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const b64 = (src) => `data:text/javascript;base64,${Buffer.from(src).toString("base64")}`;
const RD = readCodeOnly("lib/server/secReportDates.ts");
const EX = readCodeOnly("lib/server/expectedToReport.ts");
let nonce = 0;
/** Both modules from source (optionally mutated), expectedToReport importing the real onTradingDay. */
async function load(mutRD = (s) => s, mutEX = (s) => s) {
  const rd = b64(transpile(strip(mutRD(RD))) + `\n// ${++nonce}`);
  const ex = b64(`import { onTradingDay } from "${rd}";\n` + transpile(strip(mutEX(EX))) + `\n// ${nonce}`);
  return { R: await import(rd), E: await import(ex) };
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const wd = (d) => WD[new Date(`${d}T00:00:00Z`).getUTCDay()];
const ev = (periodEnd, announcedOn, basis = "8-K item 2.02") => ({
  periodEnd, announcedOn, basis, accession: "x", timing: null, form: "8-K", items: "2.02", eventDate: announcedOn,
});
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// NFLX and GOOGL as the census read them on 2026-10-10 (relay
// write-report-day-census): next period end 2026-09-30, median lags 18 and 25
// days, newest-eight 8-K 2.02 weekdays NFLX Thu×5 Tue×3 and GOOGL Wed×5 Tue×2
// Thu×1. Ninety-one days is thirteen weeks, so a constant-lag history keeps
// its weekday; `shift` moves chosen events a day or two to reproduce the mix
// without moving the median.
/** Twelve quarters, newest first, the newest ending `lastEnd`, each announced `lag` days later (+ shift[i]). */
function history(lastEnd, lag, shift = {}) {
  const out = [];
  let end = lastEnd;
  for (let i = 0; i < 12; i++) {
    out.push(ev(end, addDays(end, lag + (shift[i] ?? 0))));
    end = addDays(end, -91);
  }
  return out;
}
// 2026-06-28 is a Sunday: +18 is a Thursday. 2026-06-27 is a Saturday: +25 is a Wednesday.
const NFLX_EVENTS = history("2026-06-28", 18, { 1: -2, 3: -2, 5: -2 });          // Thu×5 Tue×3
const GOOGL_EVENTS = history("2026-06-27", 25, { 2: -1, 4: -1, 6: 1 });          // Wed×5 Tue×2 Thu×1
const NFLX_WANT = "2026-10-15";   // Sun 18 Oct -> the Thursday within three days
const GOOGL_WANT = "2026-10-28";  // Sun 25 Oct -> the Wednesday within three days
const TODAY = "2026-10-10";
// A LATE FILER WHOSE DEADLINE FALLS ON A SATURDAY: period end Mon 2026-08-31
// + 40 days (large accelerated, quarterly) = Sat 2026-10-10. Lags of 51/52
// days, so estimator A lands past the deadline and is clamped to it; the
// weekdays tie (Wed×2 Thu×2), so no habit applies and the day can only step
// back to Fri 2026-10-09 rather than forward past the deadline.
const LATE = [ev("2026-06-01", "2026-07-22"), ev("2026-03-02", "2026-04-23"), ev("2025-12-01", "2026-01-21"), ev("2025-09-01", "2025-10-23")];

const { R, E } = await load();

console.log("\n1. the NYSE holiday calendar, against NYSE's published lists");
const PUBLISHED = {
  2021: "2021-01-01 2021-01-18 2021-02-15 2021-04-02 2021-05-31 2021-07-05 2021-09-06 2021-11-25 2021-12-24",
  2022: "2022-01-17 2022-02-21 2022-04-15 2022-05-30 2022-06-20 2022-07-04 2022-09-05 2022-11-24 2022-12-26",
  2023: "2023-01-02 2023-01-16 2023-02-20 2023-04-07 2023-05-29 2023-06-19 2023-07-04 2023-09-04 2023-11-23 2023-12-25",
  2024: "2024-01-01 2024-01-15 2024-02-19 2024-03-29 2024-05-27 2024-06-19 2024-07-04 2024-09-02 2024-11-28 2024-12-25",
  2025: "2025-01-01 2025-01-20 2025-02-17 2025-04-18 2025-05-26 2025-06-19 2025-07-04 2025-09-01 2025-11-27 2025-12-25",
  2026: "2026-01-01 2026-01-19 2026-02-16 2026-04-03 2026-05-25 2026-06-19 2026-07-03 2026-09-07 2026-11-26 2026-12-25",
  2027: "2027-01-01 2027-01-18 2027-02-15 2027-03-26 2027-05-31 2027-06-18 2027-07-05 2027-09-06 2027-11-25 2027-12-24",
};
for (const [y, want] of Object.entries(PUBLISHED)) {
  const got = [...R.usMarketHolidays(Number(y))].sort().join(" ");
  check(`${y}: ${want.split(" ").length} closures`, got === want, got === want ? "" : `got ${got}`);
}
check("New Year's Day on a Saturday is not moved into the old year (Fri 2021-12-31 trades)", R.isUsTradingDay("2021-12-31"));
check("Juneteenth only from 2022 (2021-06-18 trades)", R.isUsTradingDay("2021-06-18"));
check("weekends never trade; the next trading day skips a Monday holiday", !R.isUsTradingDay("2026-10-18") && R.nextUsTradingDay("2027-01-16") === "2027-01-19");

console.log("\n2. the filer's weekday habit (8-K 2.02, newest eight, a strict mode seen twice)");
check("NFLX (Thu×5 Tue×3) reads Thursday; GOOGL (Wed×5 Tue×2 Thu×1) reads Wednesday", R.habitWeekday(NFLX_EVENTS) === 4 && R.habitWeekday(GOOGL_EVENTS) === 3);
check("a tie is no habit", R.habitWeekday([ev("2026-06-30", "2026-07-21"), ev("2026-03-31", "2026-04-23")]) === null);
check("one event is no habit", R.habitWeekday([ev("2026-06-30", "2026-07-21")]) === null);
check("a 6-K filer with no 8-K reads its 6-K days",
  R.habitWeekday([ev("2026-06-30", "2026-07-29", "6-K near period end"), ev("2026-03-31", "2026-04-29", "6-K near period end")]) === 3);

console.log("\n3. NFLX and GOOGL through expectedFrom (the dashboard card and the calendar)");
const NFLX = { symbol: "NFLX", cik: "1065280", at: "", nextPeriodEnd: "2026-09-30", next: { kind: "none", reason: "" }, events: NFLX_EVENTS };
const GOOGL = { symbol: "GOOGL", cik: "1652044", at: "", nextPeriodEnd: "2026-09-30", next: { kind: "none", reason: "" }, events: GOOGL_EVENTS };
for (const [rec, raw, want] of [[NFLX, "2026-10-18", NFLX_WANT], [GOOGL, "2026-10-25", GOOGL_WANT]]) {
  const out = E.expectedFrom(rec.symbol, rec, TODAY, new Set());
  const on = out.row ? addDays(TODAY, out.row.daysAway) : null;
  check(`${rec.symbol}: the raw estimate ${wd(raw)} ${raw} moves to ${wd(want)} ${want}`, on === want, out.row ? `${wd(on)} ${on}` : JSON.stringify(out));
  check(`${rec.symbol}: …kind, window and confidence unchanged`, out.row && out.row.medianLagDays === (rec.symbol === "NFLX" ? 18 : 25) && out.row.periodEnd === "2026-09-30");
}
{
  // NEVER BEFORE TODAY: a Sunday estimate seen on the Saturday cannot move back to Thursday.
  const thu = NFLX;
  const out = E.expectedFrom("NFLX", thu, "2026-10-17", new Set());
  check("a weekend estimate never moves into the past (seen on Sat 17 Oct: Mon 19 Oct, not Thu 15 Oct)",
    out.row && addDays("2026-10-17", out.row.daysAway) === "2026-10-19", out.row ? addDays("2026-10-17", out.row.daysAway) : JSON.stringify(out));
}
{
  // A TRADING DAY IS LEFT ALONE.
  const out = E.expectedFrom("X", { ...NFLX, events: history("2026-06-28", 16) }, TODAY, new Set());
  check("an estimate already on a trading day is unchanged (Fri 16 Oct)", out.row && addDays(TODAY, out.row.daysAway) === "2026-10-16");
}

console.log("\n4. estimateNextReport (the stored next-report date)");
{
  // Four regular lags; A lands on Sun 2026-11-01; Friday habit -> Fri 30 Oct.
  const regular = [ev("2026-06-30", "2026-07-31"), ev("2026-03-31", "2026-05-01"), ev("2025-12-31", "2026-01-30"), ev("2025-09-30", "2025-11-01")];
  const r = R.estimateNextReport(regular, "2026-09-30", "Large accelerated filer");
  check("a weekend date moves to the filer's habitual weekday (Sun 1 Nov -> Fri 30 Oct)", r.kind === "date" && r.date === "2026-10-30", `${r.kind} ${r.date}`);
  check("…and nothing else about the estimate changes", r.kind === "date" && r.estimator === "A" && r.spreadDays <= R.REGULAR_SPREAD_DAYS && r.clamped === false);
  // CLAMPED TO A DEADLINE ON A WEEKEND: step back, never past it. A 40-day
  // deadline from a Saturday-ending period puts the cap on a Sunday.
  const late = LATE;
  const c = R.estimateNextReport(late, "2026-08-31", "Large accelerated filer");
  const cap = addDays("2026-08-31", R.deadlineDays("Large accelerated filer", false));
  check(`a deadline-clamped date on a weekend steps back, never past the deadline (${wd(cap)} ${cap} -> Fri 2026-10-09)`, c.kind === "date" && c.clamped && cap === "2026-10-10" && c.date === "2026-10-09", `${c.kind} ${c.date} clamped=${c.clamped}`);
}

console.log("\n5. mutants");
const MUTANTS = [
  ["expectedFrom ignores the rule", (s) => s, (s) => s.replace("onTradingDay(shiftDay(today, rawAway), Array.isArray(rec.events) ? rec.events : [], { notBefore: today })", "shiftDay(today, rawAway)"),
    async ({ E }) => { const o = E.expectedFrom("NFLX", NFLX, TODAY, new Set()); return o.row && addDays(TODAY, o.row.daysAway) === NFLX_WANT; }],
  ["estimateNextReport ignores the rule", (s) => s.replace("date: onTradingDay(clamped ? capDay : predicted, usable, { notAfter: capDay }),", "date: clamped ? capDay : predicted,"), (s) => s,
    async ({ R }) => { const r = R.estimateNextReport([ev("2026-06-30", "2026-07-31"), ev("2026-03-31", "2026-05-01"), ev("2025-12-31", "2026-01-30"), ev("2025-09-30", "2025-11-01")], "2026-09-30", "Large accelerated filer"); return r.date === "2026-10-30"; }],
  ["the habit is ignored (always the following trading day)", (s) => s.replace("const habit = habitWeekday(events);", "const habit = null as number | null;"), (s) => s,
    async ({ E }) => { const o = E.expectedFrom("NFLX", NFLX, TODAY, new Set()); return o.row && addDays(TODAY, o.row.daysAway) === NFLX_WANT; }],
  ["Good Friday dropped from the calendar", (s) => s.replace("addCalendarDays(easter(y), -2),", ""), (s) => s,
    async ({ R }) => [...R.usMarketHolidays(2026)].includes("2026-04-03")],
  ["the clamp is not respected", (s) => s.replace("const after = nextUsTradingDay(date, 1);\n  if (inBounds(after)) return after;", "const after = nextUsTradingDay(date, 1);\n  return after;"), (s) => s,
    async ({ R }) => { const late = LATE; const c = R.estimateNextReport(late, "2026-08-31", "Large accelerated filer"); return c.date <= addDays("2026-08-31", R.deadlineDays("Large accelerated filer", false)); }],
];
for (const [label, mRD, mEX, holds] of MUTANTS) {
  const rdChanged = mRD(RD) !== RD, exChanged = mEX(EX) !== EX;
  if (!rdChanged && !exChanged) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  let ok;
  try { ok = await holds(await load(mRD, mEX)); } catch { ok = false; }
  check(`mutant "${label}" is caught`, !ok);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
