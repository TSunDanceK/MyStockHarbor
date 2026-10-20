// A QUARTER THAT IS A YEAR, A YEAR THAT IS A QUARTER (earnings audit r2, yoy60 2a).
//
// Shapes from the yoy60 census (relay write-yoy60-classify, runs 39471642001..
// 39471655743), in $M: PLXS Q4 FY2024 read 3,957.9 (its year); FIX FY2025 read
// 1,831.3 against quarters summing past 7,000. Pinned: both refused; a lumpy
// quarter whose siblings are near zero stays; a retailer's 35% Q4 stays; a year
// with fewer than two quarters is not judged; and two mutations are caught.
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
const facts = (rows) => ({ cik: 1, entityName: "Fixture", facts: { "us-gaap": { [TAG]: { units: { USD: rows.map(([start, end, v, form, fy, fp, filed, accn]) => ({ start, end, val: v * M, form, fy, fp, filed, accn })) } } } } });
const q = (ex, end) => ex.quarters.find((p) => p.end === end)?.values?.[REV]?.val ?? null;
const y = (ex, end) => ex.years.find((p) => p.end === end)?.values?.[REV]?.val ?? null;
// three discrete 10-Q quarters, the nine months, a 10-K year (Q4 = FY - 9M); q4 overridable
const year = (y0, vals, fyVal, q4Override) => {
  const [a, b, c, d] = vals;
  return [
    [`${y0}-01-01`, `${y0}-03-31`, a, "10-Q", y0, "Q1", `${y0}-05-01`, `q1-${y0}`],
    [`${y0}-04-01`, `${y0}-06-30`, b, "10-Q", y0, "Q2", `${y0}-08-01`, `q2-${y0}`],
    [`${y0}-07-01`, `${y0}-09-30`, c, "10-Q", y0, "Q3", `${y0}-11-01`, `q3-${y0}`],
    [`${y0}-01-01`, `${y0}-09-30`, a + b + c, "10-Q", y0, "Q3", `${y0}-11-01`, `q3-${y0}`],
    ...(q4Override != null ? [[`${y0}-10-01`, `${y0}-12-31`, q4Override, "8-K", y0, "Q4", `${y0 + 1}-03-01`, `x-${y0}`]] : []),
    [`${y0}-01-01`, `${y0}-12-31`, fyVal ?? a + b + c + d, "10-K", y0, "FY", `${y0 + 1}-02-15`, `k-${y0}`],
  ];
};

console.log("1. a year read as a quarter (PLXS shape)");
const PLXS = facts([...year(2024, [976, 961, 976, 1045], 3958, 3958)]);
const p = X.extractCompanyFacts("PLXS", PLXS);
check("Q4 3,958 of a 3,958 year, siblings 2,913: refused", q(p, "2024-12-31") === null, String(q(p, "2024-12-31")));
check("Q1 976 stays", q(p, "2024-03-31") === 976 * M);
check("the year stays", y(p, "2024-12-31") === 3958 * M);

console.log("\n2. a quarter read as a year (FIX shape)");
const FIX = facts([...year(2025, [1600, 1750, 1830, 1850], 1831.3)]);
const f = X.extractCompanyFacts("FIX", FIX);
check("FY 1,831.3 against quarters of 5,180+: refused", y(f, "2025-12-31") === null, String(y(f, "2025-12-31")));
check("Q1 1,600 stays", q(f, "2025-03-31") === 1600 * M);

console.log("\n2b. a RECAST year (a later 10-K's comparative, discontinued operations out): the quarters are stale");
const RECAST = facts([...year(2024, [1000, 1000, 1000, 1000], 4000), ["2024-01-01", "2024-12-31", 1100, "10-K", 2025, "FY", "2026-02-15", "k-2025"]]);
const rc = X.extractCompanyFacts("RCST", RECAST);
check("the recast year 1,100 stays", y(rc, "2024-12-31") === 1100 * M, String(y(rc, "2024-12-31")));
check("the stale Q1 1,000 is refused", q(rc, "2024-03-31") === null, String(q(rc, "2024-03-31")));
check("the derived Q4 is refused", q(rc, "2024-12-31") === null, String(q(rc, "2024-12-31")));
check("FIX (year filed once, not recast) still loses the year", y(f, "2025-12-31") === null);

console.log("\n3. what must stay");
const LUMP = facts([...year(2024, [0.1, 0.2, 100, 0.1], 100.4)]);
check("a lumpy biotech quarter (100 of 100.4, siblings 0.4) stays", q(X.extractCompanyFacts("BIO", LUMP), "2024-09-30") === 100 * M);
const RETAIL = facts([...year(2024, [150, 160, 170, 260], 740)]);
const r = X.extractCompanyFacts("RTL", RETAIL);
check("a retailer's Q4 (35% of the year) stays", q(r, "2024-12-31") === 260 * M, String(q(r, "2024-12-31")));
check("...and its year stays", y(r, "2024-12-31") === 740 * M);
const ONE = facts([["2024-01-01", "2024-03-31", 500, "10-Q", 2024, "Q1", "2024-05-01", "a"], ["2024-01-01", "2024-12-31", 150, "10-K", 2024, "FY", "2025-02-01", "b"]]);
check("a year with one quarter is not judged", y(X.extractCompanyFacts("ONE", ONE), "2024-12-31") === 150 * M);

console.log("\n4. mutations");
{
  const a = extractRaw.replace("q.val >= QUARTER_OF_YEAR_MAX * (y.val as number) && others", "false && others");
  check("the quarter mutation is applied", a !== extractRaw);
  check("MUTATION: quarter test off → PLXS Q4 kept, caught", q((await load(a)).extractCompanyFacts("PLXS", PLXS), "2024-12-31") !== null);
  const b = extractRaw.replace("if (y.val < YEAR_OF_QUARTERS_MIN * sum) {", "if (false) {");
  check("the year mutation is applied", b !== extractRaw);
  check("MUTATION: year test off → FIX FY kept, caught", y((await load(b)).extractCompanyFacts("FIX", FIX), "2025-12-31") !== null);
  const c = extractRaw.replace("yf > qf && recast(y)", "false");
  check("the recast mutation is applied", c !== extractRaw);
  check("MUTATION: recast side off → RCST year refused, caught", y((await load(c)).extractCompanyFacts("RCST", RECAST), "2024-12-31") === null);
  const d = extractRaw.replace("yf > qf && recast(y)", "yf > qf");
  check("MUTATION: recast proof off → FIX quarters refused instead, caught", y((await load(d)).extractCompanyFacts("FIX", FIX), "2025-12-31") !== null);
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
