// QUARTERS FILED BEFORE THEIR OWN YEAR WAS RESTATED (IRM).
//
// Pinned: IRM's shape (FY2020 first filed 1,393.2 on the contract line, later
// restated to 4,147.3 with rental in; its quarters as the 10-Qs filed them)
// withholds the old-basis quarters and the derived Q4 while the restated year
// stands; a year that was never restated keeps its quarters; quarters refiled
// after the restatement stay; the rule's test is caught by a mutation.
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
const C = "RevenueFromContractWithCustomerExcludingAssessedTax";
const row = (start, end, v, form, fy, fp, filed, accn) => ({ start, end, val: v * M, form, fy, fp, filed, accn });
const quarters = (y, q, filed = (i) => `${y}-${["05", "08", "11"][i]}-01`) => [
  row(`${y}-01-01`, `${y}-03-31`, q[0], "10-Q", y, "Q1", filed(0), `q1-${y}`),
  row(`${y}-04-01`, `${y}-06-30`, q[1], "10-Q", y, "Q2", filed(1), `q2-${y}`),
  row(`${y}-07-01`, `${y}-09-30`, q[2], "10-Q", y, "Q3", filed(2), `q3-${y}`),
  row(`${y}-01-01`, `${y}-09-30`, q[0] + q[1] + q[2], "10-Q", y, "Q3", filed(2), `q3-${y}`),
];
const facts = (rows) => ({ cik: 1, entityName: "Fixture", facts: { "us-gaap": { [C]: { units: { USD: rows } } } } });
const y = (ex, end) => ex.years.find((p) => p.end === end)?.values?.[REV]?.val ?? null;
const q = (ex, end) => ex.quarters.find((p) => p.end === end)?.values?.[REV]?.val ?? null;

console.log("1. IRM's shape");
const IRM = facts([
  ...quarters(2020, [340, 345, 350]),
  row("2020-01-01", "2020-12-31", 1393.2, "10-K", 2020, "FY", "2021-02-24", "k-2020"),
  row("2020-01-01", "2020-12-31", 4147.3, "10-K", 2022, "FY", "2023-02-23", "k-2022"),
]);
const i = X.extractCompanyFacts("IRM", IRM);
check("the restated FY2020 4,147.3 stands", y(i, "2020-12-31") === 4147.3 * M, String(y(i, "2020-12-31")));
check("Q1 2020 (old basis) withheld", q(i, "2020-03-31") === null, String(q(i, "2020-03-31")));
check("the derived Q4 (4,147.3 - 1,035) withheld", q(i, "2020-12-31") === null, String(q(i, "2020-12-31")));

console.log("\n2. what must stay");
const PLAIN = facts([...quarters(2020, [340, 345, 350]), row("2020-01-01", "2020-12-31", 1393.2, "10-K", 2020, "FY", "2021-02-24", "k-2020")]);
check("a year never restated keeps its quarters", q(X.extractCompanyFacts("PLN", PLAIN), "2020-03-31") === 340 * M);
const REFILED = facts([
  ...quarters(2020, [340, 345, 350]),
  ...quarters(2020, [1000, 1030, 1050], () => "2023-05-01").map((r) => ({ ...r, accn: `r-${r.accn}` })),
  row("2020-01-01", "2020-12-31", 1393.2, "10-K", 2020, "FY", "2021-02-24", "k-2020"),
  row("2020-01-01", "2020-12-31", 4147.3, "10-K", 2022, "FY", "2023-02-23", "k-2022"),
]);
check("quarters refiled after the restatement stay", q(X.extractCompanyFacts("REF", REFILED), "2020-03-31") === 1000 * M, String(q(X.extractCompanyFacts("REF", REFILED), "2020-03-31")));

console.log("\n3. mutation");
{
  const a = extractRaw.replace("return Boolean(last && last < restatedOn);", "return false;");
  check("the mutation is applied", a !== extractRaw);
  check("MUTATION: staleness test off → IRM's Q1 kept, caught", q((await load(a)).extractCompanyFacts("IRM", IRM), "2020-03-31") !== null);
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
