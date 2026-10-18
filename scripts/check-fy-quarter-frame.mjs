// A FULL YEAR'S VALUE FILED ON A QUARTER'S DATES IS NOT A QUARTER (earnings audit r2).
//
// Four filers' 10-Ks tag the fiscal year's value on a quarter-length context
// under the same accession as the year (relay write-earnings-audit-r2-fysum):
//   LHX  FY2024 21,325.0 on 2024-09-28..2025-01-03 (97d), accn 0000202058-26-000015
//   NI   FY2024 5,282.9 and FY2025 6,522.8 on their Q4 dates
//   DINO FY2024 28,580.0 on 2024-10-01..2024-12-31, accn 0001915657-26-000016
//   VICR FY2025 407.7 on 2025-07-01..2025-09-30, accn 0001193125-26-085102
//        (its 10-Q filed 110.4 for the same dates)
// Each read as a quarter equal to its year. The rows are LHX's and VICR's own,
// in $M. Pinned: the quarter is refused and Q4 = FY − 9M; VICR's Q3 comes from
// its 10-Q; a filer whose restated year disagrees with its quarters (BKV's
// 10-K/A) is NOT touched; and the mutation that keeps the mis-dated row.
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
const X = await load(extractRaw);
const REV = X.SEC_FIELD_KEYS.indexOf("revenue");
const M = 1e6;
const TAG = "RevenueFromContractWithCustomerExcludingAssessedTax";
// [start, end, $M, form, fy, fp, filed, accn]
const facts = (rows) => ({ cik: 1, entityName: "Fixture", facts: { "us-gaap": { [TAG]: { units: { USD: rows.map(([start, end, v, form, fy, fp, filed, accn]) => ({ start, end, val: v * M, form, fy, fp, filed, accn })) } } } } });
const q = (ex, end) => ex.quarters.find((p) => p.end === end)?.values?.[REV];
const y = (ex, end) => ex.years.find((p) => p.end === end)?.values?.[REV];

const LHX = facts([
  ["2023-12-30", "2024-03-29", 5211.0, "10-Q", 2025, "Q1", "2025-04-24", "0000202058-25-000101"],
  ["2024-03-30", "2024-06-28", 5299.0, "10-Q", 2025, "Q2", "2025-07-24", "0000202058-25-000151"],
  ["2023-12-30", "2024-06-28", 10510.0, "10-Q", 2025, "Q2", "2025-07-24", "0000202058-25-000151"],
  ["2024-06-29", "2024-09-27", 5292.0, "10-Q", 2025, "Q3", "2025-10-30", "0000202058-25-000173"],
  ["2023-12-30", "2024-09-27", 15802.0, "10-Q", 2025, "Q3", "2025-10-30", "0000202058-25-000173"],
  ["2023-12-30", "2025-01-03", 21325.0, "10-K", 2025, "FY", "2026-02-12", "0000202058-26-000015"],
  ["2024-09-28", "2025-01-03", 21325.0, "10-K", 2025, "FY", "2026-02-12", "0000202058-26-000015"],
]);
const VICR = facts([
  ["2025-01-01", "2025-03-31", 94.0, "10-Q", 2026, "Q1", "2026-04-30", "0001193125-26-194947"],
  ["2025-04-01", "2025-06-30", 96.0, "10-Q", 2025, "Q2", "2025-08-01", "0000950170-25-101161"],
  ["2025-01-01", "2025-06-30", 190.0, "10-Q", 2025, "Q2", "2025-08-01", "0000950170-25-101161"],
  ["2025-07-01", "2025-09-30", 110.4, "10-Q", 2025, "Q3", "2025-10-29", "0001193125-25-256259"],
  ["2025-01-01", "2025-09-30", 300.4, "10-Q", 2025, "Q3", "2025-10-29", "0001193125-25-256259"],
  ["2025-07-01", "2025-09-30", 407.7, "10-K", 2025, "FY", "2026-03-02", "0001193125-26-085102"],
  ["2025-01-01", "2025-12-31", 407.7, "10-K", 2025, "FY", "2026-03-02", "0001193125-26-085102"],
]);

console.log("1. LHX: the 97-day row carrying the year is refused");
{
  const ex = X.extractCompanyFacts("LHX", LHX);
  const q4 = q(ex, "2025-01-03");
  check("Q4 FY2024 = 21,325.0 − 15,802.0 = 5,523.0, differenced", q4?.val === 5523 * M && q4?.derived === "differenced", JSON.stringify(q4));
  const sum = ["2024-03-29", "2024-06-28", "2024-09-27", "2025-01-03"].reduce((a, e) => a + (q(ex, e)?.val ?? 0), 0);
  check("the four quarters sum to the year", sum === y(ex, "2025-01-03")?.val, `${sum / M} vs ${y(ex, "2025-01-03")?.val / M}`);
}

console.log("\n2. VICR: the 10-K's mis-dated Q3 loses to the 10-Q's");
{
  const ex = X.extractCompanyFacts("VICR", VICR);
  check("Q3 FY2025 = 110.4 (10-Q), not 407.7", q(ex, "2025-09-30")?.val === 110.4 * M, JSON.stringify(q(ex, "2025-09-30")));
  check("Q4 FY2025 = 407.7 − 300.4 = 107.3", Math.abs((q(ex, "2025-12-31")?.val ?? 0) - 107.3 * M) < 1);
}

console.log("\n3. what is not touched");
{
  const rows = X.fullYearOnQuarterFrame(LHX.facts["us-gaap"][TAG].units.USD);
  check("exactly one LHX row refused, the 97-day one", rows.size === 1 && [...rows][0].start === "2024-09-28");
  // BKV's shape: a 10-K/A restates the year; no quarter row equals it, so nothing is refused.
  const bkv = facts([
    ["2025-01-01", "2025-09-30", 636.0, "10-Q", 2025, "Q3", "2025-11-10", "0001628280-25-051049"],
    ["2025-01-01", "2025-12-31", 893.8, "10-K", 2025, "FY", "2026-03-06", "0001628280-26-015661"],
    ["2025-01-01", "2025-12-31", 1140.8, "10-K/A", 2025, "FY", "2026-08-19", "0001104659-26-098821"],
  ]);
  check("a restated year with no quarter equal to it: nothing refused", X.fullYearOnQuarterFrame(bkv.facts["us-gaap"][TAG].units.USD).size === 0);
  // A filer whose Q4 genuinely is its whole year (nothing in the first nine months):
  // no smaller row inside the year, so the quarter stands.
  const lumpy = facts([
    ["2025-10-01", "2025-12-31", 50.0, "10-K", 2025, "FY", "2026-03-01", "0000000001-26-000001"],
    ["2025-01-01", "2025-12-31", 50.0, "10-K", 2025, "FY", "2026-03-01", "0000000001-26-000001"],
  ]);
  check("no smaller year-to-date figure: a Q4 equal to its year is kept", X.fullYearOnQuarterFrame(lumpy.facts["us-gaap"][TAG].units.USD).size === 0);
}

console.log("\n4. mutation");
{
  const mutated = extractRaw.replace("          if (misdated.has(row)) continue;\n", "");
  check("the mutation applied", mutated !== extractRaw);
  const XM = await load(mutated);
  const m = q(XM.extractCompanyFacts("LHX", LHX), "2025-01-03");
  check("MUTATION: keeping the row puts the year back in Q4 (caught)", m?.val === 21325 * M, JSON.stringify(m));
}

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nA year's figure on a quarter's dates is not a quarter.");
