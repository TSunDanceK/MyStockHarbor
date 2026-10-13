// THE NEW MARKET STATE AGAINST THE OLD, DRY (#553 COWORK #173/#190). READ-ONLY,
// ENFORCED (GET, HGETALL). Builds msh:market:dynamic:v1's value from the
// stored newest bars (eod-last: the bar and the prior close, all a ranking
// needs) and compares it with the frozen msh:market:state. Writes nothing.
//
// PUBLIC LOG: symbols and counts. No price, no bar.
//
//   node scripts/market-dynamic-dry-run.mjs   (relay: write-market-dynamic-dry-run)
import { register } from "node:module";
import { toDashed } from "../lib/symbolSpellings.mjs";
register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }
const READ_VERBS = new Set(["GET", "HGETALL"]);
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
let commands = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    if (!cmds.length) throw new Error("dry run is read-only: refused a request with no readable command");
    for (const c of cmds) if (!READ_VERBS.has(String(c?.[0] ?? "").toUpperCase())) throw new Error(`dry run is read-only: refused ${c?.[0]}`);
    commands += cmds.length;
  }
  return realFetch(input, init);
};
const M = await import("../lib/server/marketDynamic.ts");
const redis = (await import("@upstash/redis")).Redis.fromEnv();
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const last = (await redis.hgetall("msh:tiingo:eod-last:v1")) ?? {};
const bars = new Map();
const dates = new Map();
for (const [sym, raw] of Object.entries(last)) {
  const r = parse(raw);
  if (!r || typeof r.pc !== "number") continue;
  bars.set(sym, [["prev", r.pc, r.pc, r.pc, r.pc, 0], [r.d, r.o, r.h, r.l, r.c, r.v]]);
  dates.set(r.d, (dates.get(r.d) ?? 0) + 1);
}
const asOf = [...dates.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
const v = M.buildMarketDynamic(bars, asOf, new Date().toISOString());
console.log(`eod-last rows ${Object.keys(last).length} · with a prior close ${bars.size} · session ${asOf}`);
console.log(`NEW: dynamic ${v.dynamicSymbols.length} · topTraded ${v.topTraded.length} · topMovers ${v.topMovers.length}`);
console.log(`  top traded: ${v.topTraded.map((r) => r.symbol).join(" ")}`);
console.log(`  top movers: ${v.topMovers.map((r) => r.symbol).join(" ")}`);
const old = parse(await redis.get("msh:market:state"));
const oldSyms = new Set(Object.keys(old?.dynamic ?? {}).map((s) => toDashed(s.toUpperCase())));
const newSyms = new Set(v.dynamicSymbols);
const both = [...newSyms].filter((s) => oldSyms.has(s)).length;
console.log(`OLD (frozen msh:market:state): dynamic ${oldSyms.size}`);
console.log(`overlap ${both} · only new ${newSyms.size - both} · only old ${oldSyms.size - both}`);
console.log(`\nRedis commands ${commands} (read-only)`);
