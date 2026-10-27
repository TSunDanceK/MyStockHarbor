// THE OWNER'S TOTAL FOR WMT, DUK AND NEE (REVENUE_TOTAL_RULINGS, earnings audit r2).
//
// Rows are the filers' own (relay field-trace, run 39476124121), in $M:
//   WMT FY2026: Revenues 713,163.0; contract line 706,413.0 (10-K 0000104169-26-000055)
//   DUK FY2025: RegulatedAndUnregulatedOperatingRevenue 32,237.0; contract line
//        (including tax) 31,741.0 (10-K 0001326160-26-000014)
// Pinned: both read their total; a period with only the contract line reads Not
// reported (one basis); an unlisted filer with the same rows keeps the contract
// line; and the mutation that drops the block is caught.
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
const facts = (byTag) => ({ cik: 1, entityName: "Fixture", facts: { "us-gaap": Object.fromEntries(Object.entries(byTag).map(([tag, rows]) =>
  [tag, { units: { USD: rows.map(([start, end, v, form, fy, fp, filed, accn]) => ({ start, end, val: v * M, form, fy, fp, filed, accn })) } }])) } });
const rev = (ex, end) => ex.years.find((p) => p.end === end)?.values?.[REV]?.val ?? null;

const CT = "RevenueFromContractWithCustomerExcludingAssessedTax";
const WMT = facts({
  Revenues: [["2025-02-01", "2026-01-31", 713163.0, "10-K", 2026, "FY", "2026-03-13", "0000104169-26-000055"]],
  [CT]: [
    ["2024-02-01", "2025-01-31", 674538.0, "10-K", 2025, "FY", "2025-03-14", "0000104169-25-000021"],
    ["2025-02-01", "2026-01-31", 706413.0, "10-K", 2026, "FY", "2026-03-13", "0000104169-26-000055"],
  ],
});
console.log("1. WMT reads total revenues");
const w = X.extractCompanyFacts("WMT", WMT);
check("FY2026 reads 713,163.0 (Revenues)", rev(w, "2026-01-31") === 713163 * M, String(rev(w, "2026-01-31")));
check("FY2025, with only the contract line, reads Not reported (one basis)", rev(w, "2025-01-31") === null, String(rev(w, "2025-01-31")));
check("an unlisted filer with the same rows keeps the contract line", rev(X.extractCompanyFacts("ZZZZ", WMT), "2026-01-31") === 706413 * M);

console.log("\n2. DUK reads total operating revenues");
const DUK = facts({
  RegulatedAndUnregulatedOperatingRevenue: [["2025-01-01", "2025-12-31", 32237.0, "10-K", 2025, "FY", "2026-02-26", "0001326160-26-000014"]],
  RevenueFromContractWithCustomerIncludingAssessedTax: [["2025-01-01", "2025-12-31", 31741.0, "10-K", 2025, "FY", "2026-02-26", "0001326160-26-000014"]],
});
check("FY2025 reads 32,237.0", rev(X.extractCompanyFacts("DUK", DUK), "2025-12-31") === 32237 * M);

console.log("\n2d. REXR reads total Revenues (audit r3)");
const REXR = facts({
  Revenues: [["2025-01-01", "2025-12-31", 1003.1, "10-K", 2025, "FY", "2026-02-12", "rexr-k-2025"]],
  RevenueFromContractWithCustomerExcludingAssessedTax: [["2025-01-01", "2025-12-31", 0.6, "10-K", 2025, "FY", "2026-02-12", "rexr-k-2025"]],
  OperatingLeaseLeaseIncome: [["2025-01-01", "2025-12-31", 980.4, "10-K", 2025, "FY", "2026-02-12", "rexr-k-2025"]],
});
check("FY2025 reads 1,003.1, not the 0.6 contract sliver", rev(X.extractCompanyFacts("REXR", REXR), "2025-12-31") === 1003.1 * M, String(rev(X.extractCompanyFacts("REXR", REXR), "2025-12-31")));

console.log("\n2b. NEE reads total operating revenues (audit r3)");
const NEE = facts({
  RegulatedAndUnregulatedOperatingRevenue: [["2025-01-01", "2025-12-31", 27410.0, "10-K", 2025, "FY", "2026-02-15", "nee-k-2025"]],
  RevenueFromContractWithCustomerExcludingAssessedTax: [["2025-01-01", "2025-12-31", 25800.0, "10-K", 2025, "FY", "2026-02-15", "nee-k-2025"]],
});
check("FY2025 reads 27,410.0, not the 25,800 contract line", rev(X.extractCompanyFacts("NEE", NEE), "2025-12-31") === 27410 * M, String(rev(X.extractCompanyFacts("NEE", NEE), "2025-12-31")));

console.log("\n2c. IDA reads total operating revenues (audit r3)");
const IDA = facts({
  RegulatedAndUnregulatedOperatingRevenue: [["2025-01-01", "2025-12-31", 1812.997, "10-K", 2025, "FY", "2026-02-20", "ida-k-2025"]],
  RevenueFromContractWithCustomerExcludingAssessedTax: [["2025-01-01", "2025-12-31", 1746.972, "10-K", 2025, "FY", "2026-02-20", "ida-k-2025"]],
});
check("FY2025 reads 1,813.0, not the 1,747.0 contract line", rev(X.extractCompanyFacts("IDA", IDA), "2025-12-31") === 1812.997 * M, String(rev(X.extractCompanyFacts("IDA", IDA), "2025-12-31")));
check("NJR and SRE are not ruled (held)", !("NJR" in X.REVENUE_TOTAL_RULINGS) && !("SRE" in X.REVENUE_TOTAL_RULINGS));

console.log("\n3. mutation");
{
  const src = extractRaw.replace('const ruled = REVENUE_TOTAL_RULINGS[String(symbol ?? "").toUpperCase()];', "const ruled = undefined as string | undefined;");
  check("the mutation is applied", src !== extractRaw);
  const Xm = await load(src);
  check("MUTATION: block off → WMT back to the contract line, caught", rev(Xm.extractCompanyFacts("WMT", WMT), "2026-01-31") !== 713163 * M);
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
