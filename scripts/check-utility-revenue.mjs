// XEL'S REVENUE: RegulatedAndUnregulatedOperatingRevenue (earnings audit r1).
//
// XEL tags its total operating revenue under that concept and nothing above it
// in the revenue chain, so every revenue cell read "Not captured". Appended
// LAST, it fills that series and never displaces a concept above it.
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
  const both = payload([
    row("Revenues", "2025-01-01", "2025-12-31", 9000 * M), row(RU, "2025-01-01", "2025-12-31", 9100 * M),
  ]);
  const b25 = X.extractCompanyFacts("DUK", both).years.find((p) => p.end === "2025-12-31")?.values?.[REV];
  check("a filer tagging Revenues too keeps Revenues (the new concept is last)", b25?.tag === "Revenues", JSON.stringify(b25));
  const chain = X.SEC_FIELDS.find((f) => f.key === "revenue").chain;
  check("it is the last entry of the revenue chain", chain.at(-1) === RU);
}

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nA utility's total operating revenue is read.");
