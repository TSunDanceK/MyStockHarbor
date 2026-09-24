// THE CAPEX SPENDING RECORD'S UNPLACED NAMES (#552 COWORK #35): symbols only.
// Reads only.  relay task: write-capex-unplaced-list.  Redis cost: 1 GET.
import { Redis } from "@upstash/redis";
const redis = Redis.fromEnv();
const rec = await redis.get("msh:capex:spending:v1");
const u = Array.isArray(rec?.unplaced) ? rec.unplaced : [];
console.log(`UNPLACED ${u.length}: ${u.map((x) => (typeof x === "string" ? x : x?.symbol ?? JSON.stringify(x))).join(",")}`);
console.log("Redis commands: 1");
