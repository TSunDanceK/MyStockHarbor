// FLAT DAILY BARS, MEASURED (#553 COWORK #153: BRBI's Price zones at one level).
//
// For the pickers universe's stored Tiingo bars (msh:tiingo:eod:v2):
//   - a "flat" session is open = high = low = close;
//   - per symbol, flat sessions in the last 20, and whether their volume is 0
//     (Tiingo's fill for a day with no trade) or not;
//   - how many symbols have more than 5 flat sessions in the last 20;
//   - for BRBI: the run of flat sessions (dates), their volume (zero or not),
//     and the gap, in %, between the flat close and the stored IEX quote,
//     with the quote's sale time. No price, bar or volume value is printed.
//
// READ-ONLY, ENFORCED. PUBLIC LOG (#553): counts, dates, booleans, % only.
//
//   node scripts/flat-bars-census.mjs     (relay: write-flat-bars-census)
import { register } from "node:module";
register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/next-server-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }
const READ_VERBS = new Set(["GET", "MGET", "HGET", "HMGET"]);
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
const { tiingoEodKey, TIINGO_QUOTES_KEY } = await import("../lib/server/marketData/keys.ts");
const { PICKERS_SYMBOLS_KEY } = await import("../lib/server/pickersBuilder.ts");
const { toDashed } = await import("../lib/symbolSpellings.mjs");
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);

let universe = parse(await redis.get(PICKERS_SYMBOLS_KEY));
universe = [...new Set((Array.isArray(universe) ? universe : []).map((s) => String(s).trim().toUpperCase()).filter(Boolean))];
if (!universe.includes("BRBI")) universe.push("BRBI");
const isFlat = (b) => b[1] === b[2] && b[2] === b[3] && b[3] === b[4];

const heavy = [];
let withBars = 0, anyFlat = 0, flatZeroVol = 0, flatNonZeroVol = 0;
let brbi = null;
for (let i = 0; i < universe.length; i += 10) {
  const chunk = universe.slice(i, i + 10);
  const vals = await redis.mget(...chunk.map((s) => tiingoEodKey(toDashed(s))));
  chunk.forEach((s, k) => {
    const e = parse(vals[k]);
    const bars = e && Array.isArray(e.bars) ? e.bars : [];
    if (bars.length < 20) return;
    withBars++;
    const last20 = bars.slice(-20);
    const flats = last20.filter(isFlat);
    if (flats.length) anyFlat++;
    for (const f of flats) (f[5] === 0 ? flatZeroVol++ : flatNonZeroVol++);
    if (flats.length > 5) heavy.push(`${s} ${flats.length}/20${flats.every((f) => f[5] === 0) ? " (all zero volume)" : ""}`);
    if (s === "BRBI") brbi = { bars, asOf: e.asOf };
  });
}
console.log(`universe ${universe.length} · with ≥ 20 stored bars ${withBars} · with ≥ 1 flat session in the last 20: ${anyFlat}`);
console.log(`flat sessions in the last 20, across the universe: zero volume ${flatZeroVol} · non-zero volume ${flatNonZeroVol}`);
console.log(`symbols with MORE THAN 5 flat sessions in the last 20: ${heavy.length}${heavy.length ? `\n  ${heavy.join("\n  ")}` : ""}`);

if (brbi) {
  const b = brbi.bars;
  const tail = b.slice(-30);
  console.log(`\n── BRBI (stored asOf ${brbi.asOf}; ${b.length} bars)`);
  for (const x of tail) console.log(`  ${x[0]}  flat ${isFlat(x) ? "yes" : "no "}  volume ${x[5] === 0 ? "0" : ">0"}${tail.indexOf(x) > 0 ? `  close vs prior close: ${(((x[4] - tail[tail.indexOf(x) - 1][4]) / tail[tail.indexOf(x) - 1][4]) * 100).toFixed(2)}%` : ""}`);
  let lastReal = null;
  for (let i = b.length - 1; i >= 0; i--) if (!isFlat(b[i]) || b[i][5] !== 0) { lastReal = b[i]; break; }
  console.log(`  last session that was not a flat zero-volume bar: ${lastReal ? lastReal[0] : "none in stored history"}`);
  const q = parse(await redis.hget(TIINGO_QUOTES_KEY, "BRBI"));
  if (q && typeof q.price === "number") {
    const flatClose = b[b.length - 1][4];
    console.log(`  stored IEX quote: last sale ${q.at ? new Date(q.at).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "?"} · vs the stored last close ${(((q.price - flatClose) / flatClose) * 100).toFixed(1)}% · quote prevClose vs stored last close ${q.prevClose ? (((q.prevClose - flatClose) / flatClose) * 100).toFixed(1) + "%" : "none"}`);
  } else console.log("  stored IEX quote: none");
}
console.log(`\nRedis commands ${commands} (read-only: ${[...READ_VERBS].join(", ")})`);
