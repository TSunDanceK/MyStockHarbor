// WHY A FILER'S FISCAL YEAR-END ANCHOR IS WRONG (#552 COWORK #30, QXO).
// For each symbol: companyfacts fetched on the runner, the SHIPPED
// fiscalYearOffset (lifted), and every annual-form accession's "primary"
// period -- the max-end duration row that fiscalYearOffset reads -- with the
// tag and span that set it. SEC values only; read-only, no credential.
//   node scripts/sec-fy-anchor-probe.mjs QXO
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; fy anchor probe)";
const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const M = await lift([
  readCodeOnly("lib/server/secFields.ts"),
  strip("lib/server/secExtract.ts"),
  strip("lib/server/fxRates.ts"),
  strip("lib/server/secCurrency.ts"),
  "export { extractCompanyFacts, fiscalYearOffset };",
].join("\n"));
const tickers = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const cikOf = new Map(tickers.data.map(([cik, , t]) => [String(t).toUpperCase(), String(cik).padStart(10, "0")]));
const DAY = 86400000;
for (const s of (process.argv[2] || "QXO").split(",")) {
  const cik = cikOf.get(s);
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  console.log(`\n===== ${s} CIK ${cik}: HTTP ${res.status}`);
  if (!res.ok) continue;
  const facts = await res.json();
  const x = M.extractCompanyFacts(s, facts);
  console.log(`  extractor: quarters ${x.quarters.length}, years ${x.years.length}; newest quarters ${x.quarters.slice(0, 4).map((p) => `${p.end} ${p.fp} FY${p.fy}`).join(", ")}`);
  const naming = M.fiscalYearOffset(facts, null);
  console.log(`  fiscalYearOffset: ${JSON.stringify(naming)}`);
  // The primaries, as fiscalYearOffset builds them, with the row that set each.
  const byAccn = new Map();
  for (const [ns, tags] of Object.entries(facts.facts ?? {})) for (const [tag, def] of Object.entries(tags)) for (const [unit, rows] of Object.entries(def.units ?? {})) for (const r of rows) {
    if (!r.accn || !r.end || !r.start || !r.form || !r.fp || typeof r.fy !== "number") continue;
    const cur = byAccn.get(r.accn);
    if (!cur || r.end > cur.end) byAccn.set(r.accn, { form: r.form, fy: r.fy, fp: r.fp, start: r.start, end: r.end, days: Math.round((Date.parse(r.end) - Date.parse(r.start)) / DAY), tag: `${ns}:${tag}`, unit, filed: r.filed });
  }
  const annual = [...byAccn.entries()].filter(([, p]) => /^(10-K|20-F|40-F)/.test(p.form)).sort((a, b) => (a[1].end < b[1].end ? 1 : -1)).slice(0, 8);
  for (const [accn, p] of annual) console.log(`  ${p.form} ${accn} filed ${p.filed} fy ${p.fy} fp ${p.fp}: primary ${p.start}..${p.end} (${p.days}d) from ${p.tag} [${p.unit}]`);
  // The 10-K's own FY rows for the income fields, for comparison.
  for (const tag of ["NetIncomeLoss", "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "EarningsPerShareDiluted"]) {
    const rows = Object.values(facts.facts?.["us-gaap"]?.[tag]?.units ?? {}).flat().filter((r) => r.form?.startsWith("10-K") && r.start && (Date.parse(r.end) - Date.parse(r.start)) / DAY > 330);
    console.log(`  ${tag}: 10-K year rows ends ${[...new Set(rows.map((r) => r.end))].sort().slice(-4).join(", ") || "—"}`);
  }
  await new Promise((r) => setTimeout(r, 200));
}
