// THE STRETCH STUDY: z-score vs RSI, MEASURED BEFORE ANYTHING IS BUILT (#553 COWORK #141).
//
// Over the Tiingo universe's stored daily bars (msh:tiingo:eod:v2, up to ~5.5
// years), for every symbol and session:
//   z20 = (close - SMA20) / stdev(close, 20)    (population stdev of the 20 closes)
//   z50 = the same over 50 closes               (the variant)
//   RSI(14) = the stock page's own rsiWilder, lifted from StockSymbolPageClient.tsx
//   trend = close above / below SMA200
// Signals (low side / high side):
//   rsi    RSI <= 30 / >= 70        (today's oversold / overbought pages)
//   z      z20 <= -2 / >= +2
//   both   both together
//   trend  z20 <= -2 and close > SMA200 / z20 >= +2 and close < SMA200
//   z50    z50 <= -2 / >= +2        (the variant)
// An EVENT is the first session of a run in the zone: a symbol re-arms only
// after it leaves the zone. Overlap is measured on DAYS in the zone.
//
// Per event, within 5 / 10 / 20 sessions: the share whose range reaches that
// session's SMA20 again (high >= SMA20 from below, low <= SMA20 from above),
// and the forward close-to-close return: median, p10, p90. The BASE RATE is
// the same on every session on the same side of its SMA20 (and on all sessions).
//
// Splits: large (>= $10B) / mid / small (< $2B) by TODAY's cap (SEC shares x
// the last stored close; applied to the whole history, a stated limitation),
// and up- / down-trend at the event. Counts per day over the last 250 sessions.
// Examples: three recent cases where the signals disagreed.
//
// READ-ONLY, ENFORCED: any Upstash command outside READ_VERBS is refused
// before it is sent. PUBLIC LOG (#553): counts, percentages, dates, RSI and z
// values only. No price, bar, cap or other Tiingo value is printed.
//
//   node scripts/stretch-study.mjs            (relay: write-stretch-study)
//   FIXTURE=1 node scripts/stretch-study.mjs  (synthetic bars, no Redis)
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
const READ_VERBS = new Set(["GET", "MGET", "HGETALL"]);
const UPSTASH = (process.env.UPSTASH_REDIS_REST_URL ?? "https://fixture.invalid").replace(/\/$/, "");
let commands = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    for (const c of cmds) if (!READ_VERBS.has(String(c?.[0] ?? "").toUpperCase())) throw new Error(`study is read-only: refused ${c?.[0]}`);
    commands += cmds.length || 1;
  }
  return realFetch(input, init);
};

const redis = FIXTURE ? null : (await import("@upstash/redis")).Redis.fromEnv();
const { tiingoEodKey, TIINGO_UNIVERSE_KEY } = await import("../lib/server/marketData/keys.ts");
const { eodBarsToPoints } = await import("../lib/server/marketData/pickerHistory.ts");
const { parseTiingoUniverse } = await import("../lib/server/tiingoUniverse.ts");
const { PICKERS_SEC_KEY, parseSecCapHash, secCapAndPe } = await import("../lib/server/pickersSecFundamentals.ts");
const { toDashed } = await import("../lib/symbolSpellings.mjs");

// The page's RSI, lifted line for line.
const page = fs.readFileSync("app/stock/[symbol]/StockSymbolPageClient.tsx", "utf8");
const tmp = `scripts/.stretch-study-${process.pid}.mjs`;
fs.writeFileSync(tmp, ts.transpileModule(`${grabFunction(page, "rsiWilder")}\nexport { rsiWilder };\n`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
let rsiWilder;
try { ({ rsiWilder } = await import(`${process.cwd()}/${tmp}`)); } finally { fs.rmSync(tmp, { force: true }); }

const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
function fixtureBars(seed) {
  const out = [];
  let p = 20 + seed * 9;
  let r = seed * 7919;
  const rnd = () => ((r = (r * 48271) % 2147483647) / 2147483647) - 0.5;
  for (let t = Date.parse("2021-06-01T00:00:00Z"); t <= Date.parse("2026-10-02T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    p *= 1 + rnd() * 0.04 + 0.0003;
    out.push([d.toISOString().slice(0, 10), p, p * 1.01, p * 0.99, p, 1e6]);
  }
  return { bars: out };
}

let universe = FIXTURE ? Array.from({ length: 12 }, (_, i) => `F${i + 1}`) : parseTiingoUniverse(await redis.get(TIINGO_UNIVERSE_KEY))?.symbols ?? [];
universe = [...new Set(universe.map((s) => String(s).trim().toUpperCase()).filter(Boolean))];
if (!universe.length) { console.error("FATAL: no universe."); process.exit(1); }
const secRows = FIXTURE ? {} : parseSecCapHash((await redis.hgetall(PICKERS_SEC_KEY)) ?? null, Date.now());

// ── per-symbol series ───────────────────────────────────────────────────────
function rolling(closes, n) {
  const mean = Array(closes.length).fill(null), sd = Array(closes.length).fill(null);
  let s = 0, s2 = 0;
  for (let i = 0; i < closes.length; i++) {
    s += closes[i]; s2 += closes[i] * closes[i];
    if (i >= n) { s -= closes[i - n]; s2 -= closes[i - n] * closes[i - n]; }
    if (i >= n - 1) { const m = s / n; mean[i] = m; sd[i] = Math.sqrt(Math.max(0, s2 / n - m * m)); }
  }
  return { mean, sd };
}

const SIGNALS = ["rsi", "z", "both", "trend", "z50"];
const SIDES = ["low", "high"];
const H = [5, 10, 20];
const BUCKETS = ["all", "large", "mid", "small", "up", "down"];
const newAcc = () => ({ n: 0, touch: { 5: 0, 10: 0, 20: 0 }, fwd: { 5: [], 10: [], 20: [] } });
const acc = {}; // acc[signal][side][bucket]
for (const g of SIGNALS) { acc[g] = {}; for (const sd of SIDES) { acc[g][sd] = {}; for (const b of BUCKETS) acc[g][sd][b] = newAcc(); } }
const base = {}; // base[side][bucket], side: low (below SMA20) / high / any
for (const sd of ["low", "high", "any"]) { base[sd] = {}; for (const b of BUCKETS) base[sd][b] = newAcc(); }
const overlapDays = { low: { rsi: 0, z: 0, both: 0 }, high: { rsi: 0, z: 0, both: 0 } };
const perDate = new Map(); // date -> { rsiLow, zLow, rsiHigh, zHigh, bothLow, bothHigh, trendLow, trendHigh } day counts
const recent = []; // disagreement candidates in the last 60 sessions
let symbolsUsed = 0, sessions = 0;
const capCounts = { large: 0, mid: 0, small: 0, unknown: 0 };

// Fill a reservoir sample of the base forward returns so memory stays bounded.
const BASE_KEEP = 400_000;
let baseSeen = 0;
function pushBase(a, h, v) {
  if (a.fwd[h].length < BASE_KEEP) a.fwd[h].push(v);
  else { const j = Math.floor(Math.random() * baseSeen); if (j < BASE_KEEP) a.fwd[h][j] = v; }
}

function record(a, bars, mean, t, side) {
  a.n++;
  for (const h of H) {
    let hit = false;
    for (let k = t + 1; k <= t + h && !hit; k++) {
      if (mean[k] === null) continue;
      if (side === "low" ? bars[k].high >= mean[k] : bars[k].low <= mean[k]) hit = true;
    }
    if (hit) a.touch[h]++;
    a.fwd[h].push(bars[t + h].close / bars[t].close - 1);
  }
}

for (let i0 = 0; i0 < universe.length; i0 += 10) {
  const slice = universe.slice(i0, i0 + 10);
  const vals = FIXTURE ? slice.map((_, j) => fixtureBars(i0 + j + 1)) : await redis.mget(...slice.map((s) => tiingoEodKey(toDashed(s))));
  slice.forEach((s, j) => {
    const e = parse(vals[j]);
    const bars = e && Array.isArray(e.bars) ? eodBarsToPoints(e.bars).filter((b) => b.high > 0 && b.low > 0 && b.close > 0) : [];
    if (bars.length < 260) return;
    symbolsUsed++;
    const closes = bars.map((b) => b.close);
    const n = bars.length;
    const r20 = rolling(closes, 20), r50 = rolling(closes, 50), r200 = rolling(closes, 200);
    const rsi = rsiWilder(closes, 14);
    const sec = secRows[toDashed(s)] ?? secRows[s] ?? null;
    const cap = secCapAndPe(sec, closes[n - 1]).marketCap;
    const capB = cap === null ? null : cap >= 10e9 ? "large" : cap < 2e9 ? "small" : "mid";
    capCounts[capB ?? "unknown"]++;
    const z = (r, i) => (r.sd[i] > 0 ? (closes[i] - r.mean[i]) / r.sd[i] : null);
    const state = (i) => {
      const z20 = z(r20, i), z50v = z(r50, i), up = r200.mean[i] !== null && closes[i] > r200.mean[i];
      const R = rsi[i];
      if (z20 === null || R === null || r200.mean[i] === null) return null;
      return {
        low: { rsi: R <= 30, z: z20 <= -2, both: R <= 30 && z20 <= -2, trend: z20 <= -2 && up, z50: z50v !== null && z50v <= -2 },
        high: { rsi: R >= 70, z: z20 >= 2, both: R >= 70 && z20 >= 2, trend: z20 >= 2 && !up, z50: z50v !== null && z50v >= 2 },
        up, z20, R,
      };
    };
    let prev = null;
    for (let t = 200; t < n; t++) {
      const st = state(t);
      if (!st) { prev = null; continue; }
      sessions++;
      const date = bars[t].date;
      if (t >= n - 260) {
        const d = perDate.get(date) ?? { rsiLow: 0, zLow: 0, bothLow: 0, trendLow: 0, rsiHigh: 0, zHigh: 0, bothHigh: 0, trendHigh: 0 };
        for (const sd of SIDES) for (const g of ["rsi", "z", "both", "trend"]) if (st[sd][g]) d[`${g}${sd === "low" ? "Low" : "High"}`]++;
        perDate.set(date, d);
      }
      for (const sd of SIDES) {
        if (st[sd].rsi) overlapDays[sd].rsi++;
        if (st[sd].z) overlapDays[sd].z++;
        if (st[sd].both) overlapDays[sd].both++;
      }
      if (t + 20 >= n) { prev = st; continue; }
      const buckets = ["all", ...(capB ? [capB] : []), st.up ? "up" : "down"];
      // Base: every session, and every session on each side of its SMA20.
      baseSeen++;
      const sideNow = closes[t] < r20.mean[t] ? "low" : "high";
      for (const b of buckets) {
        for (const sd of ["any", sideNow]) {
          const a = base[sd][b];
          a.n++;
          for (const h of H) {
            let hit = false;
            for (let k = t + 1; k <= t + h && !hit; k++) if (sideNow === "low" ? bars[k].high >= r20.mean[k] : bars[k].low <= r20.mean[k]) hit = true;
            if (hit) a.touch[h]++;
            pushBase(a, h, closes[t + h] / closes[t] - 1);
          }
        }
      }
      for (const g of SIGNALS) for (const sd of SIDES) {
        if (st[sd][g] && !(prev && prev[sd][g])) for (const b of buckets) record(acc[g][sd][b], bars, r20.mean, t, sd);
      }
      // Disagreements in the last 60 sessions with 10 sessions to follow.
      if (t >= n - 80 && t + 10 < n && cap !== null) {
        const touched10 = (sd) => { for (let k = t + 1; k <= t + 10; k++) if (sd === "low" ? bars[k].high >= r20.mean[k] : bars[k].low <= r20.mean[k]) return true; return false; };
        const fwd10 = closes[t + 10] / closes[t] - 1;
        const dv = closes.slice(-60).reduce((a, c, k) => a + c * (bars[n - 60 + k].volume ?? 0), 0);
        if (st.low.rsi && !(prev && prev.low.rsi) && st.z20 > -1.5) recent.push({ kind: "slow grind (RSI oversold, z above -1.5)", s, date, R: st.R, z: st.z20, side: "low", touched: touched10("low"), fwd10, dv, capB });
        if (st.low.z && !(prev && prev.low.z) && st.R > 40) recent.push({ kind: "sudden drop (z <= -2, RSI above 40)", s, date, R: st.R, z: st.z20, side: "low", touched: touched10("low"), fwd10, dv, capB });
        if (st.high.rsi && !(prev && prev.high.rsi) && st.z20 < 1.5) recent.push({ kind: "strong trend (RSI overbought, z below +1.5)", s, date, R: st.R, z: st.z20, side: "high", touched: touched10("high"), fwd10, dv, capB });
      }
      prev = st;
    }
  });
}

// ── report ──────────────────────────────────────────────────────────────────
const q = (v, p) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const pc = (x) => (x === null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);
const share = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");
const line = (label, a) => `${label.padEnd(30)} n=${String(a.n).padStart(7)}  touch SMA20 5/10/20: ${H.map((h) => share(a.touch[h], a.n)).join(" / ")}  fwd median 5/10/20: ${H.map((h) => pc(q(a.fwd[h], 0.5))).join(" / ")}  p10/p90 at 10: ${pc(q(a.fwd[10], 0.1))} / ${pc(q(a.fwd[10], 0.9))}`;

console.log(`universe ${universe.length} · used (≥260 bars) ${symbolsUsed} · sessions scored ${sessions} · caps large ${capCounts.large} / mid ${capCounts.mid} / small ${capCounts.small} / unknown ${capCounts.unknown} · Redis commands ${commands}`);

console.log("\n== OVERLAP (days in the zone) ==");
for (const sd of SIDES) {
  const o = overlapDays[sd];
  const name = sd === "low" ? "oversold (RSI<=30 vs z<=-2)" : "overbought (RSI>=70 vs z>=+2)";
  console.log(`  ${name}: RSI days ${o.rsi}, z days ${o.z}, both ${o.both} · of RSI days also z: ${share(o.both, o.rsi)} · of z days also RSI: ${share(o.both, o.z)}`);
}

for (const sd of SIDES) {
  console.log(`\n== ${sd === "low" ? "LOW SIDE (stretched below)" : "HIGH SIDE (stretched above)"}: events, reversion to SMA20, forward returns ==`);
  for (const b of BUCKETS) {
    console.log(`  [${b}]`);
    console.log(`    ${line(`base: all sessions ${sd === "low" ? "below" : "above"} SMA20`, base[sd][b])}`);
    for (const g of SIGNALS) console.log(`    ${line(`${g}`, acc[g][sd][b])}`);
  }
  console.log(`  [all] ${line("base: every session", base.any.all)}`);
}

console.log("\n== SYMBOLS IN THE ZONE PER DAY (last 250 sessions; median / p90 / max) ==");
const dates = [...perDate.keys()].sort().slice(-250);
for (const k of ["rsiLow", "zLow", "bothLow", "trendLow", "rsiHigh", "zHigh", "bothHigh", "trendHigh"]) {
  const v = dates.map((d) => perDate.get(d)[k]);
  console.log(`  ${k.padEnd(10)} ${q(v, 0.5)} / ${q(v, 0.9)} / ${Math.max(...v)}`);
}

console.log("\n== EXAMPLES: recent disagreements (largest 60-day dollar volume per kind) ==");
for (const kind of [...new Set(recent.map((r) => r.kind))]) {
  const top = recent.filter((r) => r.kind === kind).sort((a, b) => b.dv - a.dv).slice(0, 3);
  for (const r of top) console.log(`  ${kind}: ${r.s} (${r.capB}) ${r.date} · RSI ${r.R.toFixed(1)} · z20 ${r.z.toFixed(2)} · within 10 sessions back to SMA20: ${r.touched ? "yes" : "no"} · 10-session move ${pc(r.fwd10)}`);
}
if (!recent.length) console.log("  none found");
console.log(`\nRedis commands ${commands} (read-only: ${[...READ_VERBS].join(", ")})`);
