// DOES A SYMBOL HAVE A CACHED VENDOR PROFILE ROW THAT OUTRANKS ITS SEC
// OVERRIDE? (#552 COWORK #58, BIP before #632). resolveProfile takes the
// cached fundamentals row's sector/industry first. This prints PRESENCE ONLY:
// whether the row exists, whether its sector / industry are set, its
// updatedAt and the key's TTL -- never the vendor's values.
//   relay task: write-cached-profile   Redis: 2 commands per symbol.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
const redis = Redis.fromEnv();
const PREFIX = (fs.readFileSync("lib/server/fundamentalsCache.ts", "utf8").match(/FUND_KEY_PREFIX = "([^"]+)"/) ?? [])[1];
if (!PREFIX) { console.error("FATAL: prefix not found"); process.exit(2); }
const syms = (process.env.SYMBOLS || "BIP").split(/[\s,]+/).filter(Boolean).slice(0, 10);
let n = 0;
for (const s of syms) {
  const row = await redis.get(`${PREFIX}${s}`); const ttl = await redis.ttl(`${PREFIX}${s}`); n += 2;
  console.log(`${s}: row ${row ? "PRESENT" : "absent"} · sector ${row?.sector ? "set" : "empty"} · industry ${row?.industry ? "set" : "empty"} · updatedAt ${row?.updatedAt ?? "-"} · ttl ${ttl}s`);
}
console.log(`Redis commands: ${n}`);
