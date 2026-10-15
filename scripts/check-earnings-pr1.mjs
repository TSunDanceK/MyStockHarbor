// #552 COWORK #240 PR 1: three extractor rules, pinned on companyfacts-shaped
// payloads built from the filings the audit read (CODE-B-OPUS #20).
//   (a) EPS RATIO GATE   CVNA-shaped: filed FY EPS that does not close on net
//       income / diluted shares -> the quarter's computed EPS stays null; a
//       filer whose filed EPS closes keeps its computed quarter; a filer that
//       files no EPS at all keeps it too.
//   (b) LAST-RESORT REVENUE  JPM-shaped: no quarterly revenue line, 10-K
//       `Revenues` -> quarters fill from RevenuesNetOfInterestExpense (Q4 by
//       differencing), years unchanged; a filer with a contract line is
//       untouched even where RevenuesNetOfInterestExpense is also tagged.
//   (c) 16-WEEK CALENDAR  COST-shaped (12/12/12/16): Q4 = FY - 36 weeks;
//       AZO-shaped (16/12/12/12): the 16-week Q1 is admitted; a 4-4-5 filer is
//       not detected, and a 112-day frame is still refused for it.
// plus a mutation per rule: each rule removed, and its case fails.
import fs from "node:fs";
import { lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const fieldsSrc = fs.readFileSync("lib/server/secFields.ts", "utf8");
const fxSrc = fs.readFileSync("lib/server/fxRates.ts", "utf8");
const currencySrc = fs.readFileSync("lib/server/secCurrency.ts", "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const extractRaw = fs.readFileSync("lib/server/secExtract.ts", "utf8")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secFields";/, "")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secCurrency";/, "");
const load = (src) => lift(`${fieldsSrc}\n${fxSrc}\n${currencySrc}\n${src}`);
const once = (find, replace) => (src) => {
  if (src.split(find).length !== 2) throw new Error(`mutant anchor not found exactly once: ${find.slice(0, 60)}`);
  return src.replace(find, replace);
};
const X = await load(extractRaw);
const IX = (k) => X.SEC_FIELD_KEYS.indexOf(k);
const M = 1e6;

const row = (start, end, val, fp, form = fp === "FY" ? "10-K" : "10-Q") => ({ start, end, val, accn: `0000000000-26-0000${fp === "FY" ? "09" : "01"}`, fy: 2025, fp, form, filed: "2026-02-01" });
const payload = (tags) => ({
  cik: 1, entityName: "Fixture",
  facts: { "us-gaap": Object.fromEntries(Object.entries(tags).map(([tag, [unit, rows]]) => [tag, { units: { [unit]: rows } }])) },
});
const cell = (res, kind, end, key) => res[kind].find((p) => p.end === end)?.values?.[IX(key)] ?? null;

// ── (a) ──
console.log("(a) EPS ratio gate");
const cvna = (fyEps) => payload({
  NetIncomeLoss: ["USD", [row("2025-04-01", "2025-06-30", 183 * M, "Q2"), row("2025-01-01", "2025-12-31", 1407 * M, "FY")]],
  WeightedAverageNumberOfDilutedSharesOutstanding: ["shares", [row("2025-04-01", "2025-06-30", 716.153 * M, "Q2"), row("2025-01-01", "2025-12-31", 224.277 * M, "FY")]],
  ...(fyEps == null ? {} : { EarningsPerShareDiluted: ["USD/shares", [row("2025-01-01", "2025-12-31", fyEps, "FY")]] }),
});
const runA = (X) => {
  const off = X.extractCompanyFacts("CVNA", cvna(8.45)); // 1407 / (8.45 x 224.3) = 0.74
  const on = X.extractCompanyFacts("FIX", cvna(1407 / 224.277)); // closes exactly
  const none = X.extractCompanyFacts("FIX", cvna(null));
  return { off: cell(off, "quarters", "2025-06-30", "epsDiluted"), on: cell(on, "quarters", "2025-06-30", "epsDiluted"), none: cell(none, "quarters", "2025-06-30", "epsDiluted"), offNotes: off.notes };
};
{
  const r = runA(X);
  check("CVNA-shaped: Q2 computed EPS refused (FY closes at 0.74)", r.off?.val == null, JSON.stringify(r.off));
  check("...and a note says why", r.offNotes.some((n) => /epsDiluted: .*does not close/.test(n)));
  check("a filer whose filed EPS closes keeps the computed quarter", r.on?.derived === "computed" && Math.abs(r.on.val - 183 / 716.153) < 1e-9, JSON.stringify(r.on));
  check("a filer that files no EPS keeps the computed quarter", r.none?.derived === "computed", JSON.stringify(r.none));
  const XM = await load(once("    if (!ratioCloses(field.key, numerator, denominator)) {", "    if (false) {")(extractRaw));
  check("mutant (gate removed) is caught", runA(XM).off?.val != null);
}

// ── (b) ──
console.log("(b) last-resort revenue");
const rnoie = [row("2025-01-01", "2025-03-31", 45310 * M, "Q1"), row("2025-04-01", "2025-06-30", 44912 * M, "Q2"), row("2025-01-01", "2025-06-30", 90222 * M, "Q2"),
  row("2025-07-01", "2025-09-30", 46427 * M, "Q3"), row("2025-01-01", "2025-09-30", 136649 * M, "Q3"), row("2025-01-01", "2025-12-31", 182447 * M, "FY")];
const ni = ["USD", [row("2025-01-01", "2025-03-31", 14643 * M, "Q1"), row("2025-04-01", "2025-06-30", 14987 * M, "Q2"), row("2025-07-01", "2025-09-30", 14393 * M, "Q3"), row("2025-01-01", "2025-09-30", 44023 * M, "Q3"), row("2025-01-01", "2025-12-31", 57048 * M, "FY")]];
const jpm = payload({ Revenues: ["USD", [row("2025-01-01", "2025-12-31", 182447 * M, "FY")]], RevenuesNetOfInterestExpense: ["USD", rnoie], NetIncomeLoss: ni });
const withLine = payload({
  RevenueFromContractWithCustomerExcludingAssessedTax: ["USD", [row("2025-01-01", "2025-03-31", 30000 * M, "Q1"), row("2025-01-01", "2025-12-31", 125000 * M, "FY")]],
  RevenuesNetOfInterestExpense: ["USD", rnoie], NetIncomeLoss: ni,
});
const runB = (X) => {
  const j = X.extractCompanyFacts("JPM", jpm), w = X.extractCompanyFacts("FIX", withLine);
  return { j, w, q2: cell(j, "quarters", "2025-06-30", "revenue"), q4: cell(j, "quarters", "2025-12-31", "revenue"), fy: cell(j, "years", "2025-12-31", "revenue"), wq2: cell(w, "quarters", "2025-06-30", "revenue") };
};
{
  const r = runB(X);
  check("JPM-shaped: Q2 revenue from RevenuesNetOfInterestExpense", r.q2?.val === 44912 * M && r.q2?.tag === "RevenuesNetOfInterestExpense", JSON.stringify(r.q2));
  check("...and Q4 by differencing (FY less 9M)", r.q4?.val === (182447 - 136649) * M && r.q4?.derived === "differenced", JSON.stringify(r.q4));
  check("...years keep the 10-K's Revenues", r.fy?.val === 182447 * M && r.fy?.tag === "Revenues", JSON.stringify(r.fy));
  check("a filer with a contract line is untouched (Q2 stays unreported)", r.wq2?.val == null, JSON.stringify(r.wq2));
  const XM = await load(once("            m.set(\"revenue\", lr);\n", "")(extractRaw));
  check("mutant (fill removed) is caught", runB(XM).q2?.val == null);
  const XS = await load(once("          if (newest.some((e) => cells.get(e)?.get(\"revenue\")?.val != null)) continue;\n", "")(extractRaw));
  check("mutant (series guard removed) is caught", runB(XS).wq2?.val != null);
}

// ── (c) ──
console.log("(c) 16-week calendar");
const cost = payload({
  RevenueFromContractWithCustomerExcludingAssessedTax: ["USD", [
    row("2024-09-02", "2024-11-24", 62151 * M, "Q1"), row("2024-11-25", "2025-02-16", 63723 * M, "Q2"), row("2024-09-02", "2025-02-16", 125874 * M, "Q2"),
    row("2025-02-17", "2025-05-11", 63205 * M, "Q3"), row("2024-09-02", "2025-05-11", 189079 * M, "Q3"), row("2024-09-02", "2025-08-31", 275235 * M, "FY")]],
});
const azo = payload({
  NetIncomeLoss: ["USD", [row("2024-08-25", "2024-12-14", 564 * M, "Q1"), row("2024-12-15", "2025-03-08", 487 * M, "Q2"), row("2024-08-25", "2025-03-08", 1051 * M, "Q2"),
    row("2024-08-25", "2025-08-30", 2500 * M, "FY")]],
});
const fourFourFive = payload({
  NetIncomeLoss: ["USD", [row("2024-09-29", "2024-12-28", 100 * M, "Q1"), row("2024-09-29", "2025-03-29", 210 * M, "Q2"), row("2024-09-29", "2025-06-28", 330 * M, "Q3"),
    row("2024-09-29", "2025-09-27", 450 * M, "FY"), row("2025-09-28", "2026-01-17", 120 * M, "Q1")]],
});
const runC = (X) => {
  const c = X.extractCompanyFacts("COST", cost), a = X.extractCompanyFacts("AZO", azo), f = X.extractCompanyFacts("FIX", fourFourFive);
  return { q4: cell(c, "quarters", "2025-08-31", "revenue"), q1: cell(a, "quarters", "2024-12-14", "netIncome"), odd: cell(f, "quarters", "2026-01-17", "netIncome"), fq3: cell(f, "quarters", "2025-06-28", "netIncome") };
};
{
  check("detects COST-shaped (12/12/12/16)", X.sixteenWeekCalendar(cost) === true);
  check("detects AZO-shaped (16/12/12/12)", X.sixteenWeekCalendar(azo) === true);
  check("does not detect a 4-4-5 (13-week) filer", X.sixteenWeekCalendar(fourFourFive) === false);
  const r = runC(X);
  check("COST-shaped: Q4 = FY less 36 weeks", r.q4?.val === (275235 - 189079) * M && r.q4?.derived === "differenced", JSON.stringify(r.q4));
  check("AZO-shaped: 16-week Q1 admitted", r.q1?.val === 564 * M, JSON.stringify(r.q1));
  check("4-4-5 filer: a 111-day frame is still refused", r.odd == null, JSON.stringify(r.odd));
  check("4-4-5 filer: its own quarters unchanged (Q3 = 9M less 6M)", r.fq3?.val === 120 * M, JSON.stringify(r.fq3));
  check("standard quartersCovered(112) is still null", X.quartersCovered(112) === null && X.quartersCovered(112, "sixteen-week") === 1);
  const XM = await load(once('  const calendar: QuarterCalendar = sixteenWeekCalendar(facts) ? "sixteen-week" : "standard";', '  const calendar: QuarterCalendar = "standard";')(extractRaw));
  check("mutant (calendar never detected) is caught", runC(XM).q4 == null);
  const XW = await load(once('  const calendar: QuarterCalendar = sixteenWeekCalendar(facts) ? "sixteen-week" : "standard";', '  const calendar: QuarterCalendar = "sixteen-week";')(extractRaw));
  check("mutant (widened for everyone) is caught", runC(XW).odd != null);
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
