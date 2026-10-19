// THE "ABOUT THESE FIGURES" RATE FOR A FISCAL-YEAR VIEW IS THE YEAR'S RATE.
//
// The currency note quotes the rate the latest period was converted at. It
// looked that rate up by end date alone, and a fiscal year ends on its Q4's
// date: quarters are recorded first, so a filer whose latest period is a year
// (an annual filer, or a year newer than its last quarter) was told the Q4's
// three-month average while every figure above it used the twelve-month one.
// The lookup is now appliedRateFor (start + end), the one storedInReportingCurrency
// uses. Covers sets stored before `start` was recorded and sets written now,
// a quarter-latest view keeping its quarter's rate, and a mutation.
import fs from "node:fs";
import { loadCards } from "./lib/render-cards.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const AAPL = JSON.parse(fs.readFileSync("data/sec/factset-fixture-AAPL.json", "utf8"));
const Q4_RATE = 0.7300, YEAR_RATE = 0.7410, SPOT = 0.7200;

// A foreign filer whose latest period is its fiscal year: AAPL's figures,
// relabelled CAD, with the quarters after its newest year dropped.
const yearLatest = (withStart) => {
  const set = structuredClone(AAPL);
  const fy = set.years[0];
  set.quarters = set.quarters.filter((q) => q.e < fy.e);
  set.cur = "CAD";
  const q4Start = new Date(Date.parse(fy.e) - 90 * 86_400_000).toISOString().slice(0, 10);
  const applied = [
    { end: fy.e, usdPerUnit: Q4_RATE, basis: "average", start: q4Start },
    { end: fy.e, usdPerUnit: YEAR_RATE, basis: "average", start: fy.s },
    { end: fy.e, usdPerUnit: SPOT, basis: "spot", start: null },
  ];
  set.fx = { from: "CAD", source: "fixture", refused: [], applied: withStart ? applied : applied.map((a) => { const { start: _s, ...rest } = a; void _s; return rest; }) };
  return set;
};
// The same filer with its newest quarter latest.
const quarterLatest = () => {
  const set = structuredClone(AAPL);
  const q = set.quarters[0];
  set.years = set.years.filter((y) => y.e < q.e);
  set.cur = "CAD";
  set.fx = { from: "CAD", source: "fixture", refused: [], applied: [
    { end: q.e, usdPerUnit: Q4_RATE, basis: "average", start: q.s },
    { end: q.e, usdPerUnit: SPOT, basis: "spot", start: null },
  ] };
  return set;
};

const run = async (M, label) => {
  const out = {};
  for (const [name, set] of [["stored before `start`", yearLatest(false)], ["written now", yearLatest(true)]]) {
    const v = M.buildSecEarningsView(set);
    out[name] = v?.currency?.latestRate ?? null;
    if (label) check(`FY-latest view, ${name}: the note quotes ${out[name]} (the year's ${YEAR_RATE})`, v?.basis === "year" && out[name] === YEAR_RATE && v.currency.latestBasis === "average");
  }
  return out;
};

console.log("A fiscal-year view quotes the fiscal year's rate");
const M = await loadCards();
await run(M, true);
{
  const v = M.buildSecEarningsView(quarterLatest());
  check(`a quarter-latest view still quotes its quarter's rate (${v?.currency?.latestRate})`, v?.basis === "quarter" && v.currency.latestRate === Q4_RATE);
}

const OLD = "appliedRateFor(set.fx!.applied, latest.e, latest.s)?.usdPerUnit";
const MUT = "set.fx?.applied.find((a) => a.end === latest.e)?.usdPerUnit";
let mutated = false;
const MM = await loadCards((src) => { if (src.includes(OLD)) { mutated = true; return src.replace(OLD, MUT); } return src; });
check("the end-only mutation applied", mutated);
const bad = await run(MM, false);
check(`MUTATION: by end alone the FY view quotes the Q4's ${bad["written now"]} (caught)`, bad["written now"] === Q4_RATE && bad["stored before `start`"] === Q4_RATE);

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nA fiscal-year view quotes the year's rate.");
