// MARKET MOOD, MEASURED BEFORE IT IS BUILT (#563 COWORK #95 step 1).
//
// The owner's own fear ↔ greed reading, "Market Mood", from the same kinds of
// inputs CNN's index uses, computed over a year of the Tiingo daily bars we
// already store (msh:tiingo:eod:v2). Nothing is built or stored; this answers
// whether each input is computable and whether the blend reads fear at lows
// and greed at highs.
//
//   1 momentum      SPY's close vs its 125-day average
//   2 strength      net 52-week highs minus lows across the stock universe (% of names)
//   3 breadth       up-volume vs down-volume, a McClellan-style summation
//   4 put/call      NOT COMPUTED: Cboe's terms bar storing or redistributing it
//   5 volatility    SPY's 20-day realised volatility vs its 50-day average (inverted),
//                   standing in for VIX (Cboe copyright; see the report)
//   6 safe haven    SPY's 20-day return minus a Treasury ETF's (IEF if stored, else TLT)
//   7 junk bonds    HYG's 20-day return minus LQD's (only if LQD is stored)
//
// Each input is scored 0–100 as its percentile over the trailing 252 sessions;
// the reading is the equal-weight average of the inputs available that day,
// shown only when at least MIN_INPUTS are.
//
// READ-ONLY, ENFORCED: any Upstash command outside GET/MGET is refused before
// it is sent. PUBLIC LOG (#553): dates, counts and 0–100 scores only. No price,
// bar, volume or other Tiingo value is printed.
//
//   node scripts/market-mood-census.mjs        (relay: write-market-mood-census)
//   FIXTURE=1 node scripts/market-mood-census.mjs   (synthetic bars, no Redis)
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

const WINDOW = 252, READINGS = 252, MIN_INPUTS = 5, MIN_PCTL = 200;
const LABELS = [[24, "Extreme fear"], [44, "Fear"], [55, "Neutral"], [75, "Greed"], [100, "Extreme greed"]];
const label = (s) => LABELS.find(([hi]) => s <= hi)[1];
const BONDS = ["IEF", "TLT", "LQD", "HYG", "AGG", "BND", "JNK", "VCIT", "SHY"];

const redis = FIXTURE ? null : (await import("@upstash/redis")).Redis.fromEnv();
const { tiingoEodKey, TIINGO_UNIVERSE_KEY } = await import("../lib/server/marketData/keys.ts");
const { parseTiingoUniverse } = await import("../lib/server/tiingoUniverse.ts");
const { uniqueEtfs } = await import("../lib/curatedSymbols.ts");
const { toDashed } = await import("../lib/symbolSpellings.mjs");
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);

// ── fixtures: weekdays to Fri 2 Oct 2026, a market wave with a spring low and a summer high ──
function fixtureBars(seed, kind = "stock") {
  const out = [];
  for (let t = Date.parse("2023-01-02T00:00:00Z"), i = 0; t <= Date.parse("2026-10-02T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const mkt = 100 + i * 0.05 + 12 * Math.sin(i / 60) + 6 * Math.sin(i / 13);
    const c = kind === "bond" ? 100 - 4 * Math.sin(i / 60) + Math.sin(i / 9 + seed) : mkt * (0.6 + seed / 50) + 3 * Math.sin(i / (7 + seed));
    out.push([d.toISOString().slice(0, 10), c, c * 1.01, c * 0.99, c, 1e6 * (1 + (i % 7) / 10)]);
    i++;
  }
  return { bars: out };
}

// ── the read ────────────────────────────────────────────────────────────────
const stored = FIXTURE ? { symbols: [...Array.from({ length: 120 }, (_, i) => `F${i}`), "SPY", "TLT", "HYG"] } : parseTiingoUniverse(await redis.get(TIINGO_UNIVERSE_KEY));
if (!stored) { console.error("FATAL: no Tiingo universe stored."); process.exit(1); }
const symbols = [...new Set([...stored.symbols.map((s) => String(s).toUpperCase()), "SPY", ...BONDS])];
const etfs = new Set([...uniqueEtfs, ...BONDS]);
const get = async (list) => {
  if (FIXTURE) return list.map((s) => (s === "SPY" ? fixtureBars(10) : ["TLT", "IEF"].includes(s) ? fixtureBars(1, "bond") : s === "HYG" ? fixtureBars(3) : s.startsWith("F") ? fixtureBars(Number(s.slice(1))) : null));
  const out = [];
  for (let i = 0; i < list.length; i += 25) out.push(...(await redis.mget(...list.slice(i, i + 25).map((s) => tiingoEodKey(toDashed(s))))));
  return out.map(parse);
};

// SPY first: its sessions are the calendar.
const [spyRow] = await get(["SPY"]);
if (!spyRow?.bars?.length) { console.error("FATAL: no SPY bars."); process.exit(1); }
const spy = spyRow.bars;
const dates = spy.map((b) => b[0]);
const SPAN = Math.min(dates.length - 1, READINGS + WINDOW + 40);
const target = dates.slice(-SPAN);
const at = new Map(target.map((d, i) => [d, i]));
const H = new Float64Array(SPAN), L = new Float64Array(SPAN), E = new Float64Array(SPAN), UP = new Float64Array(SPAN), DN = new Float64Array(SPAN);

const series = new Map(); // the ETFs the inputs need: date → close
let names = 0, withYear = 0, missing = 0;
const stocks = symbols.filter((s) => !etfs.has(s));
const needEtf = ["SPY", ...BONDS];
for (const [s, row] of (await get(needEtf)).map((r, i) => [needEtf[i], r])) {
  if (row?.bars?.length) series.set(s, new Map(row.bars.map((b) => [b[0], b[4]])));
}
for (let i = 0; i < stocks.length; i += 250) {
  const rows = await get(stocks.slice(i, i + 250));
  for (const row of rows) {
    const b = row?.bars;
    if (!Array.isArray(b) || b.length < 30) { missing++; continue; }
    names++;
    if (b.length > WINDOW) withYear++;
    for (let k = 1; k < b.length; k++) {
      const j = at.get(b[k][0]);
      if (j === undefined) continue;
      const [, , hi, lo, c, v] = b[k], pc = b[k - 1][4];
      if (Number.isFinite(v) && v > 0 && Number.isFinite(c) && Number.isFinite(pc)) { if (c > pc) UP[j] += v; else if (c < pc) DN[j] += v; }
      if (k < WINDOW) continue;
      let mx = -Infinity, mn = Infinity;
      for (let q = k - WINDOW + 1; q <= k; q++) { if (b[q][2] > mx) mx = b[q][2]; if (b[q][3] < mn) mn = b[q][3]; }
      E[j]++;
      if (hi >= mx) H[j]++;
      if (lo <= mn) L[j]++;
    }
  }
}

// ── the inputs, by date ─────────────────────────────────────────────────────
const closeOf = (s) => { const m = series.get(s); return m ? target.map((d) => m.get(d) ?? NaN) : null; };
const sc = closeOf("SPY"), allSpy = spy.map((b) => b[4]), off = spy.length - SPAN;
const ret20 = (c) => c.map((x, i) => (i >= 20 && c[i - 20] > 0 ? x / c[i - 20] - 1 : NaN));
const inputs = {};
// 1 momentum
inputs.momentum = target.map((_, i) => { const g = off + i; if (g < 124) return NaN; let s = 0; for (let q = g - 124; q <= g; q++) s += allSpy[q]; return allSpy[g] / (s / 125) - 1; });
// 2 strength
inputs.strength = target.map((_, i) => (E[i] >= 100 ? (H[i] - L[i]) / E[i] : NaN));
// 3 breadth: ratio-adjusted (up − down) / (up + down), EMA19 − EMA39, summed
{
  let e19 = null, e39 = null, sum = 0;
  inputs.breadth = target.map((_, i) => {
    const t = UP[i] + DN[i];
    if (!(t > 0)) return NaN;
    const r = ((UP[i] - DN[i]) / t) * 1000;
    e19 = e19 === null ? r : e19 + 0.1 * (r - e19);
    e39 = e39 === null ? r : e39 + 0.05 * (r - e39);
    sum += e19 - e39;
    return i < 40 ? NaN : sum;
  });
}
// 5 volatility (inverted): realised 20-day vs its 50-day average
{
  const lr = allSpy.map((x, g) => (g ? Math.log(x / allSpy[g - 1]) : NaN));
  const rv = allSpy.map((_, g) => { if (g < 21) return NaN; const w = lr.slice(g - 19, g + 1), m = w.reduce((a, b) => a + b, 0) / 20; return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / 19); });
  inputs.volatility = target.map((_, i) => { const g = off + i; if (g < 71) return NaN; let s = 0; for (let q = g - 49; q <= g; q++) s += rv[q]; return -(rv[g] / (s / 50) - 1); });
}
// 6 safe haven
const bond = series.has("IEF") ? "IEF" : series.has("TLT") ? "TLT" : null;
if (bond) { const a = ret20(sc), b = ret20(closeOf(bond)); inputs.safeHaven = a.map((x, i) => x - b[i]); }
// 7 junk
if (series.has("HYG") && series.has("LQD")) { const a = ret20(closeOf("HYG")), b = ret20(closeOf("LQD")); inputs.junk = a.map((x, i) => x - b[i]); }

// ── scores and readings ─────────────────────────────────────────────────────
const pctl = (v) => v.map((x, i) => {
  if (!Number.isFinite(x)) return NaN;
  const w = v.slice(Math.max(0, i - WINDOW + 1), i + 1).filter(Number.isFinite);
  if (w.length < MIN_PCTL) return NaN;
  return (100 * (w.filter((y) => y < x).length + 0.5 * (w.filter((y) => y === x).length - 1))) / (w.length - 1);
});
const scores = Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, pctl(v)]));
const keys = Object.keys(scores);
const reading = target.map((_, i) => { const xs = keys.map((k) => scores[k][i]).filter(Number.isFinite); return xs.length >= Math.min(MIN_INPUTS, keys.length) ? { v: xs.reduce((a, b) => a + b, 0) / xs.length, n: xs.length } : null; });
const last = target.length - 1, first = Math.max(0, target.length - READINGS);
const year = reading.slice(first).map((r, j) => ({ r, i: first + j })).filter((x) => x.r);

// ── report (dates and 0–100 scores only) ────────────────────────────────────
const r0 = (x) => (Number.isFinite(x) ? Math.round(x) : "—");
console.log(`universe ${symbols.length} · stocks read ${names} (with a year of bars ${withYear}) · no bars ${missing} · Redis commands ${commands}`);
console.log(`SPY sessions ${dates.length} · readings window ${target[first]} → ${target[last]}`);
console.log(`bond ETFs stored: ${BONDS.map((s) => `${s} ${series.has(s) ? "yes" : "no"}`).join(" · ")} · safe haven vs ${bond ?? "none"} · junk ${inputs.junk ? "HYG vs LQD" : "NOT computable (LQD not stored)"}`);
console.log(`\n=== Inputs: sessions with a score in the last ${READINGS} ===`);
for (const k of keys) console.log(`  ${k.padEnd(11)} ${scores[k].slice(first).filter(Number.isFinite).length}`);
console.log(`  put/call    not computed (terms)`);
const n = year.length;
console.log(`\n=== Readings: ${n} sessions with ≥${Math.min(MIN_INPUTS, keys.length)} of ${keys.length} inputs ===`);
const dist = Object.fromEntries(LABELS.map(([, l]) => [l, 0]));
year.forEach(({ r }) => dist[label(r.v)]++);
for (const [l, c] of Object.entries(dist)) console.log(`  ${l.padEnd(13)} ${String(c).padStart(4)}  ${n ? ((c / n) * 100).toFixed(0) : 0}%`);
const row = (tag, i) => console.log(`  ${tag.padEnd(26)} ${target[i]}  ${reading[i] ? `${r0(reading[i].v)} ${label(reading[i].v)} (${reading[i].n} inputs)` : "—"}  ·  ${keys.map((k) => `${k} ${r0(scores[k][i])}`).join(" · ")}`);
console.log("\n=== Dated examples ===");
const inMonth = (p) => target.map((d, i) => [d, i]).filter(([d]) => d.startsWith(p));
const aprLow = inMonth("2026-04").sort((a, b) => sc[a[1]] - sc[b[1]])[0];
if (aprLow) row("SPY's lowest close, Apr 2026", aprLow[1]);
if (at.has("2026-08-13")) row("SPY record close, 13 Aug", at.get("2026-08-13"));
const hiClose = target.map((d, i) => i).filter((i) => i >= first).sort((a, b) => sc[b] - sc[a])[0];
row("SPY's highest close (year)", hiClose);
const lowClose = target.map((d, i) => i).filter((i) => i >= first).sort((a, b) => sc[a] - sc[b])[0];
row("SPY's lowest close (year)", lowClose);
if (n) {
  const mn = year.reduce((a, b) => (b.r.v < a.r.v ? b : a)), mx = year.reduce((a, b) => (b.r.v > a.r.v ? b : a));
  row("lowest reading", mn.i);
  row("highest reading", mx.i);
}
row("latest", last);
console.log("\n=== Month ends ===");
for (const p of [...new Set(target.slice(first).map((d) => d.slice(0, 7)))]) { const m = inMonth(p); row(p, m[m.length - 1][1]); }
// Does it read fear near lows and greed near highs? Rank correlation with SPY's distance below its 52-week high.
{
  const xs = [], ys = [];
  for (const { r, i } of year) { const g = off + i; const hi = Math.max(...allSpy.slice(Math.max(0, g - WINDOW + 1), g + 1)); xs.push(r.v); ys.push(allSpy[g] / hi - 1); }
  const rank = (a) => { const o = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), out = new Array(a.length); o.forEach(([, i], k) => (out[i] = k)); return out; };
  const rx = rank(xs), ry = rank(ys), m = (xs.length - 1) / 2;
  const cov = rx.reduce((s, v, i) => s + (v - m) * (ry[i] - m), 0), vx = rx.reduce((s, v) => s + (v - m) ** 2, 0);
  console.log(`\nrank correlation, reading vs SPY's distance from its 52-week high: ${xs.length > 2 ? (cov / vx).toFixed(2) : "—"} (1 = fear exactly at the lows, greed at the highs)`);
}
console.log(`\nRedis commands ${commands} (GET/MGET only)`);
