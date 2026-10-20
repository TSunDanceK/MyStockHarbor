// A DERIVED Q4 FAR OUTSIDE ITS NEIGHBOURS (yoy60 2b).
//
// FY - 9M beyond DERIVED_Q4_BAND of the year's other quarters is withheld only
// when it is also beyond DERIVED_Q4_YOY_BAND of the filer's own year-ago Q4,
// and only when the three siblings are steady. Pinned: an outlier refused; a
// retailer's holiday Q4 (4.5x its siblings, as it is every year) kept and noted
// seasonal; a first year with no year-ago Q4 stands; a lumpy biotech is not
// judged; and the rule's two tests are each caught by a mutation.
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

const N = (ex) => (ex.notes ?? []).join(" | ");
console.log("1. the pure verdict");
check("x10 its siblings and x10 its year-ago Q4: outlier", X.q4OutlierVerdict(1000, [100, 100, 100], 100) === "outlier");
check("x5 its siblings, as last year: seasonal", X.q4OutlierVerdict(500, [100, 100, 110], 480) === "seasonal");
check("x2 its siblings: not judged", X.q4OutlierVerdict(200, [100, 100, 100], 50) === null);
check("no year-ago Q4: stands", X.q4OutlierVerdict(1000, [100, 100, 100], null) === null);
check("lumpy siblings (x10 apart): not judged", X.q4OutlierVerdict(1000, [10, 100, 50], 100) === null);
check("a collapse (x0.1) against a normal year-ago Q4: outlier", X.q4OutlierVerdict(10, [100, 100, 100], 100) === "outlier");

console.log("\n2. through the extraction");
const OUT = facts([...year(2023, [100, 100, 100, 100]), ...year(2024, [100, 105, 110, 0], 1300)]);
const o = X.extractCompanyFacts("OUT", OUT);
check("derived Q4 985 against siblings ~105 and a year-ago Q4 100: refused", q(o, "2024-12-31") === null, String(q(o, "2024-12-31")));
check("...the year stays", y(o, "2024-12-31") === 1300 * M);
const RTL = facts([...year(2023, [100, 100, 110, 480]), ...year(2024, [105, 100, 110, 500])]);
const r = X.extractCompanyFacts("RTL", RTL);
check("a holiday Q4 4.8x its siblings, as the year before: kept", q(r, "2024-12-31") === 500 * M, String(q(r, "2024-12-31")));
check("...and noted seasonal", /kept \(seasonal\)/.test(N(r)), N(r));
const FIRST = facts([...year(2024, [100, 105, 110, 0], 1300)]);
check("a first year (no year-ago Q4) stands", q(X.extractCompanyFacts("FST", FIRST), "2024-12-31") === 985 * M);

console.log("\n3. mutations");
{
  const a = extractRaw.replace("if (r <= DERIVED_Q4_BAND && r >= 1 / DERIVED_Q4_BAND) return null;", "");
  check("the band mutation is applied", a !== extractRaw);
  check("MUTATION: band off → the ordinary x2 Q4 judged, caught", (await load(a)).q4OutlierVerdict(200, [100, 100, 100], 50) !== null);
  const b = extractRaw.replace('return y <= DERIVED_Q4_YOY_BAND && y >= 1 / DERIVED_Q4_YOY_BAND ? "seasonal" : "outlier";', 'return "outlier";');
  check("the year-ago mutation is applied", b !== extractRaw);
  check("MUTATION: year-ago test off → the retailer's Q4 refused, caught", q((await load(b)).extractCompanyFacts("RTL", RTL), "2024-12-31") === null);
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
