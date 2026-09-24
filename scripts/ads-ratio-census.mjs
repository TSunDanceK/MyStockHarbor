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
    if (i20 >= 0) {
      const text = await docText(i20);
      mentions += (text.match(/American depositary/gi) ?? []).length;
      const ref = refOf(i20);
      lastRef = `${ref.form} ${ref.source} ${ref.filed}`;
      const cover = R.coverRowFor(text, s);
      if (cover?.kind === "ordinary") {
        row = { kind: "ordinary", ordinaryPerAds: 1, evidence: cover.title, basis: "cover-row", ...ref };
      } else if (cover?.kind === "ads") {
        const fromTitle = R.adsRatioOf(cover.title);
        const got = fromTitle.ok ? fromTitle : R.adsRatioOf(text);
        if (got.ok) row = { kind: "ads", ordinaryPerAds: got.ordinaryPerAds, evidence: fromTitle.ok ? cover.title : got.sentence, basis: fromTitle.ok ? "cover-row" : "20-F text", ...ref };
        else if (got.why === "ratios-disagree") { line = `DISAGREE ${got.values.join("/")} ${lastRef}`; tally.DISAGREE++; }
      } else if (cover?.kind === "other") {
        line = `OTHER-CLASS ${lastRef} "${cover.title.slice(0, 120)}"`; tally.NONE++;
      } else {
        // NO COVER ROW FOR THE TICKER: the filing's own statements, as before.
        const got = R.adsRatioOf(text);
        if (got.ok) row = { kind: "ads", ordinaryPerAds: got.ordinaryPerAds, evidence: got.sentence, basis: "20-F text", ...ref };
        else if (got.why === "ratios-disagree") { line = `DISAGREE ${got.values.join("/")} ${lastRef}`; tally.DISAGREE++; }
        else {
          const direct = R.directListingStatement(text, s);
          if (direct) row = { kind: "ordinary", ordinaryPerAds: 1, evidence: direct, basis: "12(b) + no ADS", ...ref };
        }
      }
    }
    if (!line && f6IsNewer) {
      const text = await docText(i6);
      const got = R.adsRatioOf(text);
      const ref = refOf(i6);
      if (got.ok && row && row.ordinaryPerAds !== got.ordinaryPerAds) {
        // A RATIO CHANGE after the 20-F: refused, for a person (COWORK #45 §3).
        line = `RATIO-CHANGED 20-F ${row.ordinaryPerAds} -> ${ref.form} ${got.ordinaryPerAds} ${ref.source} ${ref.filed}`; tally.CHANGED++; row = null;
      } else if (got.ok && !row) {
        row = { kind: "ads", ordinaryPerAds: got.ordinaryPerAds, evidence: got.sentence, basis: "F-6 newer than the 20-F", ...ref };
      }
    }
    if (row && !line) {
      line = `${row.kind === "ads" ? `RATIO ${row.ordinaryPerAds}` : "DIRECT"} ${row.form} ${row.source} ${row.filed} [${row.basis}] "${row.evidence.slice(0, 200)}"`;
      tally[row.kind === "ads" ? "RATIO" : "DIRECT"]++;
    }
    if (!line) { line = `NONE ads-mentions=${mentions} ${lastRef || "no 20-F or F-6 in recent filings"}`; tally.NONE++; }
    console.log(`${s.padEnd(6)} ${line}`);
    if (row) { const { basis, ...stored } = row; void basis; console.log(`MAP ${JSON.stringify({ symbol: s, ...stored })}`); }
  } catch (e) { tally.ERROR++; console.log(`${s.padEnd(6)} ERROR ${String(e?.message ?? e).slice(0, 60)}`); }
}
console.log(`\nshard ${K}/${N}: ${mine.length} 20-F symbols, reached ${reached} | ${JSON.stringify(tally)} | ${Math.round((Date.now() - started) / 1000)}s`);
