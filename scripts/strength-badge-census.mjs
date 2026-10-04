// THE STRENGTH BADGE, MEASURED BEFORE IT IS BUILT (#563 COWORK #99 §5).
//
// Over the Tiingo universe's stored daily bars (msh:tiingo:eod:v2), scores a
// DRAFT of the badge's published rule for every symbol on each of the last 60
// sessions, then reports:
//   - the five words' share on the latest session (none near-empty, none swamping)
//   - how often a symbol's word changes day to day, with and without hysteresis
//
// THE DRAFT RULE (points per input, fixed cut-offs; for the ruling, not final):
//   Trend score   checks passed (close > MA50, close > MA200, MA50 > MA200):
//                 0 → −2, 1 → −1, 2 → +1, 3 → +2
//   3-month RS    the stock's 63-session return minus SPY's: > +5 points → +1, < −5 → −1, else 0
//   12-month RS   the same over 252 sessions, at ±10 points
//   RSI(14)       stretched pulls toward Neutral: ≥ 70 with a positive total → −1,
//                 ≤ 30 with a negative total → +1, else 0
//   Earnings      (A's score: Good +1, Mixed 0, Weak −1) NOT IN THIS CENSUS: it
//                 needs each symbol's stored SEC set; it changes quarterly, so it
//                 moves the distribution a little and the flip rate hardly at all
//   Words         total ≥ 3 Strong · 1–2 Firm · 0 Neutral · −1 to −2 Soft · ≤ −3 Weak
//   Missing       an input with too little history is left out; fewer than 2
//                 inputs → "Not enough data"
//
// READ-ONLY, ENFORCED: any Upstash command outside GET/MGET is refused before
// it is sent. PUBLIC LOG (#553): counts and percentages only, never a price,
// bar or symbol-level value.
//
//   node scripts/strength-badge-census.mjs     (relay: write-strength-badge-census)
//   FIXTURE=1 node scripts/strength-badge-census.mjs
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

const SESSIONS = 60;
const WORDS = ["Strong", "Firm", "Neutral", "Soft", "Weak"];
const word = (t) => (t >= 3 ? "Strong" : t >= 1 ? "Firm" : t === 0 ? "Neutral" : t >= -2 ? "Soft" : "Weak");

const redis = FIXTURE ? null : (await import("@upstash/redis")).Redis.fromEnv();
const { tiingoEodKey, TIINGO_UNIVERSE_KEY } = await import("../lib/server/marketData/keys.ts");
const { parseTiingoUniverse } = await import("../lib/server/tiingoUniverse.ts");
const { toDashed } = await import("../lib/symbolSpellings.mjs");
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);

function fixtureBars(seed) {
  const out = [];
  for (let t = Date.parse("2024-06-03T00:00:00Z"), i = 0; t <= Date.parse("2026-10-02T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const c = 100 + 20 * Math.sin(i / (30 + seed)) + i * 0.02 * ((seed % 5) - 2) + 3 * Math.sin(i / 3 + seed);
    out.push([d.toISOString().slice(0, 10), c, c * 1.01, c * 0.99, c, 1e6]);
    i++;
  }
  return out;
}

const stored = FIXTURE ? { symbols: [...Array.from({ length: 60 }, (_, i) => `F${i}`), "SPY"] } : parseTiingoUniverse(await redis.get(TIINGO_UNIVERSE_KEY));
if (!stored) { console.error("FATAL: no Tiingo universe stored."); process.exit(1); }
const symbols = [...new Set([...stored.symbols, "SPY"])];
async function rows(list) {
  if (FIXTURE) return list.map((s) => ({ bars: s === "SPY" ? fixtureBars(7) : fixtureBars(Number(s.slice(1)) + 1) }));
  const out = [];
  for (let i = 0; i < list.length; i += 25) out.push(...(await redis.mget(...list.slice(i, i + 25).map((s) => tiingoEodKey(toDashed(s))))));
  return out.map(parse);
}

const [spyRow] = await rows(["SPY"]);
const spy = spyRow?.bars;
if (!spy?.length) { console.error("FATAL: no SPY bars."); process.exit(1); }
const spyAt = new Map(spy.map((b, i) => [b[0], i]));
const sc = spy.map((b) => b[4]);
const days = spy.slice(-SESSIONS).map((b) => b[0]);

const sma = (c, i, n) => { if (i + 1 < n) return null; let s = 0; for (let q = i - n + 1; q <= i; q++) s += c[q]; return s / n; };
function rsiSeries(c, n = 14) {
  const out = new Array(c.length).fill(null);
  if (c.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

/** The draft rule for one session; null for "Not enough data". */
function score(c, i, rsi, spyIdx) {
  let total = 0, inputs = 0;
  const m50 = sma(c, i, 50), m200 = sma(c, i, 200);
  if (m50 !== null && m200 !== null) {
    const passed = (c[i] > m50) + (c[i] > m200) + (m50 > m200);
    total += [-2, -1, 1, 2][passed]; inputs++;
  }
  for (const [n, cut] of [[63, 5], [252, 10]]) {
    if (i >= n && spyIdx >= n) {
      const rs = ((c[i] / c[i - n]) - (sc[spyIdx] / sc[spyIdx - n])) * 100;
      total += rs > cut ? 1 : rs < -cut ? -1 : 0; inputs++;
    }
  }
  if (rsi[i] !== null) {
    inputs++;
    if (rsi[i] >= 70 && total > 0) total -= 1;
    else if (rsi[i] <= 30 && total < 0) total += 1;
  }
  return inputs >= 2 ? total : null;
}

const latest = Object.fromEntries([...WORDS, "Not enough data"].map((w) => [w, 0]));
const flips = { none: [], hold2: [], hold3: [] };
const totals = new Map();
let read = 0, scored = 0;
for (let i = 0; i < symbols.length; i += 250) {
  for (const row of await rows(symbols.slice(i, i + 250))) {
    const b = row?.bars;
    if (!Array.isArray(b) || b.length < 30) continue;
    read++;
    const c = b.map((x) => x[4]), rsi = rsiSeries(c), at = new Map(b.map((x, k) => [x[0], k]));
    const seq = days.map((d) => { const k = at.get(d), s = spyAt.get(d); return k === undefined || s === undefined ? undefined : score(c, k, rsi, s); });
    const last = seq[seq.length - 1];
    latest[last === undefined || last === null ? "Not enough data" : word(last)]++;
    if (typeof last === "number") totals.set(last, (totals.get(last) ?? 0) + 1);
    const ws = seq.filter((x) => typeof x === "number").map(word);
    if (ws.length < SESSIONS * 0.9) continue;
    scored++;
    const count = (hold) => {
      let shown = ws[0], cand = null, run = 0, n = 0;
      for (const w of ws.slice(1)) {
        if (w === shown) { cand = null; run = 0; continue; }
        if (w === cand) run++; else { cand = w; run = 1; }
        if (run >= hold) { shown = w; n++; cand = null; run = 0; }
      }
      return n;
    };
    flips.none.push(count(1)); flips.hold2.push(count(2)); flips.hold3.push(count(3));
  }
}

const pct = (x, n) => `${((x / Math.max(1, n)) * 100).toFixed(1)}%`;
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const mean = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : "—");
console.log(`universe ${symbols.length} · with bars ${read} · scored over ${SESSIONS} sessions ${scored} · window ${days[0]} → ${days[days.length - 1]} · Redis commands ${commands}`);
console.log("\n=== The latest session: each word's share ===");
const n = Object.values(latest).reduce((a, b) => a + b, 0);
for (const [w, c] of Object.entries(latest)) console.log(`  ${w.padEnd(16)} ${String(c).padStart(5)}  ${pct(c, n)}`);
console.log(`  totals: ${[...totals.entries()].sort((a, b) => a[0] - b[0]).map(([t, c]) => `${t >= 0 ? "+" : ""}${t}: ${c}`).join(" · ")}`);
console.log(`\n=== Word changes per symbol over ${SESSIONS} sessions (${scored} symbols) ===`);
for (const [k, a] of Object.entries(flips)) {
  const label = k === "none" ? "no hysteresis" : `hold ${k.slice(4)} sessions`;
  console.log(`  ${label.padEnd(16)} median ${med(a)} · mean ${mean(a)} · ≥ 6 changes ${pct(a.filter((x) => x >= 6).length, a.length)} · ≥ 10 ${pct(a.filter((x) => x >= 10).length, a.length)} · none ${pct(a.filter((x) => x === 0).length, a.length)}`);
}
console.log(`\nRedis commands ${commands} (GET/MGET only)`);
