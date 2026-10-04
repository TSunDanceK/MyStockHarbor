// MARKET MOOD, THE SHIPPED MATHS ON THE STORED BARS (#563 COWORK #96).
//
// Runs lib/marketMood.ts computeMarketMood exactly as the nightly route will
// (the same exclude list), over the Tiingo daily bars already stored, and
// prints what the card would show plus a year's label counts. Nothing is
// written: GET/MGET only, enforced. PUBLIC LOG (#553): dates, counts and 0–100
// scores only, never a price, bar or volume.
//
//   node scripts/market-mood-dryrun.mjs     (relay: write-market-mood-dryrun)
import { register } from "node:module";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/next-server-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.error("FATAL: needs the Upstash credentials (write- relay job).");
  process.exit(2);
}
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
    for (const c of cmds) if (!READ_VERBS.has(String(c?.[0] ?? "").toUpperCase())) throw new Error(`dry run is read-only: refused ${c?.[0]}`);
    commands += cmds.length || 1;
  }
  return realFetch(input, init);
};

const redis = (await import("@upstash/redis")).Redis.fromEnv();
const { tiingoEodKey, TIINGO_UNIVERSE_KEY } = await import("../lib/server/marketData/keys.ts");
const { parseTiingoUniverse } = await import("../lib/server/tiingoUniverse.ts");
const { computeMarketMood, moodView, moodLabel, MOOD_INPUTS, MOOD_LABELS } = await import("../lib/marketMood.ts");
const { MOOD_EXCLUDE } = await import("../lib/server/marketMoodWrite.ts");
const { toDashed } = await import("../lib/symbolSpellings.mjs");

const stored = parseTiingoUniverse(await redis.get(TIINGO_UNIVERSE_KEY));
if (!stored) { console.error("FATAL: no Tiingo universe stored."); process.exit(1); }
const symbols = [...new Set([...stored.symbols, "SPY", "TLT", "HYG", "LQD"])];
const bars = new Map();
for (let i = 0; i < symbols.length; i += 25) {
  const rows = await redis.mget(...symbols.slice(i, i + 25).map((s) => tiingoEodKey(toDashed(s))));
  rows.forEach((r, k) => { const v = typeof r === "string" ? JSON.parse(r) : r; if (v?.bars?.length >= 30) bars.set(symbols[i + k], v.bars); });
}
const t = Date.now();
const m = computeMarketMood(bars, MOOD_EXCLUDE);
const ms = Date.now() - t;
console.log(`universe ${symbols.length} · with bars ${bars.size} · LQD stored ${bars.has("LQD") ? "yes" : "no"} · compute ${ms} ms · stored value ${m ? JSON.stringify(m).length : 0} bytes`);
if (!m) { console.log("no reading: SPY's year of bars missing"); process.exit(1); }
const v = moodView(m);
console.log(`\ncard: ${v ? `${v.day.r}/100 ${v.label} · reading for ${v.day.d} · ${v.day.n} measures · sparkline ${v.spark.length} sessions` : "unavailable"}`);
if (v) for (const x of MOOD_INPUTS) console.log(`  ${x.line}: ${v.day.s[x.key] ?? "—"}`);
const year = m.days.slice(-252).filter((d) => d.r !== null);
console.log(`\na year (${year.length} sessions with a reading):`);
for (const { label } of MOOD_LABELS) { const c = year.filter((d) => moodLabel(d.r) === label).length; console.log(`  ${label.padEnd(13)} ${String(c).padStart(4)}  ${((c / Math.max(1, year.length)) * 100).toFixed(0)}%`); }
for (const d of ["2026-03-30", "2026-08-13"]) { const x = m.days.find((y) => y.d === d); console.log(`  ${d}: ${x?.r ?? "—"} ${x?.r != null ? moodLabel(x.r) : ""}`); }
// The card's exact view (dates and 0–100 scores only), so it can be rendered offline for a preview (#97).
if (v) console.log(`\nview ${JSON.stringify({ day: v.day, label: v.label, spark: v.spark })}`);
console.log(`\nRedis commands ${commands} (GET/MGET only)`);
