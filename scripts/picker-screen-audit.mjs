// EVERY PICKER SCREEN, MEASURED OVER THE LAST 60 SESSIONS (#553 COWORK #169).
// READ-ONLY, ENFORCED: every Upstash request is inspected before it is sent and
// any command outside READ_VERBS is refused (the build then fails loudly).
//
// For each of the last SESSIONS sessions, each symbol's stored Tiingo bars are
// cut at that session and the REAL build (buildPickersPayloadDryRun, which
// writes nothing) runs over them. Per screen, the members are then read the
// way the pages read them:
//   flag screens      the SignalRecord boolean (presetFilters in app/*/page.tsx)
//   section screens   the section's items (CATEGORY_SECTION_DEFS in
//                     app/components/PickerResultPage.tsx)
//   Buy / Sell        getBuySignalCount > 0 / PickerResultPage's
//                     getSellSignalCount > 0
// Everything the build reads besides the bars (market state, dynamic universe,
// SEC rows, earnings) is TODAY's store for every cut, and the trend-flip
// weekly logic uses today's clock; so a fundamentals screen is constant across
// cuts here and is reported from the latest cut only.
//
// Per screen: median / p10 / p90 / max members a session, % of the measured
// universe, sessions with zero, and the nearest sibling by mean Jaccard overlap.
//
// PUBLIC LOG (#553): counts, %, dates and screen names only. No price, no bar.
//
//   node scripts/picker-screen-audit.mjs   (relay: write-picker-screen-audit)
import { register } from "node:module";
register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/next-server-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);

delete process.env.FMP_API_KEY;
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }

const READ_VERBS = new Set([
  "GET", "MGET", "HGET", "HMGET", "HGETALL", "HKEYS", "HLEN", "HEXISTS", "SMEMBERS", "SISMEMBER", "SCARD",
  "ZRANGE", "ZREVRANGE", "ZRANGEBYSCORE", "ZREVRANGEBYSCORE", "ZSCORE", "ZCARD", "EXISTS", "TTL", "PTTL", "STRLEN", "TYPE", "LRANGE", "LLEN",
]);
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
const meter = { commands: 0, refused: new Map() };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    for (const c of cmds) {
      const verb = String(c?.[0] ?? "").toUpperCase();
      if (!READ_VERBS.has(verb)) { meter.refused.set(verb, (meter.refused.get(verb) ?? 0) + 1); throw new Error(`audit is read-only: refused ${verb}`); }
    }
    meter.commands += cmds.length || 1;
  }
  return realFetch(input, init);
};

const redis = (await import("@upstash/redis")).Redis.fromEnv();
const { buildPickersPayloadDryRun, PICKERS_SYMBOLS_KEY } = await import("../lib/server/pickersBuilder.ts");
const { tiingoEodKey } = await import("../lib/server/marketData/keys.ts");
const { eodBarsToPoints } = await import("../lib/server/marketData/pickerHistory.ts");
const { getBuySignalCount } = await import("../lib/signalCounts.ts");
// The #169 fix (#553 COWORK #186) moves Buy/Sell to lib/pickerScreenRules.ts.
// Read through it where the branch has it, so the same script measures
// before (main) and after (the fix branch).
const screenRules = await import("../lib/pickerScreenRules.ts").catch(() => null);
console.log(`buy/sell rule: ${screenRules ? "pickerScreenRules (the #169 fix)" : "main's (score > 0)"}`);
const { toDashed } = await import("../lib/symbolSpellings.mjs");
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const SESSIONS = Number(process.env.SESSIONS || 60);
const BUDGET_MS = Number(process.env.BUDGET_MS || 36 * 60 * 1000);
const started = Date.now();

// Flag screens: page -> SignalRecord field (presetFilters).
const FLAG_SCREENS = [
  ["oversold-stocks-today", "oversold"], ["overbought-stocks-today", "overbought"],
  ["stocks-down-20-from-all-time-highs", "buyTheDip"], ["breakout-signal-stocks", "breakout"],
  ["volume-spike-stocks", "volumeSpike"], ["atr-spike-stocks", "atrSpike"],
  ["stocks-above-50-day-moving-average", "aboveMA50"], ["stocks-below-50-day-moving-average", "belowMA50"],
  ["stocks-trading-above-200-day-moving-average", "aboveMA200"], ["stocks-below-200-day-moving-average", "belowMA200"],
  ["stocks-near-200-day-moving-average", "dailyMa200Proximity"], ["stocks-near-weekly-200-day-moving-average", "weeklyMa200Proximity"],
  ["stocks-with-bullish-trend-flip", "trendFlipBullish"], ["stocks-with-bearish-trend-flip", "trendFlipBearish"],
  ["stocks-with-weekly-bullish-trend-flip", "trendFlipBullishWeekly"], ["stocks-with-weekly-bearish-trend-flip", "trendFlipBearishWeekly"],
  ["bullish-rsi-divergence-stocks", "bullishRsiDivergence"], ["bearish-rsi-divergence-stocks", "bearishRsiDivergence"],
  ["bullish-macd-divergence-stocks", "bullishMacdDivergence"], ["bearish-macd-divergence-stocks", "bearishMacdDivergence"],
  ["stocks-with-strong-earnings-growth", "strongEarningsGrowth"], ["stocks-with-positive-last-earnings", "positiveLastEarnings"],
];
// Section screens: page -> title needles (CATEGORY_SECTION_DEFS).
const SECTION_SCREENS = [
  ["best-trend-score-stocks", ["best trend score"]], ["bullish-bearish-divergence-stocks", ["divergence"]],
  ["macro-support-resistance-stocks", ["macro", "support", "resistance"]],
  ["all-time-high-breakout-stocks", ["all-time high breakout"]], ["3-month-high-breakout-stocks", ["3-month high breakout"]],
];
const sellCount = (r) => (r.overbought ? 1 : 0) + (r.belowMA50 ? 1 : 0) + (r.belowMA200 ? 1 : 0) + (r.bearishRsiDivergence ? 1 : 0) + (r.bearishMacdDivergence ? 1 : 0);
const findSection = (sections, needles) => sections.find((s) => needles.every((n) => String(s.title).toLowerCase().includes(n)));

function membersOf(payload) {
  const out = new Map();
  const recs = payload.signalRecords ?? [];
  for (const [page, field] of FLAG_SCREENS) out.set(page, new Set(recs.filter((r) => r[field] === true).map((r) => r.symbol)));
  for (const [page, needles] of SECTION_SCREENS) out.set(page, new Set((findSection(payload.sections ?? [], needles)?.items ?? []).map((i) => i.symbol)));
  const buyOk = (r) => (screenRules ? screenRules.qualifiesBuySignal(getBuySignalCount(r)) : getBuySignalCount(r) > 0);
  const sellOk = (r) => (screenRules ? screenRules.qualifiesSellSignal(r, sellCount(r)) : sellCount(r) > 0);
  out.set("top-stocks-with-buy-signals", new Set(recs.filter(buyOk).map((r) => r.symbol)));
  out.set("top-stocks-with-sell-signals", new Set(recs.filter(sellOk).map((r) => r.symbol)));
  return out;
}

// ── the universe and its bars, read once ────────────────────────────────────
const listed = parse(await redis.get(PICKERS_SYMBOLS_KEY));
const universe = Array.isArray(listed) ? listed.map((s) => String(s).trim().toUpperCase()).filter(Boolean) : [];
const full = new Map();
for (let i = 0; i < universe.length; i += 25) {
  const chunk = universe.slice(i, i + 25);
  const vals = await redis.mget(...chunk.map((s) => tiingoEodKey(toDashed(s))));
  chunk.forEach((s, k) => { const e = parse(vals[k]); const pts = e && Array.isArray(e.bars) ? eodBarsToPoints(e.bars) : []; if (pts.length) full.set(s, pts); });
}
// The session calendar: the most common newest dates across the universe.
const dateCount = new Map();
for (const pts of full.values()) for (const p of pts.slice(-SESSIONS - 5)) { const d = String(p.date).slice(0, 10); dateCount.set(d, (dateCount.get(d) ?? 0) + 1); }
const sessions = [...dateCount.entries()].filter(([, n]) => n >= full.size * 0.5).map(([d]) => d).sort().slice(-SESSIONS);
console.log(`universe ${universe.length} · with stored bars ${full.size} · sessions ${sessions[0]} → ${sessions[sessions.length - 1]} (${sessions.length})\n`);

// ── one dry build per session, newest first, inside the time budget ─────────
const perSession = []; // { date, measured, members: Map<page, Set> }
for (const date of [...sessions].reverse()) {
  if (Date.now() - started > BUDGET_MS) { console.log(`time budget reached after ${perSession.length} session(s); the rest are not measured`); break; }
  const hist = new Map();
  for (const [s, pts] of full) { const cut = pts.filter((p) => String(p.date).slice(0, 10) <= date); if (cut.length) hist.set(s, cut); }
  const t = Date.now();
  const payload = await buildPickersPayloadDryRun(hist);
  perSession.push({ date, measured: (payload.signalRecords ?? []).length, members: membersOf(payload) });
  // THE PAYLOAD'S SIZE on the newest cut (the weekly flip cards add candles): bytes only.
  if (perSession.length === 1) {
    const total = JSON.stringify(payload).length;
    const bySection = (payload.sections ?? []).filter((x) => /trend flip|strong earnings|daily ma200/i.test(String(x.title)))
      .map((x) => `${x.title}: ${x.items?.length ?? 0} items, ${JSON.stringify(x).length} B`);
    console.log(`  payload ${total} B on ${date}; ${bySection.join("; ")}`);
  }
  console.log(`  built ${date}: ${(payload.signalRecords ?? []).length} records (${Date.now() - t} ms)`);
}
perSession.reverse();

// ── per screen ──────────────────────────────────────────────────────────────
const pages = [...perSession[0].members.keys()];
const q = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * (xs.length - 1)))];
const jaccard = (a, b) => { if (!a.size && !b.size) return null; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };
const measuredMedian = q(perSession.map((s) => s.measured).sort((a, b) => a - b), 0.5);
console.log(`\nper screen over ${perSession.length} session(s) (${perSession[0].date} → ${perSession[perSession.length - 1].date}); % is the median against the median measured universe (${measuredMedian})`);
console.log(`screen | median | p10 | p90 | max | % | zero days | latest | nearest sibling (mean Jaccard)`);
for (const page of pages) {
  const counts = perSession.map((s) => s.members.get(page).size).sort((a, b) => a - b);
  let best = null;
  for (const other of pages) {
    if (other === page) continue;
    const js = perSession.map((s) => jaccard(s.members.get(page), s.members.get(other))).filter((x) => x !== null);
    if (!js.length) continue;
    const m = js.reduce((a, b) => a + b, 0) / js.length;
    if (!best || m > best.m) best = { other, m };
  }
  const zero = counts.filter((c) => c === 0).length;
  const latest = perSession[perSession.length - 1].members.get(page).size;
  console.log(`${page} | ${q(counts, 0.5)} | ${q(counts, 0.1)} | ${q(counts, 0.9)} | ${counts[counts.length - 1]} | ${((q(counts, 0.5) / measuredMedian) * 100).toFixed(1)}% | ${zero} | ${latest} | ${best ? `${best.other} ${best.m.toFixed(2)}` : "–"}`);
}
console.log(`\nRedis commands ${meter.commands} (read-only${meter.refused.size ? `; REFUSED ${JSON.stringify(Object.fromEntries(meter.refused))}` : ", 0 refused"}); ${Math.round((Date.now() - started) / 1000)} s`);
process.exit(meter.refused.size ? 1 : 0);
