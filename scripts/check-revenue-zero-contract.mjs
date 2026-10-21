// A ZERO CONTRACT LINE BESIDE A FILED TOTAL (yoy60 2e, REXR).
//
// REXR's rows (relay field-trace, run 39480745218), in $M: FY2025 Revenues
// 1,003.1, contract line 0.6, lease income 980.4 (10-K 0001571283-26-000006);
// its newest quarter files 0 under the contract tag. The total-over-contract
// rule required the contract line > 0, so every period read the 0.1-0.6M
// sub-line. Pinned: REXR reads Revenues; and the mutation back to "> 0" is caught.
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
const row = (start, end, v, form, fy, fp, filed) => ({ start, end, val: v * M, form, fy, fp, filed, accn: `${form}-${end}` });
const REXR = { cik: 1, entityName: "F", facts: { "us-gaap": {
  Revenues: { units: { USD: [row("2025-01-01", "2025-12-31", 1003.1, "10-K", 2025, "FY", "2026-02-11"), row("2026-04-01", "2026-06-30", 262.0, "10-Q", 2026, "Q2", "2026-07-25")] } },
  RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [row("2025-01-01", "2025-12-31", 0.6, "10-K", 2025, "FY", "2026-02-11"), row("2026-04-01", "2026-06-30", 0, "10-Q", 2026, "Q2", "2026-07-25")] } },
} } };
const y = (ex) => ex.years.find((p) => p.end === "2025-12-31")?.values?.[REV]?.val ?? null;
const q = (ex) => ex.quarters.find((p) => p.end === "2026-06-30")?.values?.[REV]?.val ?? null;
const r = X.extractCompanyFacts("REXR", REXR);
check("FY2025 reads Revenues 1,003.1", y(r) === 1003.1 * M, String(y(r)));
check("Q2 2026 reads Revenues 262.0", q(r) === 262 * M, String(q(r)));
{
  const m = extractRaw.replace("rev.val != null && rev.val >= 0 && isTotal(fb)", "rev.val != null && rev.val > 0 && isTotal(fb)");
  check("the mutation is applied", m !== extractRaw);
  check("MUTATION: \"> 0\" back → REXR on the 0.6 sub-line, caught", y((await load(m)).extractCompanyFacts("REXR", REXR)) === 0.6 * M);
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
