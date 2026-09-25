// THE ADS RATIO EACH 20-F FILER STATES (#552 COWORK #22 §1). For every 20-F
// registrant in the shard: the latest 20-F's own ratio statement, read by the
// SHIPPED parser (lib/server/secAdsRatio.ts); where the 20-F states none, the
// newest F-6 on the filer's list. SEC text only, read-only, no credential.
// ≤8 requests/s. Prints one line per symbol:
//   RATIO <n> <form> <accession> <filed> "<sentence>"
//   DISAGREE <values> <form> <accession>
//   NONE ads-mentions=<k> <form> <accession>
//   SHARD=1/3 node scripts/ads-ratio-census.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; ads ratio census)";
const [K, N] = (process.env.SHARD || "1/1").split("/").map(Number);
const BUDGET_MS = Number(process.env.BUDGET_MS || 27 * 60 * 1000);
const started = Date.now();
const R = await import("../lib/server/secAdsRatio.ts");
const D = await import("../lib/server/secDescription.ts");
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const only = (process.env.SYMBOLS || "").split(/[,\s]+/).filter(Boolean);
const mine = only.length ? only : Object.keys(REG).sort()
  .filter((s) => /^20-F/.test(REG[s]?.annualForm ?? "") && REG[s]?.cik).filter((_, i) => i % N === K - 1);
let lastAt = 0;
async function get(url, as = "json") {
  const wait = Math.max(0, lastAt + 130 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(String(res.status));
  return as === "json" ? res.json() : res.text();
}
const tally = { RATIO: 0, DIRECT: 0, DISAGREE: 0, CHANGED: 0, NONE: 0, ERROR: 0 };
let reached = 0;
for (const s of mine) {
  if (Date.now() - started > BUDGET_MS) break;
  reached++;
  try {
    const cik = String(REG[s].cik);
    const r = (await get(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`)).filings?.recent ?? {};
    const pick = (forms) => (r.form ?? []).findIndex((f) => forms.includes(f));
    const i20 = pick(["20-F"]);
    const i6 = pick(["F-6", "F-6EF", "F-6 POS"]);
    // NEWEST SOURCE WINS (#552 COWORK #45): an F-6 counts only if it was filed
    // after the latest 20-F (or there is no 20-F on the list at all).
    const f6IsNewer = i6 >= 0 && (i20 < 0 || r.filingDate[i6] > r.filingDate[i20]);
    const docText = async (i) => D.filingText(await get(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${r.accessionNumber[i].replace(/-/g, "")}/${r.primaryDocument[i]}`, "text"));
    const refOf = (i) => ({ form: r.form[i], source: r.accessionNumber[i], filed: r.filingDate[i] });
    let line = null, mentions = 0, lastRef = "", row = null;
    const text20 = i20 >= 0 ? await docText(i20) : null;
    if (text20) mentions += (text20.match(/American depositary/gi) ?? []).length;
    const f6Text = f6IsNewer ? await docText(i6) : null;
    lastRef = i20 >= 0 ? `20-F ${r.accessionNumber[i20]} ${r.filingDate[i20]}` : "no 20-F";
    // THE SHIPPED SOURCE RULE: lib/server/secAdsRatio.decideAdsRow.
    if (process.env.SHOW12B && text20) {
      const flat = text20.replace(/\s+/g, " "), at = flat.search(/registered,?\s+or\s+to\s+be\s+registered,?\s+pursuant\s+to\s+Section\s+12\s*\(\s*b\s*\)/i);
      console.log(`  12(b) table: ${at < 0 ? "not found" : flat.slice(at, at + 2500)}`);
      console.log(`  rows: ${JSON.stringify(R.coverRowsFor(text20, s))}`);
    }
    const decided = R.decideAdsRow(text20, s, f6Text, f6IsNewer);
    if ("row" in decided) {
      const i = decided.row.from === "20-F" ? i20 : i6;
      row = { kind: decided.row.kind, ordinaryPerAds: decided.row.ordinaryPerAds, evidence: decided.row.evidence, basis: decided.row.basis, ...refOf(i) };
    } else {
      const key = /^ratio changed/.test(decided.refuse) ? "CHANGED" : /^ratios disagree/.test(decided.refuse) ? "DISAGREE" : "NONE";
      tally[key]++;
      line = `${key} ${decided.refuse} | ads-mentions=${mentions} ${lastRef}`;
    }
    if (row && !line) {
      line = `${row.kind === "ads" ? `RATIO ${row.ordinaryPerAds}` : "DIRECT"} ${row.form} ${row.source} ${row.filed} [${row.basis}] "${row.evidence.slice(0, 200)}"`;
      tally[row.kind === "ads" ? "RATIO" : "DIRECT"]++;
    }
    console.log(`${s.padEnd(6)} ${line}`);
    if (row) { const { basis, ...stored } = row; void basis; console.log(`MAP ${JSON.stringify({ symbol: s, ...stored })}`); }
  } catch (e) { tally.ERROR++; console.log(`${s.padEnd(6)} ERROR ${String(e?.message ?? e).slice(0, 60)}`); }
}
console.log(`\nshard ${K}/${N}: ${mine.length} 20-F symbols, reached ${reached} | ${JSON.stringify(tally)} | ${Math.round((Date.now() - started) / 1000)}s`);
