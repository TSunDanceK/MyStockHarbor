// THE #169 SCREENS ON THE LIVE BUILD (#553 COWORK #194 step 2). READ-ONLY,
// ENFORCED (GET, MGET).
//
// Reads the current pickers manifest and its chunks the way readPickersV10
// does, and counts each #813 screen's members as its page reads them:
//   ATR spike, 20% from ATH   the SignalRecord flag (presetFilters)
//   Buy / Sell                lib/pickerScreenRules.ts over the record, as
//                             PickerResultPage does
// Then the first rows of the "Stocks With Strong Earnings Growth" section with
// their EPS growth % (or $ change for a small base) and period tags.
//
// PUBLIC LOG (#553): counts, symbols, growth % and period labels only. Never a
// price. (The small-base $ change is an EPS difference, a filed figure.)
//
//   node scripts/screen-live-counts.mjs   (relay: write-screen-live-counts)
import { register } from "node:module";
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
    if (!cmds.length) throw new Error("read-only: refused a request with no readable command");
    for (const c of cmds) if (!READ_VERBS.has(String(c?.[0] ?? "").toUpperCase())) throw new Error(`read-only: refused ${c?.[0]}`);
    commands += cmds.length;
  }
  return realFetch(input, init);
};
const redis = (await import("@upstash/redis")).Redis.fromEnv();
const { qualifiesBuySignal, qualifiesSellSignal } = await import("../lib/pickerScreenRules.ts");
const { getBuySignalCount } = await import("../lib/signalCounts.ts");
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);

const manifest = parse(await redis.get("msh:pickers:v10:manifest"));
if (!manifest || !Array.isArray(manifest.chunkKeys)) { console.log("no current manifest"); process.exit(1); }
const records = [];
for (let i = 0; i < manifest.chunkKeys.length; i += 20) {
  const chunks = await redis.mget(...manifest.chunkKeys.slice(i, i + 20));
  for (const c of chunks) { const a = parse(c); if (!Array.isArray(a)) { console.log("a chunk is missing"); process.exit(1); } records.push(...a); }
}
console.log(`build ${new Date(manifest.cachedAt).toISOString()}: ${records.length} records (manifest says ${manifest.recordCount})`);

// The same sell count PickerResultPage's getSellSignalCount takes.
const sellCount = (r) => (r.overbought ? 1 : 0) + (r.belowMA50 ? 1 : 0) + (r.belowMA200 ? 1 : 0) + (r.bearishRsiDivergence ? 1 : 0) + (r.bearishMacdDivergence ? 1 : 0);
console.log(`  ATR spike (atrSpike):        ${records.filter((r) => r?.atrSpike === true).length}`);
console.log(`  20% from ATH (buyTheDip):    ${records.filter((r) => r?.buyTheDip === true).length}`);
console.log(`  Buy Signals (score >= 3):    ${records.filter((r) => qualifiesBuySignal(getBuySignalCount(r))).length}`);
console.log(`  Sell Signals (2+, an event): ${records.filter((r) => qualifiesSellSignal(r, sellCount(r))).length}`);

const sec = (manifest.head?.sections ?? []).find((s) => /strong earnings growth/i.test(String(s.title)));
const items = Array.isArray(sec?.items) ? sec.items : [];
const withView = items.filter((i) => i?.epsGrowth && typeof i.epsGrowth === "object");
console.log(`\nStrong Earnings Growth: ${items.length} items, ${withView.length} with an EPS growth view (${withView.filter((i) => i.epsGrowth.small).length} small base)`);
const show = (i) => {
  const g = i.epsGrowth;
  const fig = g.small ? `${g.change >= 0 ? "+" : "-"}$${Math.abs(g.change).toFixed(2)} (small base)` : `${g.pct >= 0 ? "+" : ""}${g.pct}%`;
  return `  ${i.symbol}: ${fig} · ${g.label} vs ${g.priorLabel} (${g.basis})`;
};
for (const i of withView.filter((x) => !x.epsGrowth.small).slice(0, 5)) console.log(show(i));
for (const i of withView.filter((x) => x.epsGrowth.small).slice(0, 2)) console.log(show(i));
console.log(`\nRedis commands ${commands} (read-only: GET, MGET)`);
