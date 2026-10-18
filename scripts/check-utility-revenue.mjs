// XEL'S REVENUE: RegulatedAndUnregulatedOperatingRevenue (earnings audit r1).
//
// XEL tags its total operating revenue under that concept and nothing above it
// in the revenue chain, so every revenue cell read "Not captured". It is a
// PER-SERIES LAST RESORT, not a chain entry: as a chain fallback it mixed two
// measures into DUK's and TLN's series (relay write-earnings-audit-r1-scan).
// KEY/CRCL are pinned in check-revenue-fallback 3d.
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

console.log("XEL: RegulatedAndUnregulatedOperatingRevenue");
{
  const M = 1e6;
  const row = (tag, start, end, val, form = "10-K") => [tag, { start, end, val, accn: "0000072903-26-000001", fy: 2026, fp: "FY", form, filed: "2026-02-20" }];
  const payload = (rows) => {
    const g = {};
    for (const [tag, r] of rows) ((g[tag] ??= { units: { USD: [] } }).units.USD).push(r);
    return { cik: 72903, entityName: "Fixture", facts: { "us-gaap": g } };
  };
  const RU = "RegulatedAndUnregulatedOperatingRevenue";
  const xel = payload([
    row(RU, "2024-01-01", "2024-12-31", 13441 * M), row(RU, "2025-01-01", "2025-12-31", 14669 * M),
    row("OperatingIncomeLoss", "2025-01-01", "2025-12-31", 2600 * M),
  ]);
  const fy25 = X.extractCompanyFacts("XEL", xel).years.find((p) => p.end === "2025-12-31")?.values?.[REV];
  check("XEL FY2025 reads $14,669M", fy25?.val === 14669 * M && fy25?.tag === RU, JSON.stringify(fy25));
  // DUK/TLN's shape: the contract line on the newest periods, the utility
  // concept on an older year the contract line does not cover.
  const duk = payload([
    row("RevenueFromContractWithCustomerExcludingAssessedTax", "2025-01-01", "2025-12-31", 9000 * M),
    row(RU, "2024-01-01", "2024-12-31", 9300 * M),
  ]);
  const d = X.extractCompanyFacts("DUK", duk);
  const d24 = d.years.find((p) => p.end === "2024-12-31")?.values?.[REV];
  check("a filer with a revenue line never takes the utility concept (no mixed series)", d24 == null, JSON.stringify(d24));
  const chain = X.SEC_FIELDS.find((f) => f.key === "revenue").chain;
  check("it is not a chain entry", !chain.includes(RU));
  const asChain = extractSrc.replace('chain: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"]',
    `chain: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax", "${RU}"]`);
  const XC = await lift(`${fieldsSrc.replace('chain: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"]',
    `chain: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax", "${RU}"]`)}\n${fxSrc}\n${currencyRaw}\n${asChain}`);
  const m24 = XC.extractCompanyFacts("DUK", duk).years.find((p) => p.end === "2024-12-31")?.values?.[REV];
  check("MUTATION: as a chain entry DUK's older year takes the utility concept (caught)", m24?.tag === RU, JSON.stringify(m24));
}

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nA utility's total operating revenue is read.");
