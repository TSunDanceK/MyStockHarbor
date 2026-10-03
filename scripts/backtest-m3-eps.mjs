// BACK-TEST M3 (#552 COWORK #99): TWELVE-MONTH EPS WHEN ONE QUARTER IS NOT
// FILED STANDALONE. READ-ONLY, from the R2 archive; no SEC request, no price,
// no FMP data. Printed: error statistics and counts only.
//
// Truth: filers that DO file a standalone Q4 diluted EPS (a ~3-month duration
// ending at the fiscal year end). For each such year, with the next year's
// standalone Q1-Q3 also filed, the trailing twelve months ending at the next
// Q3 is  Q4 + Q1 + Q2 + Q3. The two candidate methods replace Q4 with:
//   (a) FY diluted EPS - 9-month YTD diluted EPS (same fiscal year);
//   (b) Q4 net income / Q4 weighted diluted shares, where Q4 net income is
//       FY - 9M net income (additive) and the shares are FY's weighted
//       diluted count (the Q4 count itself is the thing not filed).
// Error = |TTM_est - TTM_true| / |TTM_true|, TTM_true required to be at least
// $0.10 in absolute value (near-zero EPS has no meaningful relative error).
//   workflow: sec-archive.yml task "backtest-m3" (probe branch only)
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
const WANT = new Set(["EarningsPerShareDiluted", "NetIncomeLoss", "WeightedAverageNumberOfDilutedSharesOutstanding"]);
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;

const symbols = ((await redis(["SMEMBERS", INDEX])) ?? []).map(String);
const errA = [], errB = [];
let filers = 0, withQ4 = 0;
const seen = new Set();
for (const s of symbols) {
  const cik = REG[s]?.cik; if (!cik) continue;
  const c = String(cik).padStart(10, "0"); if (seen.has(c)) continue; seen.add(c);
  const buf = await r2.get(`facts/${c}.ndjson.br`); r2reads++;
  if (!buf) continue;
  const rows = decodeFacts(buf).rows.filter((r) => r[0] === "us-gaap" && WANT.has(r[1]) && r[3] && r[4]);
  if (!rows.length) continue;
  filers++;
  // newest filed value per (concept, start, end)
  const v = new Map();
  for (const r of rows) {
    const k = `${r[1]}|${r[3]}|${r[4]}`;
    const old = v.get(k);
    if (!old || r[10] > old.filed) v.set(k, { val: r[5], filed: r[10] });
  }
  const get = (concept, start, end) => v.get(`${concept}|${start}|${end}`)?.val ?? null;
  const durs = (concept, lo, hi) => [...v.keys()].filter((k) => k.startsWith(concept + "|")).map((k) => k.split("|")).filter(([, a, b]) => { const d = days(a, b); return d >= lo && d <= hi; }).map(([, a, b]) => ({ start: a, end: b }));
  const EPS = "EarningsPerShareDiluted";
  const years = durs(EPS, 350, 380);
  let any = false;
  for (const fy of years) {
    const q4 = durs(EPS, 80, 100).find((q) => q.end === fy.end);
    const ytd9 = durs(EPS, 260, 290).find((q) => q.start === fy.start);
    if (!q4 || !ytd9) continue;
    // next year's standalone Q1-Q3, consecutive after fy.end
    const qs = durs(EPS, 80, 100).filter((q) => q.start > fy.end && days(fy.end, q.end) < 290).sort((a, b) => a.end.localeCompare(b.end)).slice(0, 3);
    if (qs.length < 3) continue;
    const q4v = get(EPS, q4.start, q4.end), fyv = get(EPS, fy.start, fy.end), y9 = get(EPS, ytd9.start, ytd9.end);
    const rest = qs.map((q) => get(EPS, q.start, q.end));
    if ([q4v, fyv, y9, ...rest].some((x) => x === null)) continue;
    const ttm = q4v + rest.reduce((a, b) => a + b, 0);
    if (Math.abs(ttm) < 0.1) continue;
    any = true;
    errA.push(Math.abs((fyv - y9) - q4v) / Math.abs(ttm));
    const niFy = get("NetIncomeLoss", fy.start, fy.end), ni9 = get("NetIncomeLoss", ytd9.start, ytd9.end), shFy = get("WeightedAverageNumberOfDilutedSharesOutstanding", fy.start, fy.end);
    if (niFy !== null && ni9 !== null && shFy) errB.push(Math.abs((niFy - ni9) / shFy - q4v) / Math.abs(ttm));
  }
  if (any) withQ4++;
}
const q = (a, p) => { const x = [...a].sort((m, n) => m - n); return x.length ? x[Math.min(x.length - 1, Math.floor(p * (x.length - 1)))] : null; };
const pct = (x) => (x === null ? "-" : `${(x * 100).toFixed(2)}%`);
const line = (name, e) => { const w = e.filter((x) => x <= 0.05).length / (e.length || 1); return `  ${name}: n ${e.length}; median ${pct(q(e, 0.5))}; p90 ${pct(q(e, 0.9))}; within ±5% ${(w * 100).toFixed(1)}% -> ${e.length >= 50 && w >= 0.9 ? "PASS" : "FAIL"}`; };
console.log(`M3 back-test: twelve-month diluted EPS with Q4 replaced. Filers with EPS in the archive ${filers}; with a filed standalone Q4 + the next three quarters ${withQ4}`);
console.log(line("(a) FY EPS - 9M YTD EPS", errA));
console.log(line("(b) (FY - 9M net income) / FY weighted diluted shares", errB));
console.log(`Redis commands ${cmds} (read-only) · R2 reads ${r2reads} · SEC requests 0 · no price`);
