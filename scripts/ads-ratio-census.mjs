// THE ADS RATIO EACH DEPOSITARY-SHARE FILER STATES (#552 COWORK #22 §1).
// For every registrant in the shard: the LATEST ANNUAL REPORT's own ratio
// statement (20-F, or since #552 COWORK #218/#222 a 10-K or 10-KT: ONC, ZLAB
// and GPCR list ADSs on a 10-K), read by the SHIPPED parser
// (lib/server/secAdsRatio.ts); an F-6 only when filed after that report.
// Same newest-source rule, never a default. SEC text only, read-only, no
// credential. ≤8 requests/s. Prints one line per symbol:
//   RATIO <n> <form> <accession> <filed> "<sentence>"
//   DISAGREE <values> <form> <accession>
//   NONE ads-mentions=<k> <form> <accession>
//   UNRATED <form> <accession>   (a 10-K whose 12(b) row under the ticker is
//                                 depositary shares, with no ratio cited)
// A 10-K filer's row comes only from ITS OWN 12(b) row under the ticker being
// depositary shares: never from its body text alone.
// The universe: every 20-F filer, plus (ANNUAL=1) every other filer located or
// incorporated outside the US or with an F-6 on its list. A 10-K filer is
// mapped ONLY for a depositary-share row; its ordinary listing needs no row.
// CONFIRM_F6=1 also reads the newest F-6 whatever its date and prints its
// ratio, to confirm a ratio stated only in a 10-K's notes (ONC, GPCR).
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
const ANNUAL_ALL = Boolean(process.env.ANNUAL);
const mine = only.length ? only : Object.keys(REG).sort()
  .filter((s) => (ANNUAL_ALL || /^20-F/.test(REG[s]?.annualForm ?? "")) && REG[s]?.cik).filter((_, i) => i % N === K - 1);
const US = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU".split(" "));
const ANNUAL_FORMS = ["20-F", "10-K", "10-KT"];
let lastAt = 0;
async function get(url, as = "json") {
  const wait = Math.max(0, lastAt + 130 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(String(res.status));
  return as === "json" ? res.json() : res.text();
}
const tally = { RATIO: 0, DIRECT: 0, DISAGREE: 0, CHANGED: 0, NONE: 0, UNRATED: 0, SKIPPED: 0, ERROR: 0 };
let reached = 0;
for (const s of mine) {
  if (Date.now() - started > BUDGET_MS) break;
  reached++;
  try {
    const cik = String(REG[s].cik);
    const sub = await get(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`);
    const r = sub.filings?.recent ?? {};
    const pick = (forms) => (r.form ?? []).findIndex((f) => forms.includes(f));
    // THE LATEST ANNUAL REPORT, whatever its form (#552 COWORK #218/#222).
    const i20 = pick(ANNUAL_FORMS);
    const is20F = i20 >= 0 && r.form[i20] === "20-F";
    if (!only.length && !is20F) {
      // A domestic 10-K filer with no F-6 has no depositary listing to read.
      const biz = sub.addresses?.business?.stateOrCountry ?? null, inc = sub.stateOfIncorporation || null;
      const foreign = (biz && !US.has(biz)) || (inc && !US.has(inc));
      if (!foreign && !(r.form ?? []).some((f) => /^F-6/.test(f))) { tally.SKIPPED++; continue; }
    }
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
    lastRef = i20 >= 0 ? `${r.form[i20]} ${r.accessionNumber[i20]} ${r.filingDate[i20]}` : "no annual report";
    // CONFIRMATION ONLY, NEVER THE SOURCE OF A ROW: each F-6 on the list,
    // newest first, until one states a ratio (a later post-effective amendment
    // may state none: ONC's 2025 one).
    if (process.env.CONFIRM_F6) {
      const f6s = (r.form ?? []).map((f, i) => (/^F-6/.test(f) ? i : -1)).filter((i) => i >= 0).slice(0, 6);
      if (!f6s.length) console.log("  F-6: none on the recent list");
      for (const i of f6s) {
        const f6 = R.adsRatioOf(await docText(i));
        console.log(`  ${r.form[i]} ${r.accessionNumber[i]} ${r.filingDate[i]}: ${f6.ok ? `RATIO ${f6.ordinaryPerAds} "${f6.sentence.slice(0, 200)}"` : f6.why}`);
        if (f6.ok) break;
      }
    }
    // THE SHIPPED SOURCE RULE: lib/server/secAdsRatio.decideAdsRow.
    if (process.env.SHOW12B && text20) {
      const flat = text20.replace(/\s+/g, " "), at = flat.search(/registered,?\s+or\s+to\s+be\s+registered,?\s+pursuant\s+to\s+Section\s+12\s*\(\s*b\s*\)/i);
      console.log(`  12(b) table: ${at < 0 ? "not found" : flat.slice(at, at + 2500)}`);
      console.log(`  rows: ${JSON.stringify(R.coverRowsFor(text20, s))}`);
    }
    const decided = R.decideAdsRow(text20, s, f6Text, f6IsNewer);
    // A 10-K FILER IS MAPPED ONLY FOR A DEPOSITARY-SHARE ROW. Its ordinary
    // listing is the ordinary case (no row needed); a depositary row with no
    // cited ratio is UNRATED, for the class refusal (#552 COWORK #218).
    // ONLY FROM ITS OWN 12(b) ROW: a 10-K's body text can quote another
    // listing's ADSs (CCL's performance graph is Carnival plc's, CUK).
    const cover10k = text20 && !is20F ? R.coverRowFor(text20, s) : null;
    if (text20 && !is20F && !("row" in decided && decided.row.kind === "ads" && cover10k?.kind === "ads")) {
      const cover = cover10k;
      if (cover?.kind === "ads") {
        tally.UNRATED++;
        console.log(`${s.padEnd(6)} UNRATED ${"refuse" in decided ? decided.refuse : "no ratio"} | ${lastRef}`);
        console.log(`UNRATED-MAP ${JSON.stringify({ symbol: s, evidence: cover.title.slice(0, 300), form: r.form[i20], source: r.accessionNumber[i20], filed: r.filingDate[i20] })}`);
      } else { tally.SKIPPED++; if (only.length) console.log(`${s.padEnd(6)} not a depositary listing | ${lastRef}`); }
      continue;
    }
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
console.log(`\nshard ${K}/${N}: ${mine.length} symbols${ANNUAL_ALL ? " (every annual-report filer)" : " (20-F filers)"}, reached ${reached} | ${JSON.stringify(tally)} | ${Math.round((Date.now() - started) / 1000)}s`);
