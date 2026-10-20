// ONE BASIS PER REVENUE SERIES (yoy60 2c; the #913 rule, LYG).
//
// Pinned: a year older than the newest filing's comparatives is withheld when
// that filing restated a comparative by over 25% (LYG's net-basis 20-F); with
// no restatement it stays; a year on another concept that disagrees with the
// series' concept where both are filed is withheld, and one that agrees stays;
// each rule's mutation is caught.
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
const C = "RevenueFromContractWithCustomerExcludingAssessedTax", R = "Revenues";
const fy = (tag, y, v, filedYear, accn) => ({ tag, row: { start: `${y}-01-01`, end: `${y}-12-31`, val: v * M, form: "10-K", fy: filedYear - 1, fp: "FY", filed: `${filedYear}-03-01`, accn } });
const facts = (rows) => {
  const g = {};
  for (const { tag, row } of rows) ((g[tag] ??= { units: { USD: [] } }).units.USD).push(row);
  return { cik: 1, entityName: "Fixture", facts: { "us-gaap": g } };
};
const y = (ex, yr) => ex.years.find((p) => p.end === `${yr}-12-31`)?.values?.[REV]?.val ?? null;
// Each 10-K files its year and the two before it (the usual comparatives).
const tenK = (tag, filedYear, vals) => Object.entries(vals).map(([yr, v]) => fy(tag, Number(yr), v, filedYear, `k${filedYear}`));

console.log("1. a restated series (LYG shape)");
const LYG = facts([
  ...tenK(R, 2022, { 2019: 37000, 2020: 36000, 2021: 38950 }),
  ...tenK(R, 2023, { 2020: 36000, 2021: 38950, 2022: 40000 }),
  ...tenK(R, 2024, { 2021: 38950, 2022: 40000, 2023: 41000 }),
  ...tenK(R, 2025, { 2022: 17000, 2023: 18629, 2024: 18003 }),
]);
const l = X.extractCompanyFacts("LYG", LYG);
check("FY2021 (gross, older than the newest comparatives) withheld", y(l, 2021) === null, String(y(l, 2021)));
check("FY2022 reads the restated 17,000", y(l, 2022) === 17000 * M, String(y(l, 2022)));
check("FY2024 stays", y(l, 2024) === 18003 * M);
const PLAIN = facts([
  ...tenK(R, 2023, { 2020: 36000, 2021: 38950, 2022: 40000 }),
  ...tenK(R, 2025, { 2022: 40100, 2023: 41000, 2024: 42000 }),
]);
check("a 0.25% revision is not a restatement: FY2021 stays", y(X.extractCompanyFacts("PLN", PLAIN), 2021) === 38950 * M);
const RECAST = facts([
  ...tenK(R, 2023, { 2020: 36000, 2021: 38950, 2022: 40000 }),
  ...tenK(R, 2025, { 2022: 34000, 2023: 35000, 2024: 36000 }),
]);
check("a 15% recast (a divestiture) is under the 25% ruling: FY2021 keeps its history", y(X.extractCompanyFacts("RCS", RECAST), 2021) === 38950 * M);

console.log("\n2. a mixed-concept series");
const MIX = facts([
  ...tenK(C, 2022, { 2019: 1000, 2020: 1100, 2021: 1200 }),
  ...tenK(C, 2023, { 2020: 1100, 2021: 1200 }),
  fy(R, 2021, 1700, 2023, "k2023"), fy(R, 2022, 1800, 2023, "k2023"),
  ...tenK(R, 2025, { 2023: 1900, 2024: 2000 }),
]);
const mx = X.extractCompanyFacts("MIX", MIX);
check("FY2020 on the contract line, 30% under Revenues where both are filed: withheld", y(mx, 2020) === null, String(y(mx, 2020)));
check("FY2024 on Revenues stays", y(mx, 2024) === 2000 * M);
const SAME = facts([
  ...tenK(C, 2022, { 2019: 1000, 2020: 1100, 2021: 1200 }),
  fy(R, 2021, 1210, 2023, "k2023"), fy(R, 2022, 1300, 2023, "k2023"),
  ...tenK(R, 2025, { 2023: 1400, 2024: 1500 }),
]);
check("concepts agreeing within 5% are one measure: FY2020 stays", y(X.extractCompanyFacts("SAME", SAME), 2020) === 1100 * M, String(y(X.extractCompanyFacts("SAME", SAME), 2020)));

console.log("\n3. mutations");
{
  const a = extractRaw.replace("if (restated && oldestComp && end < oldestComp) {", "if (false) {");
  check("the restatement mutation is applied", a !== extractRaw);
  check("MUTATION: restatement rule off → LYG FY2021 kept, caught", y((await load(a)).extractCompanyFacts("LYG", LYG), 2021) !== null);
  const b = extractRaw.replace("if (!disagree) continue;", "continue;");
  check("the concept mutation is applied", b !== extractRaw);
  check("MUTATION: concept rule off → MIX FY2020 kept, caught", y((await load(b)).extractCompanyFacts("MIX", MIX), 2020) !== null);
  const c = extractRaw.replace("if (!disagree) continue;", "");
  check("MUTATION: agreement test off → SAME FY2020 withheld, caught", y((await load(c)).extractCompanyFacts("SAME", SAME), 2020) === null);
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
