// ADS LISTINGS ON FILERS THAT DO NOT FILE A 20-F (#552 COWORK #216 §2). READ-ONLY.
//
// ONC (BeOne) printed a cap of about $524bn: it files a 10-K, so neither the
// 20-F refusal nor a cited ratio applies, and its ORDINARY count is multiplied by
// the ADS price. This lists every such filer: for each registrant whose annual
// form is not a 20-F, the submissions list; then, where the filer is located or
// incorporated outside the US or has an F-6 on its list, its latest annual
// report, read by the SHIPPED parser (lib/server/secAdsRatio.ts decideAdsRow,
// coverRowFor). SEC text only, no credential, ≤8 requests/s. One line per
// filer whose annual report mentions depositary shares:
//   ADS <symbol> form=<f> <accession> <filed> row=<kind> decide=<RATIO n|refuse> "<evidence>"
//   SHARD=1/3 node scripts/ads-10k-census.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; ads 10-k census)";
const [K, N] = (process.env.SHARD || "1/1").split("/").map(Number);
const BUDGET_MS = Number(process.env.BUDGET_MS || 27 * 60 * 1000);
const started = Date.now();
const R = await import("../lib/server/secAdsRatio.ts");
const D = await import("../lib/server/secDescription.ts");
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const MAP = JSON.parse(fs.readFileSync("data/sec/ads-ratios.json", "utf8")).entries;
const US = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU".split(" "));
const only = (process.env.SYMBOLS || "").split(/[,\s]+/).filter(Boolean);
const mine = only.length ? only : Object.keys(REG).sort()
  .filter((s) => !/^20-F/.test(REG[s]?.annualForm ?? "") && REG[s]?.cik).filter((_, i) => i % N === K - 1);
let lastAt = 0;
async function get(url, as = "json") {
  const wait = Math.max(0, lastAt + 130 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(String(res.status));
  return as === "json" ? res.json() : res.text();
}
const tally = { listed: 0, docsRead: 0, ADS: 0, noAds: 0, ERROR: 0 };
let reached = 0;
for (const s of mine) {
  if (Date.now() - started > BUDGET_MS) break;
  reached++;
  try {
    const cik = String(REG[s].cik);
    const sub = await get(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`);
    tally.listed++;
    const r = sub.filings?.recent ?? {};
    const biz = sub.addresses?.business?.stateOrCountry ?? null;
    const inc = sub.stateOfIncorporation || null;
    const hasF6 = (r.form ?? []).some((f) => /^F-6/.test(f));
    const foreign = (biz && !US.has(biz)) || (inc && !US.has(inc));
    if (!foreign && !hasF6) continue;
    const i = (r.form ?? []).findIndex((f) => ["10-K", "10-KT", "40-F", "20-F"].includes(f));
    if (i < 0) { console.log(`SKIP ${s} no annual report on the recent list (biz=${biz} inc=${inc} f6=${hasF6})`); continue; }
    const html = await get(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${r.accessionNumber[i].replace(/-/g, "")}/${r.primaryDocument[i]}`, "text");
    tally.docsRead++;
    const text = D.filingText(html);
    const mentions = (text.match(/American depositary/gi) ?? []).length;
    const sec12b = R.section12bOf(text) ?? "";
    if (!mentions && !/depositary/i.test(sec12b)) { tally.noAds++; continue; }
    const cover = R.coverRowFor(text, s);
    const d = R.decideAdsRow(text, s, null, false);
    const decide = "row" in d ? `${d.row.kind === "ads" ? `RATIO ${d.row.ordinaryPerAds}` : "ORDINARY"} [${d.row.basis}]` : `REFUSE ${d.refuse}`;
    const ev = "row" in d ? d.row.evidence : cover?.title ?? "";
    tally.ADS++;
    console.log(`ADS ${s} form=${r.form[i]} ${r.accessionNumber[i]} ${r.filingDate[i]} biz=${biz} inc=${inc} f6=${hasF6} mentions=${mentions} row=${cover?.kind ?? "none"} mapped=${MAP[s] ? MAP[s].ordinaryPerAds : "no"} decide=${decide} "${String(ev).replace(/\s+/g, " ").slice(0, 220)}"`);
  } catch (e) { tally.ERROR++; console.log(`ERROR ${s} ${String(e?.message ?? e).slice(0, 60)}`); }
}
console.log(`\nshard ${K}/${N}: ${mine.length} non-20-F symbols, reached ${reached} | ${JSON.stringify(tally)} | ${Math.round((Date.now() - started) / 1000)}s`);
