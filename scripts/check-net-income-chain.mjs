// NET INCOME FROM THE COMMON-AVAILABLE CONCEPT, LAST IN THE CHAIN (#552 COWORK #187 §4).
//
// BKNG files its 10-Q net income only as NetIncomeLossAvailableToCommonStock-
// holdersBasic; NetIncomeLoss appears on its years alone. Pinned on a
// companyfacts-shaped payload of that shape:
//   FILLED    the quarters resolve, and Q4 derives as FY − 9M
//   UNTOUCHED a filer tagging NetIncomeLoss on its newest period keeps it,
//             although a smaller available-to-common figure (preferred
//             dividends) sits beside it
// plus a mutation: the chain entry removed, and BKNG's quarters go blank.
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
const extractSrc = fs.readFileSync("lib/server/secExtract.ts", "utf8")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secFields";/, "")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secCurrency";/, "");
const load = (fields) => lift(`${fields}\n${fxSrc}\n${currencySrc}\n${extractSrc}`);
const X = await load(fieldsSrc);
const NI = X.SEC_FIELD_KEYS.indexOf("netIncome");

const M = 1e6;
const row = (start, end, val, form) => ({ start, end, val, accn: "0000000000-26-000001", fy: 2025, fp: form === "10-K" ? "FY" : "Q3", form, filed: "2026-02-01" });
const payload = (tags) => ({
  cik: 1, entityName: "Fixture",
  facts: { "us-gaap": Object.fromEntries(Object.entries(tags).map(([tag, rows]) => [tag, { units: { USD: rows.map(([s, e, v, f = "10-Q"]) => row(s, e, v, f)) } }])) },
});
const AVAIL = "NetIncomeLossAvailableToCommonStockholdersBasic";
const Y = "2025-01-01";
// BKNG-shaped: NetIncomeLoss on the year only, every quarter -- including the
// newest, 2026 Q1 -- under the available-to-common concept. That newest quarter
// is what makes it the filer's preferred concept, so the FY row and the 9M row
// resolve from ONE concept and Q4 can be differenced. Round numbers, not BKNG's.
const bkng = payload({
  NetIncomeLoss: [[Y, "2025-12-31", 6000 * M, "10-K"]],
  [AVAIL]: [
    [Y, "2025-03-31", 1000 * M], [Y, "2025-06-30", 2500 * M], [Y, "2025-09-30", 4500 * M],
    ["2025-04-01", "2025-06-30", 1500 * M], ["2025-07-01", "2025-09-30", 2000 * M],
    [Y, "2025-12-31", 6000 * M, "10-K"],
    ["2026-01-01", "2026-03-31", 1100 * M],
  ],
});
const quarter = (facts, end) => X.extractCompanyFacts("FIX", facts).quarters.find((p) => p.end === end)?.values?.[NI];

console.log("1. BKNG's quarters fill from the available-to-common concept");
for (const [end, want] of [["2025-03-31", 1000], ["2025-06-30", 1500], ["2025-09-30", 2000]]) {
  const v = quarter(bkng, end);
  check(`${end}: ${want}M`, v?.val === want * M && v?.tag === AVAIL, JSON.stringify(v));
}
{
  const q4 = quarter(bkng, "2025-12-31");
  check("Q4 derives as FY − 9M (1,500M)", q4?.val === 1500 * M, JSON.stringify(q4));
}

console.log("\n2. a filer tagging NetIncomeLoss on its newest period keeps it");
{
  const facts = payload({
    NetIncomeLoss: [["2026-04-01", "2026-06-30", 900 * M]],
    [AVAIL]: [["2026-04-01", "2026-06-30", 850 * M]],
  });
  const v = quarter(facts, "2026-06-30");
  check("NetIncomeLoss 900M, not the 850M after preferred dividends", v?.val === 900 * M && v?.tag === "NetIncomeLoss", JSON.stringify(v));
}

console.log("\n3. mutation");
{
  const mutated = fieldsSrc.replace(`"ProfitLoss", "${AVAIL}"]`, `"ProfitLoss"]`);
  check("the mutation applied", mutated !== fieldsSrc);
  const XM = await load(mutated);
  const v = XM.extractCompanyFacts("FIX", bkng).quarters.find((p) => p.end === "2025-06-30")?.values?.[NI];
  check("MUTATION: without the entry BKNG's quarter is blank", v == null || v.val == null, JSON.stringify(v));
}

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nNet income fills from the common-available concept only where nothing ranks above it.");
