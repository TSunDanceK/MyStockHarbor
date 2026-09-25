// Tiingo vs FMP daily history, ~50 symbols (#553 COWORK #55 §2).
//
// Reads what the nightly job stored (msh:tiingo:eod:v1:<SYM>) beside today's
// FMP history (msh:history:v7:<SYM>) and compares the overlapping dates.
// PRINTS COUNTS AND DIFFERENCES ONLY, never a price: Actions logs are public,
// and Tiingo data in a public log would be distribution (contract §5.3).
//
// Makes NO Tiingo request (this job does not hold the key). Run it after the
// first complete tiingo-eod night.
//
//   relay task: write-tiingo-parity     (SYMBOLS optional; default: every
//               17th pool symbol, ~50)
//   Redis: HKEYS + 1 MGET for the Tiingo side + up to 2 MGETs for FMP's two
//          spellings = ~4 commands; ~7 MB read once.
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
let compared = 0, noTiingo = 0, noFmp = 0, datesBoth = 0, onlyT = 0, onlyF = 0, within05 = 0, within2 = 0;
const worst = [];
symbols.forEach((s, i) => {
  const t = parse(tiingo[i]);
  const bi = needB.indexOf(i);
  const f = parse(fmpA[i] ?? (bi >= 0 ? fmpB[bi] : null));
  if (!t?.bars?.length) { noTiingo++; return; }
  if (!f?.daily?.length) { noFmp++; return; }
  compared++;
  const tMap = new Map(t.bars.map((b) => [b[0], b[4]]));
  const fMap = new Map(f.daily.map((p) => [String(p.date).slice(0, 10), Number(p.close)]));
  const lo = [t.bars[0][0], String(f.daily[0].date).slice(0, 10)].sort().pop();
  let symMax = 0, symN = 0, symOff = 0;
  for (const [d, fc] of fMap) {
    if (d < lo) continue;
    if (!tMap.has(d)) { onlyF++; continue; }
    datesBoth++; symN++;
    const r = rel(tMap.get(d), fc);
    if (r <= 0.005) within05++; else symOff++;
    if (r <= 0.02) within2++;
    symMax = Math.max(symMax, r);
  }
  for (const d of tMap.keys()) if (d >= lo && !fMap.has(d)) onlyT++;
  worst.push({ s, symMax, symN, symOff });
});
worst.sort((a, b) => b.symMax - a.symMax);
console.log(`symbols ${symbols.length}: compared ${compared}; no Tiingo history ${noTiingo}; no FMP history ${noFmp}`);
console.log(`overlapping dates ${datesBoth}; dates only in FMP ${onlyF}; only in Tiingo ${onlyT}`);
console.log(`close within 0.5%: ${within05}/${datesBoth}; within 2%: ${within2}/${datesBoth}`);
console.log("widest symbols (max relative difference %, dates compared, dates over 0.5%):");
for (const w of worst.slice(0, 10)) console.log(`  ${w.s}: ${(w.symMax * 100).toFixed(2)}%, ${w.symN}, ${w.symOff}`);
console.log("(Tiingo closes are split- and dividend-adjusted; a symbol wide only on older dates is FMP's close being unadjusted for dividends, not a data error.)");
console.log(`Redis commands: ${commands}; Tiingo requests: 0`);
