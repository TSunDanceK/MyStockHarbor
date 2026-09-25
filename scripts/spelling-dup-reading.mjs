// Dot/dash duplicates in the price pool (#553 COWORK #51 item 4). Read-only.
// For each pair (BRK.B/BRK-B, BF.B/BF-B, and any other dotted/dashed pair in
// the pool), prints whether each spelling has a pool row and how old its ts
// is, and which spelling the Pickers universe and tier-1 lists carry.
//   relay task: write-spelling-dup-reading
//   Redis: HKEYS pool + HMGET pool + GET pickers symbols + GET tier1 = 4.
import { Redis } from "@upstash/redis";
const redis = Redis.fromEnv();
const keys = ((await redis.hkeys("msh:price-pool:v1")) ?? []).map(String);
const set = new Set(keys);
const pairs = [];
for (const k of keys) if (k.includes(".")) { const d = k.replace(/\./g, "-"); if (set.has(d)) pairs.push([k, d]); }
const flat = pairs.flat();
const rows = flat.length ? await redis.hmget("msh:price-pool:v1", ...flat) : {};
const get = (s, i) => (Array.isArray(rows) ? rows[i] : rows?.[s]);
const pick = await redis.get("msh:pickers:v10:symbols");
const pickList = new Set((Array.isArray(pick) ? pick : []).map(String));
const tier1 = await redis.get("msh:price-tier1:v1");
const t1 = new Set((Array.isArray(tier1) ? tier1 : Array.isArray(tier1?.symbols) ? tier1.symbols : []).map((x) => String(x?.symbol ?? x)));
const age = (r) => (r && typeof r === "object" && r.ts ? `${Math.round((Date.now() - r.ts) / 3.6e6)}h` : "no row/ts");
console.log(`pool fields ${keys.length}; dot/dash duplicate pairs ${pairs.length}`);
pairs.forEach(([dot, dash], i) => {
  console.log(`${dot}: row age ${age(get(dot, 2 * i))}, pickers ${pickList.has(dot)}, tier1 ${t1.has(dot)} | ${dash}: row age ${age(get(dash, 2 * i + 1))}, pickers ${pickList.has(dash)}, tier1 ${t1.has(dash)}`);
});
console.log("Redis commands: 4 (read-only)");
