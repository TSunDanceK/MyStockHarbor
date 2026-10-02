// READ-ONLY: is each symbol in the price pool, the Tiingo quote pool and the
// Tiingo EOD store? (#553 COWORK #78, for C's step 6.) Prints presence and row
// age only -- no price or other market value (the repo's logs are public).
//
//   SYMBOLS=SPY,QQQ node scripts/pool-has.mjs
import { Redis } from "@upstash/redis";

const symbols = String(process.env.SYMBOLS || "SPY,QQQ,DIA,IWM").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const redis = Redis.fromEnv();
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const age = (at) => (Number.isFinite(at) ? `${((Date.now() - at) / 3_600_000).toFixed(1)} h` : "no stamp");

const pool = (await redis.hmget("msh:price-pool:v1", ...symbols)) ?? {};
const quotes = (await redis.hmget("msh:tiingo:quotes:v1", ...symbols)) ?? {};
// BAR COUNT, NOT EXISTS (#553 COWORK #88): MA200 needs >=200 stored bars.
// The count and the newest bar's DATE are printed; no price or volume.
const eod = await redis.pipeline();
for (const s of symbols) eod.get(`msh:tiingo:eod:v2:${s}`);
const eodRows = (await eod.exec()).map((v) => (v ? parse(v) : null));
const eodHas = eodRows.map((r) => {
  const bars = r && Array.isArray(r.bars) ? r.bars : null;
  if (!bars) return r ? "yes (no bars array)" : null;
  const last = bars[bars.length - 1];
  return `yes, ${bars.length} bars${bars.length >= 200 ? " (>=200, MA200 computes)" : " (<200)"}, newest ${Array.isArray(last) ? last[0] : "?"}`;
});
symbols.forEach((s, i) => {
  const p = pool[s] ? parse(pool[s]) : null;
  const q = quotes[s] ? parse(quotes[s]) : null;
  console.log(`${s}: price pool ${p ? `yes (row age ${age(p.at)})` : "NO"}; Tiingo quote pool ${q ? `yes (age ${age(q.at)})` : "no"}; Tiingo EOD history ${eodHas[i] ?? "no"}`);
});
// Do the pool adds leak into Pickers or the warm targets? (#553 COWORK #85)
const parse2 = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const pickers = new Set((parse2(await redis.get("msh:pickers:v10:symbols")) ?? []).map(String));
console.log(`in the Pickers symbol list (${pickers.size}): ${symbols.filter((s) => pickers.has(s)).join(", ") || "none"}`);
// The fresh key has a 30-minute TTL (lib/server/warmTargets.ts), so between
// warm runs it reads empty; the 7-day last-good copy is the durable list.
for (const key of ["msh:warm-targets:v1", "msh:warm-targets:v1:last-good"]) {
  const wt = parse2(await redis.get(key));
  const targets = new Set(((wt && wt.symbols) || []).map(String));
  const built = wt && Number.isFinite(wt.builtAt) ? `, built ${age(wt.builtAt)} ago` : "";
  console.log(`in the warm targets ${key} (${targets.size}${built}): ${symbols.filter((s) => targets.has(s)).join(", ") || "none"}`);
}
console.log(`Redis commands: 6 (read-only)`);
