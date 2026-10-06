// ATR SPIKE: THE CURRENT RULE AND TWO ALTERNATIVES OVER 60 SESSIONS
// (#553 COWORK #186 ruling 4). READ-ONLY, ENFORCED (GET, MGET).
//
// For each universe symbol's stored Tiingo bars, on each of the last SESSIONS
// sessions (bars cut at that session), the true range and Wilder's ATR(14):
//   now    ATR(14) >= 1.5 x SMA20(ATR14)          (pickersBuilder :4081)
//   alt A  ATR(14) >= 1.3 x SMA50(ATR14)
//   alt A' ATR(14) >= 1.25 x SMA50(ATR14)
//   alt B  today's true range >= 2 x the prior day's ATR(14)
// Prints members per session: median / p10 / p90 / max and zero days.
//
// PUBLIC LOG (#553): counts and dates only.
//   node scripts/atr-spike-census.mjs   (relay: write-atr-spike-census)
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
    if (!cmds.length) throw new Error("census is read-only: refused a request with no readable command");
    for (const c of cmds) if (!READ_VERBS.has(String(c?.[0] ?? "").toUpperCase())) throw new Error(`census is read-only: refused ${c?.[0]}`);
    commands += cmds.length;
  }
  return realFetch(input, init);
};
const redis = (await import("@upstash/redis")).Redis.fromEnv();
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const dashed = (s) => String(s).trim().toUpperCase().replace(/\./g, "-");
const SESSIONS = Number(process.env.SESSIONS || 60);

const universe = (parse(await redis.get("msh:pickers:v10:symbols")) ?? []).map((s) => String(s).toUpperCase());
const rule = { now: new Map(), a: new Map(), a2: new Map(), b: new Map() };
const bump = (m, d) => m.set(d, (m.get(d) ?? 0) + 1);
const dates = new Set();
let measured = 0;
for (let i = 0; i < universe.length; i += 25) {
  const chunk = universe.slice(i, i + 25);
  const vals = await redis.mget(...chunk.map((s) => `msh:tiingo:eod:v2:${dashed(s)}`));
  for (const v of vals) {
    const bars = parse(v)?.bars;
    if (!Array.isArray(bars) || bars.length < 120) continue;
    measured++;
    // [date, o, h, l, c, v]
    const n = bars.length;
    const tr = bars.map((b, k) => {
      const h = b[2], l = b[3], pc = k > 0 ? bars[k - 1][4] : null;
      return pc == null ? h - l : Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    });
    const atr = Array(n).fill(null);
    let sum = 0;
    for (let k = 0; k < n; k++) {
      if (k < 14) { sum += tr[k]; if (k === 13) atr[k] = sum / 14; continue; }
      atr[k] = (atr[k - 1] * 13 + tr[k]) / 14;
    }
    const sma = (k, p) => { if (k - p + 1 < 13) return null; let s = 0; for (let j = k - p + 1; j <= k; j++) { if (atr[j] == null) return null; s += atr[j]; } return s / p; };
    for (let back = 0; back < SESSIONS; back++) {
      const k = n - 1 - back;
      if (k < 80) break;
      const d = bars[k][0];
      dates.add(d);
      const a = atr[k], s20 = sma(k, 20), s50 = sma(k, 50);
      if (a && s20 && a >= 1.5 * s20) bump(rule.now, d);
      if (a && s50 && a >= 1.3 * s50) bump(rule.a, d);
      if (a && s50 && a >= 1.25 * s50) bump(rule.a2, d);
      if (atr[k - 1] && tr[k] >= 2 * atr[k - 1]) bump(rule.b, d);
    }
  }
}
const days = [...dates].sort().slice(-SESSIONS);
const q = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * (xs.length - 1)))];
console.log(`universe ${universe.length} · measured ${measured} · sessions ${days[0]} → ${days[days.length - 1]} (${days.length})\n`);
for (const [k, label] of [["now", "now: ATR14 >= 1.5 x SMA20(ATR)"], ["a", "A:  ATR14 >= 1.3 x SMA50(ATR)"], ["a2", "A': ATR14 >= 1.25 x SMA50(ATR)"], ["b", "B:  true range >= 2 x prior ATR14"]]) {
  const xs = days.map((d) => rule[k].get(d) ?? 0).sort((x, y) => x - y);
  console.log(`${label.padEnd(36)} median ${q(xs, 0.5)} · p10 ${q(xs, 0.1)} · p90 ${q(xs, 0.9)} · max ${xs[xs.length - 1]} · zero days ${xs.filter((x) => x === 0).length} · latest ${rule[k].get(days[days.length - 1]) ?? 0}`);
}
console.log(`\nRedis commands ${commands} (read-only: GET, MGET)`);
