// SHARE COUNTS ON A UNIT SLIP (#552 COWORK #192; CODE-A #199 §1).
//
// A period's weighted shares are rescaled by 10^3 / 10^6 (either way) only
// when the filer's own net income ÷ (as-filed EPS × shares) lands within 3%
// of that factor. Pinned on companyfacts-shaped payloads:
//   RESCALED  MCD-shaped (shares in thousands, x1,000), NMR-shaped (x1e-6)
//   UNTOUCHED a clean filer (ratio ~1), an ADS-ratio filer (ratio ~8), a
//             near miss (ratio 1,060: outside 3%), a period with no filed EPS,
//             and an UNCORROBORATED ratio -- the cover count says the shares
//             are right, so the slip is in net income (WAT's shape)
// plus a mutation: the rescale removed, and MCD's count stays in thousands.
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
const K = (k) => X.SEC_FIELD_KEYS.indexOf(k);

const Q = ["2026-04-01", "2026-06-30"];
const row = (val, unit) => ({ start: Q[0], end: Q[1], val, accn: "0000000000-26-000001", fy: 2026, fp: "Q2", form: "10-Q", filed: "2026-08-01" });
const payload = ({ ni, eps, shares, epsFiled = true, cover = null }) => ({
  cik: 1, entityName: "Fixture",
  facts: {
    ...(cover ? { dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ end: "2026-07-25", val: cover, accn: "0000000000-26-000001", fy: 2026, fp: "Q2", form: "10-Q", filed: "2026-08-01" }] } } } } : {}),
    "us-gaap": {
    NetIncomeLoss: { units: { USD: [row(ni)] } },
    ...(epsFiled ? { EarningsPerShareDiluted: { units: { "USD/shares": [row(eps)] } } } : {}),
    WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: [row(shares)] } },
  } },
});
const q = (mod, p) => mod.extractCompanyFacts("FIX", payload(p)).quarters.find((r) => r.end === Q[1])?.values ?? [];
const sh = (mod, p) => q(mod, p)[K("sharesDiluted")]?.val ?? null;

console.log("1. rescaled where the filer's arithmetic proves it");
check("MCD-shaped: 714,000 (thousands) → 714,000,000, the cover count agreeing", sh(X, { ni: 2000e6, eps: 2.8, shares: 714_000, cover: 712e6 }) === 714_000_000);
check("NMR-shaped: 3.04e15 (×1e6 too large) → 3.04e9, the cover count agreeing", Math.abs(sh(X, { ni: 120e9, eps: 39.47, shares: 3.04e15, cover: 2.9e9 }) - 3.04e9) < 1e3);

console.log("\n2. untouched where it does not");
check("a clean filer (ratio ~1) keeps its count", sh(X, { ni: 2000e6, eps: 2.8, shares: 714_000_000 }) === 714_000_000);
check("an ADS-ratio filer (ratio ~8) keeps its count", sh(X, { ni: 8000e6, eps: 8, shares: 125_000_000 }) === 125_000_000);
check("a near miss (ratio 1,060, outside 3%) keeps its count", sh(X, { ni: 2000e6, eps: 2.8, shares: 673_850 }) === 673_850);
check("ratio ×0.001 but the cover count matches the shares → net income slipped, count kept (WAT's shape)",
  sh(X, { ni: 0.64e6, eps: 10.8, shares: 59.4e6, cover: 59.5e6 }) === 59.4e6);
check("ratio proves ×1,000 but there is no independent count at all → count kept", sh(X, { ni: 2000e6, eps: 2.8, shares: 714_000 }) === 714_000);
check("no filed EPS → nothing to prove with, count kept", sh(X, { ni: 2000e6, eps: 0, shares: 714_000, epsFiled: false }) === 714_000);
check("unitSlipFactor: 1,000 / 1e-6 / null", X.unitSlipFactor(2000e6, 2.8, 714_000) === 1e3 && X.unitSlipFactor(120e9, 39.47, 3.04e15) === 1e-6 && X.unitSlipFactor(8000e6, 8, 125e6) === null);

console.log("\n3. mutation");
{
  const mutated = extractRaw.replace("        m.set(shareKey, { ...sh, val: sh.val * f });\n", "");
  check("the mutation applied", mutated !== extractRaw);
  const XM = await load(mutated);
  check("MUTATION: without the rescale MCD's count stays in thousands (caught)", sh(XM, { ni: 2000e6, eps: 2.8, shares: 714_000, cover: 712e6 }) === 714_000);
  const uncorroborated = extractRaw.replace("if (!near(sh.val * f, cover) && !near(sh.val * f, medians[shareKey])) {", "if (false) {");
  check("the corroboration mutation applied", uncorroborated !== extractRaw);
  const XU = await load(uncorroborated);
  check("MUTATION: without corroboration WAT's correct count is divided by 1,000 (caught)", sh(XU, { ni: 0.64e6, eps: 10.8, shares: 59.4e6, cover: 59.5e6 }) !== 59.4e6);
}

if (failures) { console.log(`\n${failures} assertion(s) failed.`); process.exit(1); }
console.log("\nALL CHECKS PASSED");
