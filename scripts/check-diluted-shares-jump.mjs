// A DILUTED SHARE COUNT THAT MOVES OVER 100x IN A YEAR (yoy60 2d).
//
// The yoy60 census (relay write-yoy60-classify) found HST, TDW, NN, CLDX and AMSC
// with diluted counts moving 1,000x to 1,000,000x year on year: a unit slip the
// EPS-proved rescale could not reach. Pinned: the cell farther from the filer's
// median is refused (a slip in the middle of a series); a filed 1-for-100
// reverse split is left as filed; an ordinary series is untouched; and the
// mutation that removes the test is caught.
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
const SH = X.SEC_FIELD_KEYS.indexOf("sharesDiluted");
const TAG = "WeightedAverageNumberOfDilutedSharesOutstanding";
const facts = (vals, extra = {}) => ({ cik: 1, entityName: "F", facts: { "us-gaap": { [TAG]: { units: { shares: vals.map(([y, v]) =>
  ({ start: `${y}-01-01`, end: `${y}-12-31`, val: v, form: "10-K", fy: y, fp: "FY", filed: `${y + 1}-02-15`, accn: `k${y}` })) } }, ...extra } } });
const sh = (ex, y) => ex.years.find((p) => p.end === `${y}-12-31`)?.values?.[SH]?.val ?? null;

console.log("1. a unit slip in the middle of a series");
const slip = facts([[2021, 500e6], [2022, 510e6], [2023, 5150], [2024, 520e6], [2025, 525e6]]);
const s = X.extractCompanyFacts("HST", slip);
check("FY2023 (5,150, x99,000 off) refused", sh(s, 2023) === null, String(sh(s, 2023)));
check("FY2022 and FY2024 stay", sh(s, 2022) === 510e6 && sh(s, 2024) === 520e6);

console.log("\n2. what stays");
const split = facts([[2021, 900e6], [2022, 910e6], [2023, 9.2e6], [2024, 9.3e6]],
  { StockholdersEquityNoteStockSplitConversionRatio1: { units: { pure: [{ end: "2023-06-30", val: 0.01, form: "10-K", fy: 2023, fp: "FY", filed: "2024-02-15", accn: "k2023" }] } } });
const r = X.extractCompanyFacts("RS", split);
check("a filed 1-for-100 reverse split: every year left as filed", sh(r, 2022) === 910e6 && sh(r, 2023) === 9.2e6, `${sh(r, 2022)} ${sh(r, 2023)}`);
const ok = facts([[2021, 100e6], [2022, 140e6], [2023, 300e6], [2024, 310e6]]);
check("an ordinary series (x3 in a year) is untouched", sh(X.extractCompanyFacts("OK", ok), 2023) === 300e6);

// A genuine issuance (QXO-shaped): net income / (EPS x shares) closes on both years.
{
  const NI = "NetIncomeLoss", EPS = "EarningsPerShareDiluted";
  const yr = (y, v) => ({ start: `${y}-01-01`, end: `${y}-12-31`, val: v, form: "10-K", fy: y, fp: "FY", filed: `${y + 1}-02-15`, accn: `k${y}` });
  const g = facts([[2021, 0.7e6], [2022, 0.7e6], [2023, 0.7e6], [2024, 400e6]], {
    [NI]: { units: { USD: [yr(2021, 7e6), yr(2022, 7e6), yr(2023, 7e6), yr(2024, 400e6)] } },
    [EPS]: { units: { "USD/shares": [yr(2021, 10), yr(2022, 10), yr(2023, 10), yr(2024, 1)] } },
  });
  const ge = X.extractCompanyFacts("QXOF", g);
  check("a genuine issuance whose EPS closes on both counts: both kept", sh(ge, 2024) === 400e6 && sh(ge, 2023) === 0.7e6, `${sh(ge, 2023)} ${sh(ge, 2024)}`);
}

// A pre-IPO placeholder series (NIQ-shaped): the cover count (285M) is the reference,
// so the real 245M is kept and the 100-share placeholder a year earlier is refused.
{
  const cov = { EntityCommonStockSharesOutstanding: { units: { shares: [{ end: "2026-02-10", val: 285e6, form: "10-K", fy: 2025, fp: "FY", filed: "2026-02-20", accn: "k2025" }] } } };
  const n = facts([[2022, 100], [2023, 100], [2024, 100], [2025, 245e6]], {});
  n.facts.dei = cov;
  const ne = X.extractCompanyFacts("NIQ", n);
  check("a placeholder series: the real count beside the cover count is kept, the placeholder refused", sh(ne, 2025) === 245e6 && sh(ne, 2024) === null, `${sh(ne, 2024)} ${sh(ne, 2025)}`);
}

// NIQ as filed: the 100-share placeholder closes on its own EPS, the real 245M
// beside the cover count does not; the proof must not convict the 245M.
{
  const NI = "NetIncomeLoss", EPS = "EarningsPerShareDiluted";
  const yr = (y, v) => ({ start: `${y}-01-01`, end: `${y}-12-31`, val: v, form: "10-K", fy: y, fp: "FY", filed: `${y + 1}-02-15`, accn: `k${y}` });
  const n = facts([[2023, 100], [2024, 100], [2025, 245e6]], {
    [NI]: { units: { USD: [yr(2024, -1e6), yr(2025, -50e6)] } },
    [EPS]: { units: { "USD/shares": [yr(2024, -10000), yr(2025, -0.5)] } },
  });
  n.facts.dei = { EntityCommonStockSharesOutstanding: { units: { shares: [{ end: "2026-02-10", val: 295e6, form: "10-K", fy: 2025, fp: "FY", filed: "2026-02-20", accn: "k2025" }] } } };
  const ne = X.extractCompanyFacts("NIQP", n);
  check("NIQ as filed: the real 245M beside the cover count is kept, though only the placeholder's EPS closes", sh(ne, 2025) === 245e6, `${sh(ne, 2024)} ${sh(ne, 2025)}`);
  const m = extractRaw.replace("if ((okNew && off(ago.val) <= off(sh.val)) || (okAgo && off(sh.val) <= off(ago.val))) continue;", "");
  check("MUTATION: outlier test off → NIQ 245M refused, caught", sh((await load(m)).extractCompanyFacts("NIQP", n), 2025) === null);
}

// QXO, exempt by name (owner ruling #937): a series the guard would cut, kept.
{
  const q = facts([[2021, 5e6], [2022, 5.2e6], [2023, 0.7e6], [2024, 204e6], [2025, 613e6]]);
  check("QXO is exempt: 204M and 0.7M both kept", sh(X.extractCompanyFacts("QXO", q), 2024) === 204e6 && sh(X.extractCompanyFacts("QXO", q), 2023) === 0.7e6);
  check("...the same series under another name is cut", sh(X.extractCompanyFacts("QXOZ", q), 2024) === null || sh(X.extractCompanyFacts("QXOZ", q), 2023) === null);
}

console.log("\n3. mutation");
{
  const m = extractRaw.replace("if (ratio <= SHARE_JUMP_MAX && ratio >= 1 / SHARE_JUMP_MAX) continue;", "continue;");
  check("the mutation is applied", m !== extractRaw);
  check("MUTATION: test off → HST FY2023 kept, caught", sh((await load(m)).extractCompanyFacts("HST", slip), 2023) === 5150);
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
