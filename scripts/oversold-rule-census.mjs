// OVERSOLD / OVERBOUGHT, OLD RULE VS NEW, MEASURED (#553 COWORK #168).
//
// For the pickers universe's stored Tiingo bars, on each of the last 20
// sessions (the bars cut at that session): the composite as the builder
// computes it, then
//   old  any 2 of the 6 checks, more on this side than the other;
//   new  RSI(14) one of them (<= 30 oversold, >= 70 overbought), plus at least
//        one more, more on this side than the other.
// Also Sell Signals, which counts overbought: old vs new, from overbought,
// below MA50 and below MA200 (the two bearish divergences are not recomputed
// per session here, so these counts are a floor; they are the same in both
// columns, so the DIFFERENCE is exact). Buy Signals does not depend on the
// oversold flag (getBuySignalCount is > 0 exactly when above MA200), so it is
// unchanged by construction.
//
// READ-ONLY, ENFORCED. PUBLIC LOG (#553): counts, %, dates and symbols only.
//
//   node scripts/oversold-rule-census.mjs     (relay: write-oversold-rule-census)
import { register } from "node:module";
register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/next-server-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }
const READ_VERBS = new Set(["GET", "MGET"]);
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
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
const redis = (await import("@upstash/redis")).Redis.fromEnv();
const { tiingoEodKey } = await import("../lib/server/marketData/keys.ts");
const { PICKERS_SYMBOLS_KEY, compositeGate, compositeForStudy } = await import("../lib/server/pickersBuilder.ts");
const { toDashed } = await import("../lib/symbolSpellings.mjs");
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const SESSIONS = Number(process.env.SESSIONS || 20);

let universe = parse(await redis.get(PICKERS_SYMBOLS_KEY));
universe = [...new Set((Array.isArray(universe) ? universe : []).map((s) => String(s).trim().toUpperCase()).filter(Boolean))];

const ma = (closes, n) => (closes.length >= n ? closes.slice(-n).reduce((a, b) => a + b, 0) / n : null);
const perDay = new Map(); // date -> counters
const bump = (d, k, sym) => { const r = perDay.get(d) ?? { osOld: 0, osNew: 0, obOld: 0, obNew: 0, sellOld: 0, sellNew: 0, n: 0, dropped: [] }; r[k]++; if (sym) r.dropped.push(sym); perDay.set(d, r); };
let withBars = 0;
for (let i = 0; i < universe.length; i += 10) {
  const chunk = universe.slice(i, i + 10);
  const vals = await redis.mget(...chunk.map((s) => tiingoEodKey(toDashed(s))));
  chunk.forEach((sym, k) => {
    const e = parse(vals[k]);
    const bars = e && Array.isArray(e.bars) ? e.bars : [];
    if (bars.length < 60 + SESSIONS) return;
    withBars++;
    const pts = bars.map((b) => ({ date: b[0], open: b[1], high: b[2], low: b[3], close: b[4], volume: b[5] }));
    for (let back = 0; back < SESSIONS; back++) {
      const cut = pts.slice(0, pts.length - back);
      const d = cut[cut.length - 1].date;
      const c = compositeForStudy(cut);
      bump(d, "n");
      if (!c) continue;
      const osOld = compositeGate(c, "oversold", "any-two"), osNew = compositeGate(c, "oversold");
      const obOld = compositeGate(c, "overbought", "any-two"), obNew = compositeGate(c, "overbought");
      if (osOld) bump(d, "osOld");
      if (osNew) bump(d, "osNew");
      if (obOld) bump(d, "obOld");
      if (obNew) bump(d, "obNew");
      const closes = cut.map((p) => p.close);
      const last = closes[closes.length - 1], m50 = ma(closes, 50), m200 = ma(closes, 200);
      const below = (m50 !== null && last < m50) || (m200 !== null && last < m200);
      if (obOld || below) bump(d, "sellOld");
      if (obNew || below) bump(d, "sellNew");
      if (back === 0 && osOld && !osNew) perDay.get(d).dropped.push(sym);
    }
  });
}
const days = [...perDay.keys()].sort().slice(-SESSIONS);
const stat = (k) => {
  const xs = days.map((d) => perDay.get(d)[k]).sort((a, b) => a - b);
  const q = (p) => xs[Math.min(xs.length - 1, Math.floor(p * (xs.length - 1)))];
  return { median: q(0.5), p90: q(0.9), max: xs[xs.length - 1] };
};
console.log(`universe ${universe.length} · with >= ${60 + SESSIONS} stored bars ${withBars} · sessions ${days[0]} → ${days[days.length - 1]}`);
console.log(`\ndate        |  oversold old → new  | overbought old → new | sell signals* old → new`);
for (const d of days) {
  const r = perDay.get(d);
  console.log(`${d}  |  ${String(r.osOld).padStart(4)} → ${String(r.osNew).padEnd(4)}       |  ${String(r.obOld).padStart(4)} → ${String(r.obNew).padEnd(4)}       |  ${String(r.sellOld).padStart(4)} → ${r.sellNew}`);
}
for (const [label, a, b] of [["Oversold", "osOld", "osNew"], ["Overbought", "obOld", "obNew"], ["Sell Signals*", "sellOld", "sellNew"]]) {
  const o = stat(a), n = stat(b);
  console.log(`\n${label}: old median ${o.median} / p90 ${o.p90} / max ${o.max}  →  new median ${n.median} / p90 ${n.p90} / max ${n.max}  (of ${withBars}; new median ${((n.median / withBars) * 100).toFixed(1)}%)`);
}
const today = perDay.get(days[days.length - 1]);
console.log(`\nlatest session ${days[days.length - 1]}: oversold old ${today.osOld} → new ${today.osNew}; overbought old ${today.obOld} → new ${today.obNew}`);
console.log(`left Oversold on the latest session (old in, new out), first 20: ${today.dropped.slice(0, 20).join(", ") || "none"}`);
console.log(`\n* Sell Signals from overbought / below MA50 / below MA200 only; the bearish divergences are not recomputed per session, so both columns are a floor and the change is exact.`);
console.log(`Buy Signals: unchanged by construction (> 0 exactly when above MA200; the oversold flag only adds to the score).`);
console.log(`\nRedis commands ${commands} (read-only: ${[...READ_VERBS].join(", ")})`);
