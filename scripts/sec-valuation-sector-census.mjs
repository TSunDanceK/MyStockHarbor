// SECTOR BENCHMARKS FOR THE VALUATION CARD (#552 COWORK #202 item 3). READ-ONLY.
// What the low / fair / rich bands would be if built from OUR OWN SEC valuations:
//   inputs   the SEC picker rows (one HGETALL; the full rows, which carry the
//            multiple inputs) and each symbol's latest stored close (one
//            HGETALL of eod-last), through the SHIPPED valuationMultiples with
//            estimates (as the stock page calls it) and secCapAndPe for P/E (the
//            figure the pickers and the P/E sector line use)
//   sector   the FMP-free SIC classification (sicProfileFor), as peSectorMedians;
//            banks (SIC 6000–6299) counted separately as their own group
//   kept     ok figures > 0 only: refusals, losses, negative book or EBITDA,
//            non-USD and missing closes are out
// Per multiple × sector: n, median, quartiles, the half-sample spread (the P/E
// line's stability test), and what share of names 0.8×/1.2× of the median
// would put in each band. Then TSLA, KO and JPM placed on both edge choices.
// Store: HGETALL ×2. Anything else is refused. No SEC requests.
import { register } from "node:module";
import { Redis } from "@upstash/redis";

register("./lib/ts-resolve-app.mjs", import.meta.url);
const READS = new Set(["hgetall"]);
const counts = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (process.env.UPSTASH_REDIS_REST_URL && url.startsWith(process.env.UPSTASH_REDIS_REST_URL)) {
    const body = JSON.parse(init.body ?? "null");
    for (const c of Array.isArray(body?.[0]) ? body : [body]) {
      const op = String(c?.[0]).toLowerCase();
      if (!READS.has(op)) throw new Error(`read guard: ${op} refused`);
      counts[op] = (counts[op] ?? 0) + 1;
    }
  } else if (!url.startsWith("data:")) throw new Error("read guard: only the store may be reached");
  return realFetch(input, init);
};

const { PICKERS_SEC_KEY, PICKERS_SEC_TTL_SECONDS, secCapAndPe, toSecCapRow } = await import("../lib/server/pickersSecFundamentals.ts");
const { valuationMultiples } = await import("../lib/server/secValuation.ts");
const { TIINGO_EOD_LAST_KEY } = await import("../lib/server/marketData/keys.ts");
const { parseEodLast } = await import("../lib/server/marketData/eodLast.ts");
const { sicProfileFor } = await import("../lib/server/staticProfile.ts");
const { registrantFor } = await import("../lib/server/stockProfile.ts");
const { BANK_SIC_RANGE } = await import("../lib/server/secEstimates.ts");
const { quantile, halfSampleSpreadPct, PE_PEER_FLOOR, PE_MAX_SPREAD_PCT } = await import("../lib/peSectorLine.ts");
const { toDashed, toDotted } = await import("../lib/symbolSpellings.mjs");

const redis = Redis.fromEnv();
const rawRows = (await redis.hgetall(PICKERS_SEC_KEY)) ?? {};
const rawEod = (await redis.hgetall(TIINGO_EOD_LAST_KEY)) ?? {};
const eod = {};
for (const [k, v] of Object.entries(rawEod)) { const r = parseEodLast(v); if (r) eod[k] = r; }
const staleBefore = Date.now() - PICKERS_SEC_TTL_SECONDS * 1000;

const MULTS = ["pe", "ps", "pb", "evEbitda"];
const isBank = (sym) => { const n = Number(registrantFor(sym)?.sic); return Number.isFinite(n) && n >= BANK_SIC_RANGE[0] && n <= BANK_SIC_RANGE[1]; };
const groupOf = (sym) => (isBank(sym) ? "Banks (SIC 6000–6299)" : sicProfileFor(sym)?.sector ?? null);

const vals = Object.fromEntries(MULTS.map((m) => [m, new Map()])); // mult -> group -> [values]
const per = {}; // sym -> {group, pe, ps, pb, evEbitda}
const refused = Object.fromEntries(MULTS.map((m) => [m, {}]));
let rows = 0, priced = 0, noGroup = 0;
for (const [sym, value] of Object.entries(rawRows)) {
  let row = value;
  if (typeof row === "string") { try { row = JSON.parse(row); } catch { continue; } }
  if (!row || row.v !== 1 || !row.m || !(row.at >= staleBefore)) continue;
  rows++;
  const last = eod[sym] ?? eod[toDashed(sym)] ?? eod[toDotted(sym)];
  if (!last) continue;
  priced++;
  const group = groupOf(sym);
  if (!group) { noGroup++; continue; }
  const inputs = { shares: row.inputs.shares, eps: null, refusals: row.inputs.refusals, sic: row.inputs.sic ?? null };
  const mult = valuationMultiples(inputs, row.m, last.c); // FILED ONLY (round 2): as the shipped benchmarks
  const pe = secCapAndPe(toSecCapRow(row), last.c).pe;
  const got = { pe: typeof pe === "number" ? { ok: true, val: pe } : { ok: false, why: "pe-refused-or-loss" }, ps: mult.ps, pb: mult.pb, evEbitda: mult.evEbitda };
  per[sym] = { group };
  for (const m of MULTS) {
    const f = got[m];
    if (f && f.ok && Number.isFinite(f.val) && f.val > 0) {
      per[sym][m] = f.val;
      const list = vals[m].get(group) ?? [];
      list.push(f.val);
      vals[m].set(group, list);
    } else {
      const why = !f ? "none" : f.ok ? "zero-or-negative" : f.why ?? "refused";
      refused[m][why] = (refused[m][why] ?? 0) + 1;
    }
  }
}
console.log(`rows ${rows} (fresh) · priced ${priced} · no sector ${noGroup}`);

const market = {};
for (const m of MULTS) market[m] = [...vals[m].values()].flat();
const stat = (xs0) => { const xs = [...xs0].sort((a, b) => a - b); return ({ n: xs.length, p25: quantile(xs, 0.25), med: quantile(xs, 0.5), p75: quantile(xs, 0.75), spread: halfSampleSpreadPct(xs) }); }; // SORTED (round 3), as lib/valuationBands quartileBench
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "—");
const bench = {};
for (const m of MULTS) {
  console.log(`\n=== ${m.toUpperCase()} === refusals: ${JSON.stringify(refused[m])}`);
  const mk = stat(market[m]);
  console.log(`  MARKET-WIDE  n=${mk.n} p25=${f1(mk.p25)} median=${f1(mk.med)} p75=${f1(mk.p75)}`);
  bench[m] = { market: mk, sectors: {} };
  for (const [g, xs] of [...vals[m]].sort((a, b) => b[1].length - a[1].length)) {
    const s = stat(xs);
    const usable = s.n >= PE_PEER_FLOOR && s.spread <= PE_MAX_SPREAD_PCT;
    const lo = xs.filter((x) => x < 0.8 * s.med).length / s.n, hi = xs.filter((x) => x > 1.2 * s.med).length / s.n;
    bench[m].sectors[g] = { ...s, usable };
    console.log(`  ${usable ? "USE " : "fall"} ${g}: n=${s.n} p25=${f1(s.p25)} median=${f1(s.med)} p75=${f1(s.p75)} spread ±${s.spread > 1e6 ? "∞" : s.spread.toFixed(0)}% · 0.8×/1.2× split low ${(lo * 100).toFixed(0)}% / fair ${((1 - lo - hi) * 100).toFixed(0)}% / rich ${(hi * 100).toFixed(0)}%`);
  }
}

console.log("\n=== TSLA, KO, JPM ===");
for (const sym of ["TSLA", "KO", "JPM"]) {
  const p = per[sym];
  if (!p) { console.log(`  ${sym}: no fresh priced row`); continue; }
  console.log(`  ${sym} — group ${p.group}`);
  for (const m of MULTS) {
    const s = bench[m].sectors[p.group];
    const useSector = s?.usable;
    const b = useSector ? s : bench[m].market;
    const v = p[m];
    const q = v == null ? "—" : v < b.p25 ? "Low" : v > b.p75 ? "Rich" : "Fair";
    const r = v == null ? "—" : v < 0.8 * b.med ? "Low" : v > 1.2 * b.med ? "Rich" : "Fair";
    console.log(`    ${m}: ${v == null ? "no figure" : f1(v) + "×"} vs ${useSector ? "sector" : "MARKET (sector " + (s ? `n=${s.n}, spread ±${s.spread > 1e6 ? "∞" : s.spread.toFixed(0)}%` : "absent") + ")"} p25 ${f1(b.p25)} / median ${f1(b.med)} / p75 ${f1(b.p75)} → quartiles: ${q} · 0.8×/1.2×: ${r}`);
  }
}
console.log(`\nStore commands: ${JSON.stringify(counts)}`);
