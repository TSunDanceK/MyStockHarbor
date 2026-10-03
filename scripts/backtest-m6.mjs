// BACK-TEST M6 (#552 COWORK #99): the CODE-B #80 refusal reasons M1-M5 do not
// cover, where a method is plausible. READ-ONLY, from the R2 archive; no SEC
// request, no price, no FMP data. Printed: error statistics and counts only.
//
//   (a) "equity only incl. minority" (P/B, 11 names): parent equity estimated
//       as StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest
//       - MinorityInterest. Truth: filers that file all three on the same
//       balance-sheet date; error vs the filed StockholdersEquity.
//   (b) "share basis changed" (5 names): the newest cover count from before a
//       stock split, times the filed split ratio
//       (StockholdersEquityNoteStockSplitConversionRatio1). Truth: the first
//       cover count filed after the split period, within 200 days.
// Bar: within ±5% for at least 90% of at least 50 cases.
//   workflow: sec-archive.yml task "backtest-m6" (probe branch only)
import fs from "node:fs";
import { r2Client, decodeFacts } from "../lib/secArchive.mjs";

const keyOf = (n) => (fs.readFileSync("lib/server/secManifest.ts", "utf8").match(new RegExp(`export const ${n} = "([^"]+)"`)) ?? [])[1];
const INDEX = keyOf("SEC_FACTS_INDEX_KEY");
const URL_ = process.env.UPSTASH_REDIS_REST_URL, TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
let cmds = 0, r2reads = 0;
async function redis(cmd) {
  cmds++;
  const res = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
  const j = await res.json(); if (j.error) throw new Error("Upstash error"); return j.result;
}
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const r2 = r2Client();
const EQ = "StockholdersEquity", EQ_ALL = "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", NCI = "MinorityInterest";
const SPLIT = "StockholdersEquityNoteStockSplitConversionRatio1", COVER = "EntityCommonStockSharesOutstanding";
const WANT = new Set([EQ, EQ_ALL, NCI, SPLIT, COVER]);
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;

const symbols = ((await redis(["SMEMBERS", INDEX])) ?? []).map(String);
// Cells (a) could fill: Pickers symbols whose NEWEST balance-sheet date has
// equity incl. NCI but no parent equity (the "equity only incl. minority"
// refusal), split by whether MinorityInterest is filed on that date.
const PICKERS_KEY = keyOf("PICKERS_SEC_KEY");
const pickers = new Set(((await redis(["HKEYS", PICKERS_KEY])) ?? []).map((x) => String(x).toUpperCase()));
const inclOnly = [], fillable = [];
const symsByCik = new Map();
for (const s of symbols) { const k = REG[s]?.cik; if (k) { const c = String(k).padStart(10, "0"); (symsByCik.get(c) ?? symsByCik.set(c, []).get(c)).push(s.toUpperCase()); } }
const errA = [], errB = [];
let filers = 0, filersA = 0, filersB = 0, splitsSeen = 0;
const seen = new Set();
for (const s of symbols) {
  const cik = REG[s]?.cik; if (!cik) continue;
  const c = String(cik).padStart(10, "0"); if (seen.has(c)) continue; seen.add(c);
  const buf = await r2.get(`facts/${c}.ndjson.br`); r2reads++;
  if (!buf) continue;
  const rows = decodeFacts(buf).rows.filter((r) => WANT.has(r[1]) && r[4] && (r[0] === "us-gaap" || (r[0] === "dei" && r[1] === COVER)));
  if (!rows.length) continue;
  filers++;
  // newest filed value per (concept, start, end)
  const v = new Map();
  for (const r of rows) {
    const k = `${r[1]}|${r[3] ?? ""}|${r[4]}`;
    const old = v.get(k);
    if (!old || r[10] > old.filed) v.set(k, { val: r[5], filed: r[10] });
  }
  const at = (concept) => new Map([...v].filter(([k]) => k.startsWith(concept + "|")).map(([k, x]) => [k.split("|")[2], x.val]));

  // (a) parent equity = equity incl. NCI - NCI
  const eq = at(EQ), all = at(EQ_ALL), nci = at(NCI);
  let anyA = false;
  for (const [d, t] of eq) {
    if (!(t > 0) || !all.has(d) || !nci.has(d)) continue;
    if (all.get(d) === t) continue; // incl. = parent: no NCI to remove, nothing tested
    anyA = true;
    errA.push(Math.abs(all.get(d) - nci.get(d) - t) / t);
  }
  if (anyA) filersA++;
  const newest = [...new Set([...eq.keys(), ...all.keys()])].sort().at(-1);
  if (newest && all.has(newest) && !eq.has(newest)) {
    for (const sym of symsByCik.get(c) ?? []) if (pickers.has(sym)) { inclOnly.push(sym); if (nci.has(newest)) fillable.push(sym); }
  }

  // (b) split-adjusted cover count
  const covers = [...at(COVER)].filter(([, x]) => x > 0).sort((a, b) => a[0].localeCompare(b[0]));
  const splits = [...v].filter(([k]) => k.startsWith(SPLIT + "|")).map(([k, x]) => { const [, start, end] = k.split("|"); return { start: start || end, end, ratio: x.val }; })
    .filter((x) => x.ratio > 0 && x.ratio !== 1);
  const done = new Set();
  let anyB = false;
  for (const sp of splits) {
    // one test per distinct ratio and period end (the same split is restated in later filings)
    const id = `${sp.ratio}|${sp.end.slice(0, 7)}`; if (done.has(id)) continue; done.add(id);
    splitsSeen++;
    const pre = covers.filter(([d]) => d < sp.start).at(-1);
    const post = covers.find(([d]) => d > sp.end);
    if (!pre || !post || days(pre[0], post[0]) > 200 + days(sp.start, sp.end)) continue;
    anyB = true;
    errB.push(Math.abs(pre[1] * sp.ratio - post[1]) / post[1]);
  }
  if (anyB) filersB++;
}
const q = (a, p) => { const x = [...a].sort((m, n) => m - n); return x.length ? x[Math.min(x.length - 1, Math.floor(p * (x.length - 1)))] : null; };
const pct = (x) => (x === null ? "-" : `${(x * 100).toFixed(2)}%`);
const line = (name, e) => { const w = e.filter((x) => x <= 0.05).length / (e.length || 1); return `  ${name}: n ${e.length}; median ${pct(q(e, 0.5))}; p90 ${pct(q(e, 0.9))}; within ±5% ${(w * 100).toFixed(1)}% -> ${e.length >= 50 && w >= 0.9 ? "PASS" : e.length < 50 ? "FAIL (too few cases)" : "FAIL"}`; };
console.log(`M6 back-test. Filers read ${filers}; with all three equity lines on one date ${filersA}; with a split ratio and covers either side ${filersB} (split periods seen ${splitsSeen})`);
console.log(line("(a) parent equity = equity incl. NCI - NCI", errA));
console.log(`  (a) Pickers rows refused "equity only incl. minority" (newest date): ${inclOnly.length} ${inclOnly.join(" ")}; MinorityInterest filed that date: ${fillable.length} ${fillable.join(" ")}`);
console.log(line("(b) pre-split cover count x filed split ratio", errB));
console.log(`Redis commands ${cmds} (read-only) · R2 reads ${r2reads} · SEC requests 0 · no price`);
