// A FISCAL YEAR'S GROWTH AT THE YEAR'S OWN RATE (earnings audit r1: CM).
//
// Growth is taken in the reporting currency, recovered from the stored USD
// figure and the rate its period was converted at. By end date alone a fiscal
// year found its own Q4's rate first (quarters are recorded before years, and
// both end on one date), so CM's FY2023-FY2025 revenue growth printed +7.5%,
// +9.5%, +12.3% against its filed CAD +6.9%, +9.8%, +13.8%. Both the new
// {start, end} entries and the sets already stored without `start` are covered,
// plus a mutation that puts the end-only lookup back.
import fs from "node:fs";
import { lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const fieldsSrc = fs.readFileSync("lib/server/secFields.ts", "utf8");
const fxSrc = fs.readFileSync("lib/server/fxRates.ts", "utf8");
const currencyRaw = fs.readFileSync("lib/server/secCurrency.ts", "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const extractSrc = fs.readFileSync("lib/server/secExtract.ts", "utf8")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secFields";/, "")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secCurrency";/, "");
const load = (currencySrc) => lift(`${fieldsSrc}\n${fxSrc}\n${currencySrc}\n${extractSrc}`);
const X = await load(currencyRaw);
const REV = X.SEC_FIELD_KEYS.indexOf("revenue");

console.log("CM: a year's growth at the year's own rate");
{
  // CM's filed revenue (CAD $M) and plausible USD-per-CAD averages: the year's
  // twelve-month average and its Q4's three-month average differ, as they do.
  const cad = { 2022: 21833, 2023: 23332, 2024: 25606, 2025: 29133 };
  const yearRate = { 2022: 0.7700, 2023: 0.7410, 2024: 0.7330, 2025: 0.7160 };
  const q4Rate = { 2022: 0.7380, 2023: 0.7300, 2024: 0.7250, 2025: 0.7140 };
  const end = (y) => `${y}-10-31`, start = (y) => `${y - 1}-11-01`;
  const period = (y) => {
    const v = Array(X.SEC_FIELD_KEYS.length).fill(null);
    v[REV] = cad[y] * 1e6 * yearRate[y];
    return { e: end(y), s: start(y), fp: "FY", fy: y, a: null, f: null, v, d: "" };
  };
  // A legacy stored set: quarters first, then years, then the balance sheet, no `start`.
  const legacy = { from: "CAD", source: "fixture", refused: [], applied: [] };
  for (const y of [2023, 2024, 2025]) legacy.applied.push({ end: end(y), usdPerUnit: q4Rate[y], basis: "average" });
  for (const y of [2022, 2023, 2024, 2025]) legacy.applied.push({ end: end(y), usdPerUnit: yearRate[y], basis: "average" });
  for (const y of [2023, 2024, 2025]) legacy.applied.push({ end: end(y), usdPerUnit: 0.72, basis: "spot" });
  // The same set written now: every entry carries its period's start.
  const current = { ...legacy, applied: legacy.applied.map((a, i) => ({
    ...a, start: a.basis === "spot" ? null : i < 3 ? `${a.end.slice(0, 4)}-08-01` : start(Number(a.end.slice(0, 4))),
  })) };
  const growth = (M, fx, y) => {
    const a = M.storedInReportingCurrency(period(y), fx)?.v[REV], b = M.storedInReportingCurrency(period(y - 1), fx)?.v[REV];
    return a != null && b != null ? ((a - b) / b) * 100 : null;
  };
  const filed = (y) => ((cad[y] - cad[y - 1]) / cad[y - 1]) * 100;
  for (const y of [2023, 2024, 2025]) {
    for (const [label, fx] of [["stored before `start`", legacy], ["written now", current]]) {
      const g = growth(X, fx, y);
      check(`FY${y} (${label}): ${g?.toFixed(1)}% = the filed CAD ${filed(y).toFixed(1)}%`, g != null && Math.abs(g - filed(y)) < 0.05);
    }
  }
  const q4 = { e: end(2024), s: "2024-08-01", v: [] };
  check("a Q4 still takes its own three-month rate", X.appliedRateFor(legacy.applied, q4.e, q4.s)?.usdPerUnit === q4Rate[2024]
    && X.appliedRateFor(current.applied, q4.e, q4.s)?.usdPerUnit === q4Rate[2024]);
  check("a balance-sheet date takes the spot rate", X.appliedRateFor(legacy.applied, end(2024), null)?.basis === "spot"
    && X.appliedRateFor(current.applied, end(2024), null)?.basis === "spot");

  const byEnd = currencyRaw.replace(
    "  const rate = appliedRateFor(fx.applied, period.e, period.s)?.usdPerUnit ?? null;",
    "  const rate = fx.applied.find((a) => a.end === period.e)?.usdPerUnit ?? null;");
  check("the end-only mutation applied", byEnd !== currencyRaw);
  const XM = await load(byEnd);
  const g23 = growth(XM, legacy, 2023);
  check(`MUTATION: matching by end alone prints the page's wrong ${g23?.toFixed(1)}% for FY2023 (caught)`, g23 != null && Math.abs(g23 - filed(2023)) > 0.3);
}

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nA year's growth is taken at the year's rate.");
