// The tickers the Tiingo verification probe checks (Relay B, #553 COWORK #49):
// the price pool's symbols unioned with the Pickers universe. Read-only.
// Prints TICKERS ONLY (public symbols, no data), as one comma-separated line
// to paste into the tiingo-verify dispatch's `symbols` input -- the Tiingo job
// holds no Redis credential, so it cannot read these itself.
//
//   relay task: write-universe-tickers
//   Redis: HKEYS msh:price-pool:v1 + GET msh:pickers:v10:symbols = 2, once.
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const pool = ((await redis.hkeys("msh:price-pool:v1")) ?? []).map(String);
const raw = await redis.get("msh:pickers:v10:symbols");
const list = Array.isArray(raw) ? raw : Array.isArray(raw?.symbols) ? raw.symbols : [];
const pickers = list.map((x) => String(typeof x === "string" ? x : x?.symbol ?? "")).filter(Boolean);
const clean = (s) => s.trim().toUpperCase();
const union = [...new Set([...pool, ...pickers].map(clean).filter(Boolean))].sort();
console.log(`price pool ${pool.length}; pickers universe ${pickers.length}; union ${union.length}`);
console.log(`TICKERS=${union.join(",")}`);
console.log("Redis commands: 2 (read-only)");
