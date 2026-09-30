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
const eod = await redis.pipeline();
for (const s of symbols) eod.exists(`msh:tiingo:eod:v2:${s}`);
const eodHas = await eod.exec();
symbols.forEach((s, i) => {
  const p = pool[s] ? parse(pool[s]) : null;
  const q = quotes[s] ? parse(quotes[s]) : null;
  console.log(`${s}: price pool ${p ? `yes (row age ${age(p.at)})` : "NO"}; Tiingo quote pool ${q ? `yes (age ${age(q.at)})` : "no"}; Tiingo EOD history ${eodHas[i] ? "yes" : "no"}`);
});
console.log(`Redis commands: ${2 + symbols.length} (read-only)`);
