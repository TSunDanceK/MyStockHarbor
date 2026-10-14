// WHICH NAMES THE LIQUIDITY SLICE WOULD ADD AT A CAP OF 1,000 (#552 COWORK #235 S1),
// before it is switched on. Reads only.
//
// The build ranks on the newest-bar summary's `dv` (eodLast.ts), which the
// nightly job does not write until S1 merges. So this computes the same figure
// from each candidate's stored bars with the same function (dollarVolume20),
// puts it on the summary rows, and ranks with the build's own
// scoreByCapAndLiquidity. Only candidates that could matter are read: not
// already in the Pickers universe, with a SEC cap of at least 75% of the floor.
//
// Prints symbols, ranks and which floor a near miss fails. No price, cap or
// volume figure is printed.
//
//   relay task: write-liquidity-slice-preview
//   Redis: 1 HGETALL (SEC rows) + 1 HGETALL (eod-last) + 1 GET (universe)
//          + 1 MGET per 25 candidates (~80 KB a symbol: the one-off cost).
import "./lib/register-ts-here.mjs";

const { Redis } = await import("@upstash/redis");
const L = await import("../lib/server/liquiditySlice.ts");
const { dollarVolume20, parseEodLast } = await import("../lib/server/marketData/eodLast.ts");
const { secCapAndPe, PICKERS_SEC_KEY } = await import("../lib/server/pickersSecFundamentals.ts");
const { TIINGO_EOD_LAST_KEY, tiingoEodKey } = await import("../lib/server/marketData/keys.ts");
const { toDashed } = await import("../lib/symbolSpellings.mjs");

const PICKERS_SYMBOLS_KEY = "msh:pickers:v10:symbols"; // as content-candidates.mjs names it
const SLOTS = L.liquiditySlots(1000);
const redis = Redis.fromEnv();
let commands = 0;
const parse = (v) => {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return null; }
};

const secRaw = (await redis.hgetall(PICKERS_SEC_KEY)) ?? {}; commands++;
const eodRaw = (await redis.hgetall(TIINGO_EOD_LAST_KEY)) ?? {}; commands++;
const uniRaw = await redis.get(PICKERS_SYMBOLS_KEY); commands++;
const uniList = Array.isArray(uniRaw) ? uniRaw : Array.isArray(uniRaw?.symbols) ? uniRaw.symbols : [];
const universe = new Set(uniList.map((x) => toDashed(String(typeof x === "string" ? x : x?.symbol ?? "").toUpperCase())).filter(Boolean));

const rows = {};
for (const [k, v] of Object.entries(secRaw)) { const r = parse(v); if (r?.inputs) rows[k] = r; }
const eod = {};
for (const [k, v] of Object.entries(eodRaw)) { const r = parseEodLast(v); if (r) eod[k.toUpperCase()] = { ...r }; }

// Candidates worth reading bars for.
const cand = [];
for (const [field, row] of Object.entries(rows)) {
  const sym = toDashed(field);
  if (universe.has(sym)) continue;
  const last = eod[sym];
  if (!last) continue;
  const cap = secCapAndPe(row, last.c).marketCap;
  if (typeof cap === "number" && cap >= 0.75 * L.LIQUIDITY_MIN_CAP) cand.push(sym);
}
let bytes = 0;
for (let i = 0; i < cand.length; i += 25) {
  const chunk = cand.slice(i, i + 25);
  const vals = await redis.mget(...chunk.map((s) => tiingoEodKey(s))); commands++;
  chunk.forEach((s, j) => {
    const v = vals[j];
    if (v) bytes += typeof v === "string" ? v.length : JSON.stringify(v).length;
    const bars = parse(v)?.bars;
    if (Array.isArray(bars)) eod[s].dv = dollarVolume20(bars);
  });
}
// Only the candidates carry dv; everything else ranks as absent, as in the
// build before tonight's job. Universe members are skipped, as fillSlots does.
// SPCX: topByCap.CAP_RANK_HOLD_OUT (that module imports next/cache, so it is named here).
const scored = L.scoreByCapAndLiquidity(rows, eod, new Set(["SPCX"])).filter((c) => !universe.has(c.sym));
const picked = scored.filter((c) => c.passes).slice(0, SLOTS);
const cutScore = picked.length ? picked[picked.length - 1].score : Infinity;
const near = scored.filter((c) => !c.passes && c.score >= cutScore && (c.cap >= 0.75 * L.LIQUIDITY_MIN_CAP) && (c.dv >= 0.75 * L.LIQUIDITY_MIN_DOLLAR_VOLUME));

console.log(`SEC rows ${Object.keys(rows).length}; eod-last rows ${Object.keys(eod).length}; universe ${universe.size}; candidates read ${cand.length} (${(bytes / 1048576).toFixed(1)} MB)`);
console.log(`passing floors, not in universe: ${scored.filter((c) => c.passes).length}; slots ${SLOTS}; picked ${picked.length}`);
for (let i = 0; i < picked.length; i += 30) console.log(`PICK ${picked.slice(i, i + 30).map((c) => c.sym).join(",")}`);
for (const c of near) {
  const why = [c.cap < L.LIQUIDITY_MIN_CAP ? "cap" : null, c.dv < L.LIQUIDITY_MIN_DOLLAR_VOLUME ? "dv" : null].filter(Boolean).join("+");
  console.log(`NEAR ${c.sym} under:${why}`);
}
console.log(`Redis commands: ${commands}`);
