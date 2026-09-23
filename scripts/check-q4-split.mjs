// Q4_SPLIT — THE FISCAL-YEAR-END QUARTER HAS ITS OWN LAG POOL (#535 COWORK #8).
//
// Measured on 558 filers (relay 35862573781): keeping the fiscal-year-end
// quarter's lags apart from the other three admits 538 filers instead of 423
// at higher precision (in-sample 0.915 vs 0.868, hold-out 0.924 vs 0.904).
// Pinned here on the REAL module graph (loadOutlookGraph):
//   1. KO's measured lags: refused with one pool (as shipped), admitted with the
//      record's `fye`, and its band built from its QUARTERLY habit (~25 days).
//   2. The Q4 pool is used only when the NEXT period is the fiscal year's end.
//   3. Without `fye` the shipped single pool is unchanged.
//   4. The fiscal-year-end match works across a 52/53-week year boundary.
//   5. The record writer stamps `fye` from the stored set's newest annual end.
// Mutations below show each assertion can fail.
import fs from "node:fs";
import { loadOutlookGraph } from "./lib/outlook-module.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// KO's record as measured (relay 35858781606): 15 lags, oldest first —
// 41,41,45,26,25,44,32,25,26,42,32,25,25,41,25. The oldest three are fiscal
// years (quarters older than the retention window), then Q2 2023..Q1 2026.
const KO = [
  ["2020-12-31", 41], ["2021-12-31", 41], ["2022-12-31", 45],
  ["2023-06-30", 26], ["2023-09-29", 25], ["2023-12-31", 44], ["2024-03-29", 32],
  ["2024-06-28", 25], ["2024-09-27", 26], ["2024-12-31", 42], ["2025-03-28", 32],
  ["2025-06-27", 25], ["2025-09-26", 25], ["2025-12-31", 41], ["2026-04-03", 25],
];
const day = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const events = KO.map(([end, lag]) => ({
  periodEnd: end, announcedOn: day(end, lag), eventDate: day(end, lag), announcedAt: `${day(end, lag)}T12:00:00Z`,
  timing: "before-open", form: "8-K", items: "2.02", accession: `0000021344-${end}`, basis: "8-K item 2.02",
})).reverse();
const rec = (over = {}) => ({ symbol: "KO", cik: "0000021344", at: "2026-09-23T04:00:00Z", events,
  nextPeriodEnd: "2026-07-03", next: { kind: "none", reason: "test" }, pending: null, ...over });
const TODAY = "2026-07-10";

const run = async (patch) => {
  const g = await loadOutlookGraph({ patch });
  try {
    const E = g.expected;
    const habit = (r) => E.lagHabit(r);
    const got = (r) => E.expectedFrom("KO", r, TODAY, new Set());
    return {
      single: got(rec()), pooled: got(rec({ fye: "12-31" })),
      q3: habit(rec({ fye: "12-31" })), q4: habit(rec({ fye: "12-31", nextPeriodEnd: "2026-12-31" })),
      fyEdge: E.isFiscalYearEnd("2025-12-28", "01-03") && E.isFiscalYearEnd("2026-01-03", "12-30"),
      fyNot: E.isFiscalYearEnd("2025-09-30", "12-31"),
      outlook: g.mod.outlookFrom("KO", rec({ fye: "12-31" }), TODAY),
    };
  } finally { g.cleanup(); }
};

const R = await run();
console.log("\n1. KO: one pool refuses, Q4_SPLIT admits");
check("one pool (no fye) refuses KO as shipped", "skip" in R.single && R.single.skip === "below-precision-bar", JSON.stringify(R.single));
check("with fye KO is admitted", "row" in R.pooled, JSON.stringify(R.pooled).slice(0, 200));
check("its band comes from the quarterly habit (median 25-26 days)",
  "row" in R.pooled && R.pooled.row.medianLagDays >= 25 && R.pooled.row.medianLagDays <= 26, JSON.stringify(R.pooled.row ?? {}));
check("the outlook the page reads is a band, not a refusal", R.outlook.kind === "expected" || R.outlook.kind === "beyond-window", R.outlook.kind);

console.log("\n2. the Q4 pool only when the next period is the fiscal year's end");
check("next = Q3 -> quarterly pool", R.q3.medianLagDays <= 26 && R.q3.fromPeriods === 9, JSON.stringify(R.q3));
check("next = 31 Dec -> Q4 pool (~42 days, 6 lags)", R.q4.medianLagDays >= 41 && R.q4.fromPeriods === 6, JSON.stringify(R.q4));

console.log("\n3/4. fallback and the year boundary");
check("fiscal-year-end match crosses the year boundary (52/53-week)", R.fyEdge);
check("a quarter end is not a fiscal year end", !R.fyNot);

console.log("\n5. the writer stamps fye");
const W = fs.readFileSync("lib/server/secReportDatesWrite.ts", "utf8");
check("buildReportDatesRecord writes fye from the newest annual end",
  /fye: \[\.\.\.yearEnds\]\.sort\(\)\.at\(-1\)\?\.slice\(5\) \?\? null,/.test(W));

console.log("\nmutations");
const M1 = await run({ "lib/server/expectedToReport.ts": (s) => s.replace("const nextIsQ4 = valid(rec?.nextPeriodEnd) ? isQ4(rec!.nextPeriodEnd as string) : false;", "const nextIsQ4 = false;") });
check("MUTATION \"Q4 pool never chosen\" breaks assertion 2", !(M1.q4.medianLagDays >= 41));
const M2 = await run({ "lib/server/expectedToReport.ts": (s) => s.replace('if (!fye || !/^\\d{2}-\\d{2}$/.test(fye)) {', "if (true) {") });
check("MUTATION \"fye ignored\" breaks assertion 1", !("row" in M2.pooled));

console.log(failures ? `\n${failures} assertion(s) failed.\n` : "\nQ4_SPLIT holds.\n");
process.exit(failures ? 1 : 0);
