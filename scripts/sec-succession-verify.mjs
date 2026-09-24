// THE XOM FIX ON REAL PAYLOADS, before it ships (#552 COWORK #28). Fetches
// the successor's and the predecessor's companyfacts, runs the SHIPPED
// mergeSuccession + extractor + valuationInputs (lifted, as the checks do),
// and prints the shape and the EPS basis. SEC values only; read-only, no
// credential.
//   node scripts/sec-succession-verify.mjs XOM
import fs from "node:fs";
import { readCodeOnly, grabConst } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; succession verify)";
const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const MAP = JSON.parse(fs.readFileSync("data/sec/successor-ciks.json", "utf8"));
const FILL = readCodeOnly("lib/server/secFilingFill.ts");
const M = await lift([
  readCodeOnly("lib/server/secFields.ts"),
  strip("lib/server/secExtract.ts"),
  strip("lib/server/fxRates.ts"),
  strip("lib/server/secCurrency.ts"),
  strip("lib/server/secFactCodec.ts"),
  strip("lib/server/secEarningsView.ts"),
  grabConst("lib/server/secReportDates.ts", "DEADLINE_FALLBACK"),
  grabConst("lib/server/annualOnly.ts", "ANNUAL_ONLY_QUARTER_MONTHS"),
  grabFunction(readCodeOnly("lib/server/annualOnly.ts"), "annualOnlyForm"),
  strip("lib/server/secValuation.ts"),
  `const successorsFile = ${JSON.stringify(MAP)};`,
  FILL.match(/^const foreignCurrencyIn = [\s\S]*?;$/m)?.[0] ?? "",
  grabFunction(FILL, "mergeFillOnly"),
  strip("lib/server/secSuccession.ts"),
  "export { extractCompanyFacts, encodeFactSet, mergeSuccession, withPredecessorFacts, valuationInputs, SEC_FIELD_KEYS };",
].join("\n"));
const get = async (cik) => {
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) throw new Error(`CIK ${cik}: HTTP ${res.status}`);
  await new Promise((r) => setTimeout(r, 200));
  return res.json();
};
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows ?? {};
for (const s of (process.argv[2] || "XOM").split(",")) {
  const e = MAP.successors.find((x) => x.symbol === s);
  if (!e) { console.log(`${s}: not in the successor map`); continue; }
  const succ = await get(e.cik);
  const pred = await get(e.predecessorCik);
  const out = M.mergeSuccession(succ, pred);
  console.log(`\n===== ${s}: ${out.note}`);
  for (const [label, facts] of [["successor alone", succ], ["merged", out.facts]]) {
    const x = M.extractCompanyFacts(s, facts);
    const set = M.encodeFactSet(x);
    const v = M.valuationInputs(set, new Date().toISOString().slice(0, 10), { annualForm: REG[s]?.annualForm ?? "10-K" });
    console.log(`  ${label}: quarters ${x.quarters.length} (unlabelled ${x.quarters.filter((p) => !p.fp).length}), years ${x.years.length}; newest quarters ${x.quarters.slice(0, 5).map((p) => `${p.end} ${p.fp} FY${p.fy}`).join(", ")}; newest year ${x.years[0]?.end ?? "—"}`);
    const val = (p, k) => p.values[M.SEC_FIELD_KEYS.indexOf(k)]?.val ?? null;
    for (const p of [...x.quarters.slice(0, 5), ...x.years.slice(0, 1)]) {
      console.log(`    ${p.end} ${p.fp} eps ${val(p, "epsDiluted")} shares ${val(p, "sharesDiluted")} ni ${val(p, "netIncome")}`);
    }
    for (const [tag, n] of Object.entries(facts.facts?.["us-gaap"] ?? {}).filter(([t]) => /^EarningsPerShare(Diluted|BasicAndDiluted)$|WeightedAverage.*Outstanding/.test(t)).map(([t, d]) => [t, Object.values(d.units ?? {}).flat().map((r) => r.end).sort().at(-1)])) {
      console.log(`    tag ${tag}: newest end ${n}`);
    }
    console.log(`    cover shares ${x.coverShares?.val ?? "—"} as of ${x.coverShares?.asOf ?? "—"}; EPS ${v.eps ? `${v.eps.val.toFixed(2)} ${v.eps.basis}${v.eps.derivedQ4 ? ` (Q4 ${v.eps.derivedQ4} derived)` : ""} to ${v.eps.periodEnd}` : "refused"}; refusals ${v.refusals.join(",") || "none"}`);
  }
}
