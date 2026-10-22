// A LESSOR'S REVENUE IS ITS LEASE INCOME TOO (owner ruling, CPT audit).
//
// Pinned: CPT's shape (contract line 13.0M, lease income 1,573.5M, no
// `Revenues`) reads the sum, years and quarters; a filer whose `Revenues` is
// filed is untouched; a retailer whose lease income is a sliver of its sales
// is untouched; and the rule's two guards are each caught by a mutation.
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
const C = "RevenueFromContractWithCustomerExcludingAssessedTax", L = "OperatingLeaseLeaseIncome", R = "Revenues";
const row = (start, end, v, form, fy, fp, filed, accn) => ({ start, end, val: v * M, form, fy, fp, filed, accn });
// Q1-Q3 as filed, the nine months, the year: one concept's rows for one fiscal year.
const yr = (y, q, fyv) => [
  row(`${y}-01-01`, `${y}-03-31`, q[0], "10-Q", y, "Q1", `${y}-05-01`, `q1-${y}`),
  row(`${y}-04-01`, `${y}-06-30`, q[1], "10-Q", y, "Q2", `${y}-08-01`, `q2-${y}`),
  row(`${y}-07-01`, `${y}-09-30`, q[2], "10-Q", y, "Q3", `${y}-11-01`, `q3-${y}`),
  row(`${y}-01-01`, `${y}-09-30`, q[0] + q[1] + q[2], "10-Q", y, "Q3", `${y}-11-01`, `q3-${y}`),
  row(`${y}-01-01`, `${y}-12-31`, fyv, "10-K", y, "FY", `${y + 1}-02-15`, `k-${y}`),
];
const facts = (tags) => ({ cik: 1, entityName: "Fixture", facts: { "us-gaap": Object.fromEntries(Object.entries(tags).map(([t, rows]) => [t, { units: { USD: rows } }])) } });
const y = (ex, end) => ex.years.find((p) => p.end === end)?.values?.[REV]?.val ?? null;
const q = (ex, end) => ex.quarters.find((p) => p.end === end)?.values?.[REV]?.val ?? null;

console.log("1. CPT's shape");
const CPT = facts({ [C]: yr(2025, [2.5, 2.6, 2.6], 13.0), [L]: yr(2025, [390, 393, 395], 1573.5) });
const c = X.extractCompanyFacts("CPT", CPT);
check("FY2025 reads 13.0 + 1,573.5 = 1,586.5", Math.abs(y(c, "2025-12-31") - 1586.5 * M) < 1, String(y(c, "2025-12-31")));
check("Q1 reads 2.5 + 390 = 392.5", Math.abs(q(c, "2025-03-31") - 392.5 * M) < 1, String(q(c, "2025-03-31")));
check("...marked computed", c.years.find((p) => p.end === "2025-12-31")?.values?.[REV]?.derived === "computed");

console.log("\n2. what must stay");
const TOT = facts({ [C]: yr(2025, [2.5, 2.6, 2.6], 13.0), [L]: yr(2025, [390, 393, 395], 1573.5), [R]: yr(2025, [392.5, 395.6, 397.6], 1586.5) });
check("a filer that files `Revenues` reads its own total", Math.abs(y(X.extractCompanyFacts("TOT", TOT), "2025-12-31") - 1586.5 * M) < 1);
const RTL = facts({ [C]: yr(2025, [1000, 1100, 1200], 4500), [L]: yr(2025, [5, 5, 5], 20) });
check("a retailer's sublease income (20 of 4,500) is not added", y(X.extractCompanyFacts("RTL", RTL), "2025-12-31") === 4500 * M, String(y(X.extractCompanyFacts("RTL", RTL), "2025-12-31")));

console.log("\n3. mutations");
{
  const a = extractRaw.replace("nl.val >= ny.val", "true");
  check("the lessor mutation is applied", a !== extractRaw);
  check("MUTATION: lessor test off → the retailer's sublease added, caught", y((await load(a)).extractCompanyFacts("RTL", RTL), "2025-12-31") !== 4500 * M);
  const b = extractRaw.replace("if (totalFiled(c)) continue;", "");
  check("the total mutation is applied", b !== extractRaw);
  // A filed `Revenues` equal to the contract line (not over it by 5%, so the
  // contract line stays the cell): the filer's own total says lease income is
  // not revenue here, and nothing may be added.
  const EQ = facts({ [C]: yr(2025, [250, 250, 250], 1000), [R]: yr(2025, [250, 250, 250], 1000), [L]: yr(2025, [300, 300, 300], 1200) });
  check("a filed total beside the contract line blocks the sum", y(X.extractCompanyFacts("EQ", EQ), "2025-12-31") === 1000 * M, String(y(X.extractCompanyFacts("EQ", EQ), "2025-12-31")));
  check("MUTATION: filed-total test off → EQ's lease income added, caught", y((await load(b)).extractCompanyFacts("EQ", EQ), "2025-12-31") === 2200 * M);
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
