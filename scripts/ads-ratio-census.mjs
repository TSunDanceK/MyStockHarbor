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
const tally = { RATIO: 0, DISAGREE: 0, NONE: 0, ERROR: 0 };
let reached = 0;
for (const s of mine) {
  if (Date.now() - started > BUDGET_MS) break;
  reached++;
  try {
    const cik = String(REG[s].cik);
    const r = (await get(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`)).filings?.recent ?? {};
    const pick = (forms) => (r.form ?? []).findIndex((f) => forms.includes(f));
    const tries = [pick(["20-F"]), pick(["F-6", "F-6EF", "F-6 POS"])].filter((i) => i >= 0);
    let line = null, mentions = 0, lastRef = "";
    for (const i of tries) {
      const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${r.accessionNumber[i].replace(/-/g, "")}/${r.primaryDocument[i]}`;
      const text = D.filingText(await get(url, "text"));
      mentions += (text.match(/American depositary/gi) ?? []).length;
      lastRef = `${r.form[i]} ${r.accessionNumber[i]} ${r.filingDate[i]}`;
      const got = R.adsRatioOf(text);
      if (got.ok) { line = `RATIO ${got.ordinaryPerAds} ${lastRef} (${got.statements}x) "${got.sentence.slice(0, 220)}"`; tally.RATIO++; break; }
      if (got.why === "ratios-disagree") { line = `DISAGREE ${got.values.join("/")} ${lastRef}`; tally.DISAGREE++; break; }
    }
    if (!line) { line = `NONE ads-mentions=${mentions} ${lastRef || "no 20-F or F-6 in recent filings"}`; tally.NONE++; }
    console.log(`${s.padEnd(6)} ${line}`);
  } catch (e) { tally.ERROR++; console.log(`${s.padEnd(6)} ERROR ${String(e?.message ?? e).slice(0, 60)}`); }
}
console.log(`\nshard ${K}/${N}: ${mine.length} 20-F symbols, reached ${reached} | ${JSON.stringify(tally)} | ${Math.round((Date.now() - started) / 1000)}s`);
