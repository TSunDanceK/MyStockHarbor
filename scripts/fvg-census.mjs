// FAIR VALUE GAPS, MEASURED BEFORE THEY ARE DRAWN (#553 COWORK #140, step 1).
//
// Over the Tiingo universe's stored daily bars (msh:tiingo:eod:v2), runs
// lib/ta/fairValueGaps.ts as the chart would, for each minimum size
// {0.25, 0.5, 0.75} x ATR(14) and lookback {120, 250} bars:
//   - unfilled gaps per symbol: median, p75, p95 (and bullish / bearish medians)
//   - the share of symbols with >= 1 unfilled gap within +/-10% of the price
//   - the share with none at all (the chart's disabled toggle)
//   - what the nearest-2-above / 2-below cap would draw
// plus AAPL, NVDA and a small cap (the universe's lowest median dollar volume
// with a full lookback) at each setting.
//
// READ-ONLY, ENFORCED: any Upstash command outside READ_VERBS is refused
// before it is sent. PUBLIC LOG (#553): counts, percentages, dates, ATR
// multiples and parameters only. No price, bar or other Tiingo value is printed.
//
//   node scripts/fvg-census.mjs            (relay: write-fvg-census)
//   FIXTURE=1 node scripts/fvg-census.mjs  (synthetic bars, no Redis)
import { register } from "node:module";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/next-server-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);

const FIXTURE = process.env.FIXTURE === "1";
if (!FIXTURE && (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN)) {
  console.error("FATAL: needs the Upstash credentials (write- relay job).");
  process.exit(2);
}
const READ_VERBS = new Set(["GET", "MGET"]);
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
const F = await import("../lib/ta/fairValueGaps.ts");
const { tiingoEodKey, TIINGO_UNIVERSE_KEY } = await import("../lib/server/marketData/keys.ts");
const { eodBarsToPoints } = await import("../lib/server/marketData/pickerHistory.ts");
const { parseTiingoUniverse } = await import("../lib/server/tiingoUniverse.ts");
const { PICKERS_SYMBOLS_KEY } = await import("../lib/server/pickersBuilder.ts");
const { toDashed } = await import("../lib/symbolSpellings.mjs");

const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
function fixtureBars(seed) {
  const out = [];
  for (let t = Date.parse("2024-10-01T00:00:00Z"), i = 0; t <= Date.parse("2026-10-02T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const b = (20 + seed * 7) * (1 + 0.2 * Math.sin(i / (11 + seed)) + 0.07 * Math.sin(i / 4.1) + i * 0.0004) * (i % 37 === 0 ? 1.04 : 1);
    out.push([d.toISOString().slice(0, 10), b, b * 1.012, b * 0.988, b * 1.002, 1e6 * seed]);
    i++;
  }
  return { bars: out };
}

let universe = [];
let source = "fixture";
if (FIXTURE) universe = ["AAPL", "NVDA", "F3", "F4", "F5", "F6"];
else {
  universe = parseTiingoUniverse(await redis.get(TIINGO_UNIVERSE_KEY))?.symbols ?? [];
  source = "tiingo-universe";
  if (!universe.length) {
    const listed = parse(await redis.get(PICKERS_SYMBOLS_KEY));
    universe = Array.isArray(listed) ? listed : [];
    source = "pickers-symbols";
  }
}
universe = [...new Set(universe.map((s) => String(s).trim().toUpperCase()).filter(Boolean))];
if (!universe.length) { console.error("FATAL: no universe."); process.exit(1); }

const raw = [];
if (FIXTURE) universe.forEach((_, i) => raw.push(fixtureBars(i + 1)));
else for (let i = 0; i < universe.length; i += 10) raw.push(...(await redis.mget(...universe.slice(i, i + 10).map((s) => tiingoEodKey(toDashed(s))))));

const stocks = [];
universe.forEach((s, i) => {
  const e = parse(raw[i]);
  const bars = e && Array.isArray(e.bars) ? eodBarsToPoints(e.bars).filter((b) => b.high > 0 && b.low > 0 && b.close > 0) : [];
  if (bars.length >= 60) stocks.push({ s, bars });
});
console.log(`universe ${universe.length} (${source}) · with ≥60 daily bars ${stocks.length} · with ≥250 ${stocks.filter((x) => x.bars.length >= 250).length} · Redis commands ${commands}`);

const q = (v, p) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");
const fmtQ = (v) => `${q(v, 0.5)} / ${q(v, 0.75)} / ${q(v, 0.95)}`;

// The small cap: lowest median dollar volume over the last 60 bars, among symbols with a full 250-bar lookback.
const median = (v) => q(v, 0.5);
const full = stocks.filter((x) => x.bars.length >= 252 && !["AAPL", "NVDA"].includes(x.s));
const small = full.map((x) => ({ s: x.s, dv: median(x.bars.slice(-60).map((b) => b.close * (b.volume ?? 0))) })).filter((x) => x.dv > 0).sort((a, b) => a.dv - b.dv)[0]?.s ?? null;
const EXAMPLES = ["AAPL", "NVDA", ...(small ? [small] : [])];

function describe(g, price) {
  return `${g.kind === "bullish" ? "bull" : "bear"} ${g.date} ${(F.gapDistance(g, price) * 100).toFixed(1)}% ${g.lower > price ? "above" : "below"}, ${((g.upper - g.lower) / g.atr).toFixed(2)}×ATR`;
}

for (const lookback of [120, 250]) {
  for (const minAtr of [0.25, 0.5, 0.75]) {
    const all = [], bull = [], bear = [], shown = [];
    let near10 = 0, none = 0, counted = 0, noAtr = 0;
    for (const { bars } of stocks) {
      if (bars.length < Math.min(lookback, 60)) continue;
      if (F.atrSeries(bars).every((a) => a === null)) { noAtr++; continue; }
      counted++;
      const price = bars[bars.length - 1].close;
      const gaps = F.fairValueGaps(bars, { lookback, minAtr });
      all.push(gaps.length);
      bull.push(gaps.filter((g) => g.kind === "bullish").length);
      bear.push(gaps.filter((g) => g.kind === "bearish").length);
      shown.push(F.nearestGaps(gaps, price, 2).length);
      if (!gaps.length) none++;
      if (gaps.some((g) => F.gapDistance(g, price) <= 0.10)) near10++;
    }
    console.log(`\n── min ${minAtr}×ATR(14), lookback ${lookback} bars · ${counted} symbols${noAtr ? ` (${noAtr} without an ATR skipped)` : ""}`);
    console.log(`  unfilled per symbol, median / p75 / p95: ${fmtQ(all)}   (bullish ${fmtQ(bull)}; bearish ${fmtQ(bear)})`);
    console.log(`  ≥1 unfilled gap within ±10% of the price: ${pct(near10, counted)}   none at all: ${pct(none, counted)}`);
    console.log(`  drawn with the nearest 2 above + 2 below, median / p75 / p95: ${fmtQ(shown)}`);
    for (const s of EXAMPLES) {
      const x = stocks.find((t) => t.s === s);
      if (!x) { console.log(`  ${s}: no stored bars`); continue; }
      const price = x.bars[x.bars.length - 1].close;
      const gaps = F.fairValueGaps(x.bars, { lookback, minAtr });
      const near = F.nearestGaps(gaps, price, 2);
      console.log(`  ${s}${s === small ? " (small cap: lowest median dollar volume)" : ""}: ${gaps.length} unfilled (${gaps.filter((g) => g.kind === "bullish").length} bull, ${gaps.filter((g) => g.kind === "bearish").length} bear); drawn: ${near.length ? near.map((g) => describe(g, price)).join("; ") : "none"}`);
    }
  }
}
console.log(`\nRedis commands ${commands} (read-only: ${[...READ_VERBS].join(", ")})`);
