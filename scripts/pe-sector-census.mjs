// THE P/E SECTOR-MEDIAN CENSUS (#552 CODE-A #137 §4, COWORK #133). Reads only.
//
// The header strip's proposed "Above / Near / Below sector median" line needs
// to know, before anything is built: how many peers each sector has with a
// usable trailing P/E, how stable the median is, and how many stock pages
// would get the line at all. Everything here is what the page itself would
// use, from the shipped code:
//   P/E      applySecEarnings(row, price).peRatio — A's peRatio() through the
//            SEC picker rows warm-pickers-sec stores (twelve months of diluted
//            EPS; loss-makers, stale EPS, ADS units and near-zero EPS refused)
//   price    the stored Tiingo close (msh:tiingo:eod-last:v1), as the pool uses
//   sector   sicProfileFor() — the FMP-free classification (filing rules, then
//            the SIC table), so the census survives the FMP cancel
//   banks    SIC 6000–6299 skipped (the estimate layer's bank gate)
// Prints counts, medians and spreads only: no symbol's price is printed.
//
//   relay task: write-pe-sector-census (READ-ONLY despite the prefix: the
//   credentials live in that job). Redis: 2 HGETALL.
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const { applySecEarnings, PICKERS_SEC_KEY } = await import("../lib/server/pickersSecFundamentals.ts");
const { sicProfileFor } = await import("../lib/server/staticProfile.ts");
const { toDashed } = await import("../lib/symbolSpellings.mjs");
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows ?? {};

const [rowsRaw, eodRaw] = await Promise.all([
  redis.hgetall(PICKERS_SEC_KEY),
  redis.hgetall("msh:tiingo:eod-last:v1"),
]);
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const eod = new Map(Object.entries(eodRaw ?? {}).map(([k, v]) => [toDashed(k.toUpperCase()), parse(v)]));
const regFor = (s) => REG[s] ?? REG[s.replace(/-/g, ".")] ?? null;

const bySector = new Map();
const tally = { rows: 0, priced: 0, bank: 0, noSector: 0, refused: new Map(), usable: 0 };
for (const [sym0, raw] of Object.entries(rowsRaw ?? {})) {
  const sym = toDashed(sym0.toUpperCase());
  tally.rows++;
  const row = parse(raw);
  const sic = Number(regFor(sym)?.sic ?? row?.inputs?.sic);
  if (sic >= 6000 && sic <= 6299) { tally.bank++; continue; }
  const sector = sicProfileFor(sym)?.sector ?? sicProfileFor(sym.replace(/-/g, "."))?.sector ?? null;
  if (!sector) { tally.noSector++; continue; }
  const price = eod.get(sym)?.c ?? null;
  if (price != null) tally.priced++;
  const fig = applySecEarnings(row, price);
  const pe = fig?.peRatio ?? null;
  const s = bySector.get(sector) ?? { members: 0, pes: [] };
  s.members++;
  if (typeof pe === "number" && Number.isFinite(pe)) { s.pes.push(pe); tally.usable++; }
  else {
    const why = price == null ? "no price" : fig === null ? "row before P/E moved" : "refused (loss, stale, ADS, near-zero EPS or non-USD)";
    tally.refused.set(why, (tally.refused.get(why) ?? 0) + 1);
  }
  bySector.set(sector, s);
}

const q = (xs, p) => { const a = [...xs].sort((x, y) => x - y); const i = (a.length - 1) * p; const lo = Math.floor(i); return a[lo] + (a[Math.ceil(i)] - a[lo]) * (i - lo); };
// Deterministic half-sample medians: how far the median moves on a different half of the peers.
const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
function halfSpread(pes) {
  if (pes.length < 6) return null;
  const r = rng(42); const meds = [];
  for (let k = 0; k < 200; k++) {
    const pick = pes.filter(() => r() < 0.5);
    if (pick.length >= 3) meds.push(q(pick, 0.5));
  }
  return [q(meds, 0.05), q(meds, 0.95)];
}

console.log(`picker rows ${tally.rows} · banks skipped (SIC 6000–6299) ${tally.bank} · no sector ${tally.noSector} · priced ${tally.priced} · usable P/E ${tally.usable}`);
console.log(`no usable P/E: ${[...tally.refused].map(([k, v]) => `${k} ${v}`).join(" · ")}`);
console.log("\nsector | members | usable P/E | median | p25–p75 | half-sample median 5–95% | spread as % of median");
const rows = [...bySector.entries()].sort((a, b) => b[1].pes.length - a[1].pes.length);
for (const [sector, s] of rows) {
  const n = s.pes.length;
  if (!n) { console.log(`${sector} | ${s.members} | 0 | — | — | — | —`); continue; }
  const med = q(s.pes, 0.5), hs = halfSpread(s.pes);
  console.log(`${sector} | ${s.members} | ${n} | ${med.toFixed(1)} | ${q(s.pes, 0.25).toFixed(1)}–${q(s.pes, 0.75).toFixed(1)} | ${hs ? `${hs[0].toFixed(1)}–${hs[1].toFixed(1)}` : "n<6"} | ${hs ? `±${(((hs[1] - hs[0]) / 2 / med) * 100).toFixed(0)}%` : "—"}`);
}

// Who would see the line, and how the words would split, at peer floors N and "near" bands.
console.log("\ncoverage: pages whose own P/E is usable AND whose sector has ≥ N usable peers");
for (const N of [10, 20, 30]) {
  const ok = rows.filter(([, s]) => s.pes.length >= N);
  const pages = ok.reduce((t, [, s]) => t + s.pes.length, 0);
  console.log(`  N=${N}: ${ok.length} of ${rows.length} sectors, ${pages} of ${tally.usable} usable pages (${((pages / Math.max(1, tally.usable)) * 100).toFixed(0)}%)`);
}
for (const band of [10, 15, 25]) {
  let above = 0, near = 0, below = 0;
  for (const [, s] of rows) {
    if (s.pes.length < 20) continue;
    const med = q(s.pes, 0.5);
    for (const pe of s.pes) {
      const d = ((pe - med) / med) * 100;
      if (Math.abs(d) <= band) near++; else if (d > 0) above++; else below++;
    }
  }
  console.log(`  "near" = within ±${band}% (N≥20): above ${above} · near ${near} · below ${below}`);
}
console.log("\nRedis commands: 2 (HGETALL ×2), read-only");
