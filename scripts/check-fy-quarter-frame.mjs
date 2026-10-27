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
// in $M. LHX's FY2025 10-K goes further: 21,865.0 on Q4's dates and NO 2025
// year row at all; that row is read as the year (L3Harris reported FY2025
// $21,865M and Q4 $5,648M), so Q4 = 21,865 − 16,217. Pinned: the quarter is
// refused and Q4 = FY − 9M; VICR's Q3 comes from
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
  check("exactly one LHX row refused, the 97-day one", rows.size === 1 && [...rows.keys()][0].start === "2024-09-28" && [...rows.values()][0] === null);
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
  // GWRE (audit r5): a loss year near zero. Its FY2026 10-K puts FY2024's
  // -6.1M on the Q4 dates too; the six and nine months are LARGER losses, so
  // "smaller than the year" never fired. Rows as filed (FY ends July).
  const gwre = facts([
    ["2023-08-01", "2023-10-31", -27.1, "10-Q", 2024, "Q1", "2023-12-08", "0001528396-23-000137"],
    ["2023-08-01", "2024-01-31", -17.4, "10-Q", 2024, "Q2", "2024-03-08", "0001528396-24-000017"],
    ["2023-08-01", "2024-04-30", -22.9, "10-Q", 2024, "Q3", "2024-06-05", "0001528396-24-000057"],
    ["2024-05-01", "2024-07-31", -6.1, "10-K", 2026, "FY", "2026-09-11", "0001528396-26-000046"],
    ["2023-08-01", "2024-07-31", -6.1, "10-K", 2026, "FY", "2026-09-11", "0001528396-26-000046"],
  ]);
  const gx = X.extractCompanyFacts("GWRE", gwre);
  check("GWRE: a loss year's figure on its Q4 dates is refused, and Q4 is FY - 9M = 16.8",
    X.fullYearOnQuarterFrame(gwre.facts["us-gaap"][TAG].units.USD).size === 1 && Math.abs((q(gx, "2024-07-31")?.val ?? NaN) - 16.8 * M) < 1,
    String(q(gx, "2024-07-31")?.val));
  {
    const old = await load(extractRaw.replace("&& days(r) > d && days(r) < 350 && r.val !== y.val);", "&& days(r) > d && days(r) < 350 && Math.abs(r.val) < Math.abs(y.val!));"));
    check("MUTATION: the old 'smaller' test keeps GWRE's -6.1M as its Q4 (caught)", old.extractCompanyFacts("GWRE", gwre).quarters.find((p) => p.end === "2024-07-31")?.values?.[REV]?.val === -6.1 * M);
  }
}

console.log("\n4. LHX FY2025: the year on Q4's dates with no year row beside it");
const LHX25 = facts([
  ["2025-01-04", "2025-03-28", 5132.0, "10-Q", 2025, "Q1", "2025-04-24", "0000202058-25-000201"],
  ["2025-03-29", "2025-06-27", 5426.0, "10-Q", 2025, "Q2", "2025-07-24", "0000202058-25-000202"],
  ["2025-01-04", "2025-06-27", 10558.0, "10-Q", 2025, "Q2", "2025-07-24", "0000202058-25-000202"],
  ["2025-06-28", "2025-10-03", 5659.0, "10-Q", 2025, "Q3", "2025-10-23", "0000202058-25-000203"],
  ["2025-01-04", "2025-10-03", 16217.0, "10-Q", 2025, "Q3", "2025-10-23", "0000202058-25-000203"],
  ["2025-10-04", "2026-01-02", 21865.0, "10-K", 2025, "FY", "2026-02-12", "0000202058-26-000099"],
  ["2023-12-30", "2025-01-03", 21325.0, "10-K", 2025, "FY", "2026-02-12", "0000202058-26-000099"],
]);
{
  const ex = X.extractCompanyFacts("LHX", LHX25);
  const q4 = q(ex, "2026-01-02");
  check("the 21,865M row is read as FY2025 (2025-01-04..2026-01-02)", y(ex, "2026-01-02")?.val === 21865 * M
    && y(ex, "2026-01-02")?.covers?.[0] === "2025-01-04", JSON.stringify(y(ex, "2026-01-02")));
  check("...and Q4 FY2025 = 21,865 − 16,217 = 5,648M, differenced (as L3Harris reported)", q4?.val === 5648 * M && q4?.derived === "differenced", JSON.stringify(q4));
  check("...Q3 stays 5,659M", q(ex, "2025-10-03")?.val === 5659 * M);
  const sum = ["2025-03-28", "2025-06-27", "2025-10-03", "2026-01-02"].reduce((a, e) => a + (q(ex, e)?.val ?? 0), 0);
  check("...the four quarters sum to the year", sum === 21865 * M, `${sum / M}`);
  // A real, big fourth quarter is kept: 120 after nine months of 300 (avg 100).
  const big = facts([
    ["2025-01-01", "2025-09-30", 300, "10-Q", 2025, "Q3", "2025-10-30", "0000000000-25-000003"],
    ["2025-07-01", "2025-09-30", 100, "10-Q", 2025, "Q3", "2025-10-30", "0000000000-25-000003"],
    ["2025-10-01", "2025-12-31", 260, "10-K", 2025, "FY", "2026-02-20", "0000000000-26-000001"],
    ["2024-01-01", "2024-12-31", 380, "10-K", 2025, "FY", "2026-02-20", "0000000000-26-000001"],
  ]);
  // HHH: a real 983.6M Q4 2024 filed in the 10-K beside its 1,750.7M year.
  // It is the nine months (767.1) plus about one average quarter too, but a
  // year row ends on its date, so it is no year-on-a-quarter's-dates.
  const hhh = facts([
    ["2024-01-01", "2024-03-31", 156.5, "10-Q", 2024, "Q1", "2024-05-08", "0001981792-24-000010"],
    ["2024-04-01", "2024-06-30", 283.5, "10-Q", 2024, "Q2", "2024-08-07", "0001981792-24-000020"],
    ["2024-01-01", "2024-09-30", 767.1, "10-Q", 2024, "Q3", "2024-11-06", "0001981792-24-000030"],
    ["2024-07-01", "2024-09-30", 327.1, "10-Q", 2024, "Q3", "2024-11-06", "0001981792-24-000030"],
    ["2024-10-01", "2024-12-31", 983.6, "10-K", 2025, "FY", "2026-02-25", "0001981792-26-000005"],
    ["2024-01-01", "2024-12-31", 1750.7, "10-K", 2025, "FY", "2026-02-25", "0001981792-26-000005"],
  ]);
  const hx = X.extractCompanyFacts("HHH", hhh);
  check("HHH: a real large Q4 beside its own year row is not refused (983.6M), and the year stays 1,750.7M",
    X.fullYearOnQuarterFrame(hhh.facts["us-gaap"][TAG].units.USD).size === 0 && y(hx, "2024-12-31")?.val === 1750.7 * M,
    JSON.stringify({ q4: q(hx, "2024-12-31"), fy: y(hx, "2024-12-31") }));
  check("a genuine Q4 of 2.6x the average (260 after 300) is kept", q(X.extractCompanyFacts("BIG", big), "2025-12-31")?.val === 260 * M,
    JSON.stringify(q(X.extractCompanyFacts("BIG", big), "2025-12-31")));
}

console.log("\n5. mutation");
{
  const mutated = extractRaw.replace("const asRead = misdated.has(row) ? misdated.get(row) : row;", "const asRead = row;");
  check("the mutation applied", mutated !== extractRaw);
  const XM = await load(mutated);
  const m = q(XM.extractCompanyFacts("LHX", LHX), "2025-01-03");
  check("MUTATION: keeping the row puts the year back in Q4 (caught)", m?.val === 21325 * M, JSON.stringify(m));
}

{
  const from = "      if (q.val > 2 * avg && rest >= 0.5 * avg && rest <= 1.5 * avg) out.set(q, { ...q, start: nine.start, fp: \"FY\" });\n";
  if (extractRaw.split(from).length !== 2) throw new Error("mutation anchor (no-year branch) not unique");
  const XN = await load(extractRaw.replace(from, ""));
  const m = q(XN.extractCompanyFacts("LHX", LHX25), "2026-01-02");
  check("MUTATION: without the no-year branch LHX's Q4 FY2025 reads the 21,865M year (caught)", m?.val === 21865 * M, JSON.stringify(m));
  const XR = await load(extractRaw.replace(from, from.replace("{ ...q, start: nine.start, fp: \"FY\" }", "null")));
  const r = XR.extractCompanyFacts("LHX", LHX25);
  check("MUTATION: refusing the row instead leaves FY2025 and its Q4 Not reported (caught)", y(r, "2026-01-02")?.val == null && q(r, "2026-01-02")?.val == null);
}

{
  const guard = "      if (years.some((r) => Math.abs(Date.parse(r.end!) - Date.parse(q.end!)) <= 8 * DAY)) continue;\n";
  if (extractRaw.split(guard).length !== 2) throw new Error("mutation anchor (year-row guard) not unique");
  const XY = await load(extractRaw.replace(guard, ""));
  const hhh = facts([
    ["2024-01-01", "2024-09-30", 767.1, "10-Q", 2024, "Q3", "2024-11-06", "0001981792-24-000030"],
    ["2024-10-01", "2024-12-31", 983.6, "10-K", 2025, "FY", "2026-02-25", "0001981792-26-000005"],
    ["2024-01-01", "2024-12-31", 1750.7, "10-K", 2025, "FY", "2026-02-25", "0001981792-26-000005"],
  ]);
  check("MUTATION: without the year-row guard HHH's real Q4 2024 is refused (caught)",
    XY.fullYearOnQuarterFrame(hhh.facts["us-gaap"][TAG].units.USD).size === 1);
}

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nA year's figure on a quarter's dates is not a quarter.");
