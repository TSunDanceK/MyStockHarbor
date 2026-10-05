// FAIR VALUE GAPS AS A PRICE ZONES INPUT? MEASURED BEFORE ANY PROPOSAL (#563 COWORK #107 §3).
//
// Over the Pickers universe, on the Tiingo daily bars the stock page draws
// (msh:tiingo:eod:v2), runs the Price zones card's lib/ta/confluence.ts as the
// page would (out of session: the last completed session) and B's detector
// lib/ta/fairValueGaps.ts at its defaults (unfilled, ≥ 0.5 × ATR(14), 250 bars),
// on the same closed bars. Then, per stock:
//   - unfilled gaps: how many, and how many within the zones' ±WINDOW_PCT
//   - each gap in the window against the qualifying zones (all of them, and the
//     ones the card shows): overlapping, within 1 × ATR(14), or near none
//   - (a) STRENGTHEN ONLY: the shown zones a gap overlaps or sits within 1 ATR
//     of (what would gain a member; the card's zones don't change)
//   - (b) GAPS AS ZONES: a gap in the window near no qualifying zone becomes a
//     zone of its own; the card's nearest SHOWN above and below are re-picked
//     with those included, and how often that changes what is shown
//   - crowding by market cap (price × SEC cover-page shares, as Pickers shows
//     it): small < $2B, mid $2–10B, large > $10B, and no cap on file; and by
//     liquidity (the 50-session average of close × volume): thin < $10M a day,
//     mid $10–100M, deep > $100M, since SEC caps exist only for Pickers rows
//
// UNIVERSE=tiingo runs over the whole stored Tiingo universe instead of the
// Pickers list (the Pickers universe is nearly all large caps).
//
// MA50 and MA200 are the page's (simple averages of the closes); the macro
// support zone is the page's own computeMacroSupport, lifted from
// StockSymbolPageClient.tsx, not re-derived (as scripts/confluence-census.mjs).
//
// READ-ONLY, ENFORCED: any Upstash command outside READ_VERBS is refused
// before it is sent. PUBLIC LOG (#553): counts, percentages and parameters
// only. No price, bar, cap or other Tiingo value is printed.
//
//   node scripts/fvg-zones-census.mjs      (relay: write-fvg-zones-census)
//   UNIVERSE=tiingo node scripts/fvg-zones-census.mjs   (relay: write-fvg-zones-census-tiingo)
//   FIXTURE=1 node scripts/fvg-zones-census.mjs   (synthetic bars, no Redis)
import fs from "node:fs";
import { register } from "node:module";
import ts from "typescript";
import { grabFunction } from "./lib/earnings-plan.mjs";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/next-server-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);

const FIXTURE = process.env.FIXTURE === "1";
if (!FIXTURE && (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN)) {
  console.error("FATAL: needs the Upstash credentials (write- relay job).");
  process.exit(2);
}
const READ_VERBS = new Set(["GET", "MGET", "HMGET"]);
const UPSTASH = (process.env.UPSTASH_REDIS_REST_URL ?? "https://fixture.invalid").replace(/\/$/, "");
let commands = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    for (const c of cmds) if (!READ_VERBS.has(String(c?.[0] ?? "").toUpperCase())) throw new Error(`census is read-only: refused ${c?.[0]}`);
    commands += cmds.length || 1;
  }
  return realFetch(input, init);
};

const redis = FIXTURE ? null : (await import("@upstash/redis")).Redis.fromEnv();
const C = await import("../lib/ta/confluence.ts");
const F = await import("../lib/ta/fairValueGaps.ts");
const { closedBars } = await import("../lib/ta/keyLevels.ts");
const { tiingoEodKey, TIINGO_UNIVERSE_KEY } = await import("../lib/server/marketData/keys.ts");
const { parseTiingoUniverse } = await import("../lib/server/tiingoUniverse.ts");
const TIINGO = process.env.UNIVERSE === "tiingo";
const { eodBarsToPoints } = await import("../lib/server/marketData/pickerHistory.ts");
const { PICKERS_SYMBOLS_KEY } = await import("../lib/server/pickersBuilder.ts");
const { toDashed } = await import("../lib/symbolSpellings.mjs");

// The page's macro support, lifted.
const page = fs.readFileSync("app/stock/[symbol]/StockSymbolPageClient.tsx", "utf8");
const lifted = ["avg", "aggregateWeekly", "computeMacroSupport"].map((n) => grabFunction(page, n)).join("\n") + "\nexport { computeMacroSupport };\n";
const tmp = `scripts/.fvg-zones-census-${process.pid}.mjs`;
fs.writeFileSync(tmp, ts.transpileModule(lifted, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
let computeMacroSupport;
try { ({ computeMacroSupport } = await import(`${process.cwd()}/${tmp}`)); } finally { fs.rmSync(tmp, { force: true }); }

const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
// Synthetic bars with jumps, so the fixture has gaps to find.
function fixtureBars(seed) {
  const out = [];
  let lvl = 20 + seed * 7;
  for (let t = Date.parse("2024-10-01T00:00:00Z"), i = 0; t <= Date.parse("2026-10-02T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    if (i % (37 + seed * 5) === 0 && i) lvl *= i % 2 ? 1.06 : 0.95;
    const b = lvl * (1 + 0.12 * Math.sin(i / (11 + seed)) + 0.04 * Math.sin(i / 4.1));
    out.push([d.toISOString().slice(0, 10), b, b * 1.012, b * 0.988, b * 1.003, 1e6]);
    i++;
  }
  return { bars: out };
}
const listed = FIXTURE ? ["F1", "F2", "F3", "F4", "F5"]
  : TIINGO ? (parseTiingoUniverse(await redis.get(TIINGO_UNIVERSE_KEY))?.symbols ?? []).filter((s) => s !== "SPY")
  : parse(await redis.get(PICKERS_SYMBOLS_KEY));
const universe = Array.isArray(listed) ? listed.map((s) => String(s).trim().toUpperCase()).filter(Boolean) : [];
if (!universe.length) { console.error("FATAL: no Pickers symbol list."); process.exit(1); }
const raw = [];
if (FIXTURE) universe.forEach((_, i) => raw.push(fixtureBars(i + 1)));
else for (let i = 0; i < universe.length; i += 25) raw.push(...(await redis.mget(...universe.slice(i, i + 25).map((s) => tiingoEodKey(toDashed(s))))));

// Market cap as Pickers shows it: price × SEC cover-page shares (1 HMGET).
const caps = new Map();
if (!FIXTURE) {
  const P = await import("../lib/server/pickersSecFundamentals.ts");
  const V = await import("../lib/server/secValuation.ts");
  const rows = await P.readSecPickerRows(universe);
  caps.set("__rows", rows);
  caps.set("__mc", (s, price) => {
    const row = rows.get(s);
    if (!row) return null;
    const fig = V.marketCap({ shares: row.inputs.shares, eps: null, refusals: row.inputs.refusals }, price);
    return fig?.ok ? fig.val : null;
  });
}
const capOf = (s, price) => (FIXTURE ? [1e9, 5e9, 5e10, null, 1e9][Number(s.slice(1)) - 1] : caps.get("__mc")(s, price));
const tierOf = (cap) => (cap === null || cap === undefined ? "no cap" : cap < 2e9 ? "small" : cap <= 1e10 ? "mid" : "large");

const sma = (v, n) => (v.length >= n ? v.slice(-n).reduce((s, x) => s + x, 0) / n : null);
const median = (v) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (n, d) => (d ? `${(n / d * 100).toFixed(1)}%` : "—");
const q = (v, p) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const stocks = [];
universe.forEach((s, i) => {
  const e = parse(raw[i]);
  const bars = e && Array.isArray(e.bars) ? eodBarsToPoints(e.bars) : [];
  if (bars.length >= 60) stocks.push({ s, bars });
});
console.log(`universe ${universe.length} · with ≥60 daily bars ${stocks.length} · Redis commands so far ${commands}`);
console.log(`gap rule: unfilled, ≥ ${F.FVG_DEFAULTS.minAtr} × ATR(14), last ${F.FVG_DEFAULTS.lookback} bars · zones: k=${C.K_ATR} × ATR(14), ≥${C.ZONE_MIN} members, ±${C.WINDOW_PCT}% window, ${C.SHOWN} shown a side · near = within 1 × ATR(14)`);

// Distance between a gap and a zone, in dollars (0 when they overlap).
const apart = (g, z) => Math.max(z.lo - g.upper, g.lower - z.hi, 0);
const overlaps = (g, z) => g.lower <= z.hi && g.upper >= z.lo;

const T = { measured: 0, noAtr: 0, withGap: 0, withGapWin: 0 };
const gapsAll = [], gapsWin = [], gapsChart = [];
const vsAll = { overlap: 0, near: 0, none: 0 }, vsShown = { overlap: 0, near: 0, none: 0 };
let shownZones = 0, strengthened = 0, strengthenedOverlap = 0, stocksStrengthened = 0;
let changedB = 0, noneTodayGetsOne = 0, nearestChanged = 0, slots = 0, gapSlots = 0;
const newZonesB = [], within10Before = [], within10After = [];
const tiers = {}, liq = {};
const liqOf = (bars) => { const t = bars.slice(-50); const v = t.reduce((a, b) => a + b.close * (b.volume ?? 0), 0) / (t.length || 1); return v < 1e7 ? "thin" : v <= 1e8 ? "mid" : "deep"; };
const tierOf2 = (t, into = tiers) => (into[t] ??= { n: 0, gapsWin: [], newB: [], changedB: 0, gapSlots: 0, slots: 0, strengthened: 0, shown: 0 });

for (const { s, bars } of stocks) {
  const closes = bars.map((b) => b.close);
  const m = computeMacroSupport(bars, closes[closes.length - 1]);
  const c = C.confluence({ bars, ma50: sma(closes, 50), ma200: sma(closes, 200), macro: m ? { lower: m.lower, upper: m.upper } : null });
  if (c.atr === null || c.price === null) { T.noAtr++; continue; }
  T.measured++;
  const price = c.price, atr = c.atr;
  const tierCap = tierOf2(tierOf(capOf(s, price))), tierLiq = tierOf2(liqOf(bars), liq);
  tierCap.n++; tierLiq.n++;
  // One tally, both groupings.
  const each = (f) => { f(tierCap); f(tierLiq); };

  const closed = closedBars(bars).map((b) => ({ date: b.date, high: b.high, low: b.low, close: b.close }));
  const gaps = F.fairValueGaps(closed);
  const win = gaps.filter((g) => F.gapDistance(g, price) * 100 <= C.WINDOW_PCT);
  gapsAll.push(gaps.length); gapsWin.push(win.length); gapsChart.push(F.nearestGaps(gaps, price).length);
  each((t) => t.gapsWin.push(win.length));
  if (gaps.length) T.withGap++;
  if (win.length) T.withGapWin++;

  const zones = C.allZones(c.levels, c.band, price);
  const shown = [...c.above, ...c.below, ...(c.inside ? [c.inside] : [])];

  // Each gap in the window, against every qualifying zone and against the shown ones.
  for (const g of win) {
    const tally = (zs, t) => { if (zs.some((z) => overlaps(g, z))) t.overlap++; else if (zs.some((z) => apart(g, z) <= atr)) t.near++; else t.none++; };
    tally(zones, vsAll); tally(shown, vsShown);
  }

  // (a) STRENGTHEN ONLY: shown zones that a gap overlaps or sits within 1 ATR of.
  let st = 0;
  for (const z of shown) {
    shownZones++; each((t) => t.shown++);
    if (win.some((g) => apart(g, z) <= atr)) { strengthened++; st++; each((t) => t.strengthened++); }
    if (win.some((g) => overlaps(g, z))) strengthenedOverlap++;
  }
  if (st) stocksStrengthened++;

  // (b) GAPS AS ZONES: a gap near no qualifying zone is a zone of its own; re-pick the shown ones.
  const lone = win.filter((g) => !zones.some((z) => apart(g, z) <= atr)).map((g) => ({ lo: g.lower, hi: g.upper, gap: true }));
  newZonesB.push(lone.length); each((t) => t.newB.push(lone.length));
  const both = [...zones.map((z) => ({ lo: z.lo, hi: z.hi, gap: false })), ...lone];
  const above = both.filter((z) => z.lo > price).sort((x, y) => x.lo - y.lo).slice(0, C.SHOWN);
  const below = both.filter((z) => z.hi < price).sort((x, y) => y.hi - x.hi).slice(0, C.SHOWN);
  const after = [...above, ...below];
  const key = (zs) => zs.map((z) => `${z.lo}:${z.hi}`).sort().join("|");
  const before = [...c.above, ...c.below];
  if (key(before) !== key(after)) { changedB++; each((t) => t.changedB++); }
  if (!shown.length && after.length) noneTodayGetsOne++;
  if ((above[0]?.gap) || (below[0]?.gap)) nearestChanged++;
  slots += after.length; gapSlots += after.filter((z) => z.gap).length;
  each((t) => { t.slots += after.length; t.gapSlots += after.filter((z) => z.gap).length; });
  const in10 = (z) => Math.min(Math.abs(z.lo - price), Math.abs(z.hi - price)) / price <= 0.10;
  within10Before.push(zones.filter(in10).length); within10After.push(both.filter(in10).length);
}

const nGapWin = vsAll.overlap + vsAll.near + vsAll.none;
console.log(`\nstocks measured ${T.measured} (no ATR ${T.noAtr})`);
console.log(`\nUNFILLED GAPS`);
console.log(`  stocks with ≥1 unfilled gap: ${pct(T.withGap, T.measured)} · with ≥1 within ±${C.WINDOW_PCT}%: ${pct(T.withGapWin, T.measured)}`);
console.log(`  per stock: all median ${median(gapsAll)} (p75 ${q(gapsAll, 0.75)}, p90 ${q(gapsAll, 0.9)}) · in the window median ${median(gapsWin)} (p90 ${q(gapsWin, 0.9)}) · drawn on the chart (2 a side) median ${median(gapsChart)}`);
console.log(`\nEACH GAP IN THE WINDOW (${nGapWin} gaps)`);
console.log(`  vs every qualifying zone: overlaps ${pct(vsAll.overlap, nGapWin)} · within 1 ATR ${pct(vsAll.near, nGapWin)} · near none ${pct(vsAll.none, nGapWin)}`);
console.log(`  vs the zones the card shows: overlaps ${pct(vsShown.overlap, nGapWin)} · within 1 ATR ${pct(vsShown.near, nGapWin)} · near none ${pct(vsShown.none, nGapWin)}`);
console.log(`\n(a) STRENGTHEN ONLY`);
console.log(`  shown zones ${shownZones}: with a gap overlapping or within 1 ATR ${pct(strengthened, shownZones)} (overlapping only ${pct(strengthenedOverlap, shownZones)})`);
console.log(`  stocks with ≥1 shown zone strengthened: ${pct(stocksStrengthened, T.measured)} · the card's zones themselves: unchanged`);
console.log(`\n(b) GAPS AS ZONES OF THEIR OWN`);
console.log(`  new gap-zones per stock: median ${median(newZonesB)} (p75 ${q(newZonesB, 0.75)}, p90 ${q(newZonesB, 0.9)})`);
console.log(`  the shown zones change on ${pct(changedB, T.measured)} of stocks · the nearest zone above or below becomes a gap on ${pct(nearestChanged, T.measured)}`);
console.log(`  shown slots taken by a gap-zone: ${pct(gapSlots, slots)} · stocks with no zone today that would get one: ${noneTodayGetsOne}`);
console.log(`  zones within ±10% of the price: median ${median(within10Before)} → ${median(within10After)} (p90 ${q(within10Before, 0.9)} → ${q(within10After, 0.9)})`);
const groups = [["BY MARKET CAP (crowding)", tiers, ["small", "mid", "large", "no cap"]], ["BY LIQUIDITY, 50-session average close × volume (crowding)", liq, ["thin", "mid", "deep"]]];
for (const [title, into, names] of groups) {
console.log(`\n${title}`);
for (const t of names) {
  const x = into[t];
  if (!x) { console.log(`  ${t}: none`); continue; }
  console.log(`  ${t} (${x.n}): gaps in the window median ${median(x.gapsWin)} (p90 ${q(x.gapsWin, 0.9)}) · (a) shown zones strengthened ${pct(x.strengthened, x.shown)} · (b) new gap-zones median ${median(x.newB)} (p90 ${q(x.newB, 0.9)}), shown zones change ${pct(x.changedB, x.n)}, slots taken by gaps ${pct(x.gapSlots, x.slots)}`);
}
}
console.log(`\nRedis commands ${commands} (read-only: ${[...READ_VERBS].join("/")})`);
