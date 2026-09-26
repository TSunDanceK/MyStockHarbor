// Tiingo vs FMP daily history, ~50 symbols (#553 COWORK #55 §2).
//
// Reads what the nightly job stored (msh:tiingo:eod:v1:<SYM>) beside today's
// FMP history (msh:history:v7:<SYM>) and compares last close, 200-day MA and
// RSI(14) (COWORK #58 item 2), each from its own source's series.
// PRINTS COUNTS AND DIFFERENCES ONLY, never a price: Actions logs are public,
// and Tiingo data in a public log would be distribution (contract §5.3).
//
// Makes NO Tiingo request (this job does not hold the key). Run it after the
// first complete tiingo-eod night.
//
//   relay task: write-tiingo-parity     (SYMBOLS optional; default: every
//               17th pool symbol, ~50)
//   Redis: HKEYS + 1 MGET for the Tiingo side + up to 2 MGETs for FMP's two
//          spellings + 1 SCAN + 1 HKEYS for the coverage gaps = ~6 commands;
//          ~7 MB read once.
import { Redis } from "@upstash/redis";
import { symbolSpellings } from "../lib/symbolSpellings.mjs";

const redis = Redis.fromEnv();
let commands = 0;
const pool = ((await redis.hkeys("msh:price-pool:v1")) ?? []).map(String).sort();
commands++;
const given = (process.env.SYMBOLS ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const symbols = given.length ? given : pool.filter((_, i) => i % 17 === 0).slice(0, 50);

const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const tiingo = await redis.mget(...symbols.map((s) => `msh:tiingo:eod:v1:${s}`));
commands++;
// FMP's key uses whatever spelling the caller had; try the first two spellings.
const spell = symbols.map((s) => symbolSpellings(s).slice(0, 2));
const fmpA = await redis.mget(...spell.map((sp) => `msh:history:v7:${sp[0]}`));
commands++;
const needB = spell.map((sp, i) => (!fmpA[i] && sp[1] ? i : -1)).filter((i) => i >= 0);
const fmpB = needB.length ? await redis.mget(...needB.map((i) => `msh:history:v7:${spell[i][1]}`)) : [];
if (needB.length) commands++;

const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);
const sma = (xs, n) => (xs.length >= n ? xs.slice(-n).reduce((a, b) => a + b, 0) / n : null);
// Wilder RSI(14) over the whole series given, as the site's indicators compute it.
function rsi(xs, n = 14) {
  if (xs.length <= n) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = xs[i] - xs[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
const pct = (x) => `${(x * 100).toFixed(2)}%`;

// Per symbol: last close, 200-day MA and RSI(14), each computed from EACH
// source's own series ending on the last date both have. Differences only.
let compared = 0, noTiingo = 0, noFmp = 0, sameLast = 0;
const buckets = { close: [0, 0, 0], ma200: [0, 0, 0], rsi: [0, 0, 0] }; // <=0.5%, <=2%, >2% (RSI: <=0.5, <=2, >2 points)
const flagged = [];
symbols.forEach((s, i) => {
  const t = parse(tiingo[i]);
  const bi = needB.indexOf(i);
  const f = parse(fmpA[i] ?? (bi >= 0 ? fmpB[bi] : null));
  if (!t?.bars?.length) { noTiingo++; return; }
  if (!f?.daily?.length) { noFmp++; return; }
  compared++;
  const fDaily = [...f.daily].map((p) => [String(p.date).slice(0, 10), Number(p.close)]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const fDates = new Set(fDaily.map((x) => x[0]));
  const common = t.bars.map((b) => b[0]).filter((d) => fDates.has(d));
  if (!common.length) return;
  const end = common[common.length - 1];
  const tLast = t.bars[t.bars.length - 1][0], fLast = fDaily[fDaily.length - 1][0];
  if (tLast === fLast) sameLast++;
  const tCl = t.bars.filter((b) => b[0] <= end).map((b) => b[4]);
  const fCl = fDaily.filter((x) => x[0] <= end).map((x) => x[1]);
  const put = (k, d, pts) => { const lim = pts ? [0.5, 2] : [0.005, 0.02]; buckets[k][d <= lim[0] ? 0 : d <= lim[1] ? 1 : 2]++; };
  const dClose = rel(tCl[tCl.length - 1], fCl[fCl.length - 1]);
  put("close", dClose, false);
  const tm = sma(tCl, 200), fm = sma(fCl, 200);
  const dMa = tm && fm ? rel(tm, fm) : null;
  if (dMa !== null) put("ma200", dMa, false);
  const tr = rsi(tCl.slice(-400)), fr = rsi(fCl.slice(-400));
  const dRsi = tr !== null && fr !== null ? Math.abs(tr - fr) : null;
  if (dRsi !== null) put("rsi", dRsi, true);
  // Where the close differences start: only on old dates means an adjustment
  // basis (dividends back-adjusted on one side); on the last date, the close itself.
  const tMap = new Map(t.bars.map((b) => [b[0], b[4]]));
  const fMap = new Map(fDaily);
  const recentOff = common.slice(-5).filter((d) => rel(tMap.get(d), fMap.get(d)) > 0.005).length;
  const oldOff = common.slice(0, -5).filter((d) => rel(tMap.get(d), fMap.get(d)) > 0.005).length;
  if (dClose > 0.005 || (dMa ?? 0) > 0.005) {
    const reason = tLast !== fLast && recentOff === 0 ? `date (last bar ${tLast === end ? "FMP" : "Tiingo"} ahead)`
      : recentOff === 0 && oldOff > 0 ? "adjustment basis (older closes only)"
      : oldOff === 0 ? "the recent close itself (venue or print)"
      : "throughout (spelling/listing or basis) — check";
    flagged.push(`${s}: close ${pct(dClose)}, MA200 ${dMa === null ? "n/a" : pct(dMa)}, RSI ${dRsi === null ? "n/a" : dRsi.toFixed(1) + " pts"}; dates over 0.5%: last 5 ${recentOff}, older ${oldOff}; likely: ${reason}`);
  }
});
console.log(`symbols ${symbols.length}: compared ${compared}; no Tiingo history ${noTiingo}; no FMP history ${noFmp}; same last bar date ${sameLast}/${compared}`);
for (const [k, [a, b, c]] of Object.entries(buckets)) {
  console.log(`${k.padEnd(6)} within ${k === "rsi" ? "0.5 pts" : "0.5%"}: ${a}; within ${k === "rsi" ? "2 pts" : "2%"}: ${a + b}; beyond: ${c}  (of ${a + b + c})`);
}
console.log(`symbols over 0.5% on close or MA200: ${flagged.length}`);
for (const l of flagged) console.log(`  ${l}`);

// Coverage gaps, our tickers only: universe symbols with no stored Tiingo
// history, and pool symbols with no Tiingo quote.
const eodKeys = [];
let cursor = "0";
do {
  const [next, batch] = await redis.scan(cursor, { match: "msh:tiingo:eod:v1:*", count: 1000 });
  commands++;
  cursor = String(next);
  eodKeys.push(...batch.map((k) => String(k).slice("msh:tiingo:eod:v1:".length)));
} while (cursor !== "0");
const haveEod = new Set(eodKeys);
const quoteKeys = new Set(((await redis.hkeys("msh:tiingo:quotes:v1")) ?? []).map(String));
commands++;
const noEod = pool.filter((s) => !haveEod.has(s));
const noQuote = pool.filter((s) => !quoteKeys.has(s));
console.log(`\ncoverage: pool ${pool.length}; with Tiingo history ${pool.length - noEod.length} (missing: ${noEod.join(", ") || "none"}); with a Tiingo quote ${pool.length - noQuote.length} (missing: ${noQuote.join(", ") || "none"})`);
console.log(`Redis commands: ${commands}; Tiingo requests: 0`);
