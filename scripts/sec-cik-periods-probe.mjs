// WHICH CIK CARRIES XOM'S RECENT QUARTERS? (owner, #518, 2026-09-22)
//
// XOM's ticker resolves to ExxonMobil Holdings Corp (CIK 2115436), a new
// holding company with no annual report yet; its stored set has two quarters
// and no fiscal year. The predecessor, Exxon Mobil Corp, is CIK 34088. This
// prints, per CIK, what companyfacts holds for the headline lines — end date,
// form, filed date, accession — and what the SHIPPED extractor makes of it, so
// "does 34088 include the quarter ended 2026-06-30?" is answered from SEC's
// own payload. Also lists each CIK's annual forms from submissions: that is
// the condition the XOM override expires on.
//
// Read-only, no credentials, writes nothing.
//
//   CIKS="0000034088 0002115436" node scripts/sec-cik-periods-probe.mjs
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT ||
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; cik periods probe)";
const CIKS = (process.env.CIKS || process.env.SYMBOLS || "0000034088 0002115436").split(/[,\s]+/).filter(Boolean);
const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const sec = await lift([
  readCodeOnly("lib/server/secFields.ts"),
  strip("lib/server/secExtract.ts"),
  strip("lib/server/fxRates.ts"),
  strip("lib/server/secCurrency.ts"),
  strip("lib/server/secFactCodec.ts"),
  "export { extractCompanyFacts, encodeFactSet };",
].join("\n"));

const get = async (url) => {
  await new Promise((r) => setTimeout(r, 150));
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  return res.ok ? res.json() : { __status: res.status };
};
const CONCEPTS = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "NetIncomeLoss", "EarningsPerShareDiluted"];

for (const cik of CIKS) {
  const padded = cik.padStart(10, "0");
  const facts = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`);
  const sub = await get(`https://data.sec.gov/submissions/CIK${padded}.json`);
  console.log(`\n### CIK ${padded} — ${facts.entityName ?? sub.name ?? "?"} ${facts.__status ? `(companyfacts HTTP ${facts.__status})` : ""}`);
  const recent = sub.filings?.recent ?? {};
  const annual = (recent.form ?? []).map((f, i) => [f, recent.filingDate[i], recent.accessionNumber[i], recent.reportDate?.[i]])
    .filter(([f]) => ["10-K", "10-K/A", "10-KT", "20-F", "40-F"].includes(f));
  const tenQ = (recent.form ?? []).map((f, i) => [f, recent.filingDate[i], recent.accessionNumber[i], recent.reportDate?.[i]])
    .filter(([f]) => f === "10-Q");
  console.log(`  submissions: ${(recent.form ?? []).length} recent filings; annual reports: ${annual.length ? annual.slice(0, 3).map((a) => a.join(" ")).join(" | ") : "NONE"}`);
  console.log(`  10-Qs: ${tenQ.slice(0, 4).map((a) => a.join(" ")).join(" | ") || "none"}`);
  if (facts.__status) continue;
  for (const c of CONCEPTS) {
    const units = facts.facts?.["us-gaap"]?.[c]?.units ?? {};
    const rows = Object.values(units).flat().filter((r) => r.fp && r.form)
      .sort((a, b) => (b.end + b.filed).localeCompare(a.end + a.filed)).slice(0, 5);
    if (!rows.length) continue;
    console.log(`  ${c}:`);
    for (const r of rows) console.log(`    ${r.start ?? "          "}..${r.end}  ${String(r.val).padStart(16)}  ${r.fy} ${r.fp} ${r.form.padEnd(5)} filed ${r.filed}  ${r.accn}`);
  }
  const set = sec.encodeFactSet(sec.extractCompanyFacts(`CIK${padded}`, facts));
  const q = set.quarters ?? [];
  console.log(`  SHIPPED EXTRACTOR: quarters=${q.length} years=${(set.years ?? []).length}; newest quarter ends ${q[0]?.e ?? "-"}, oldest ${q.at(-1)?.e ?? "-"}; newest year ends ${set.years?.[0]?.e ?? "-"}`);
  console.log(`  has the quarter ended 2026-06-30: ${q.some((p) => p.e === "2026-06-30") ? "YES" : "NO"}`);
}
