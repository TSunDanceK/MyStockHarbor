// THE PICKERS UNIVERSE, RANKED BY SIZE, for placing its unclassified names
// (#552 COWORK #29). Prints each Pickers symbol with its rank by market cap
// computed from SEC cover shares x the pool's price. Ranks only: no price and
// no cap value is printed. Reads only.
//   relay task: write-pickers-universe-rank
//   Redis cost: 1 GET + 1 HKEYS-free HMGET per 100 + 1 MGET per 25 ≈ 36 commands.
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
let commands = 0;
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const SYMBOLS_KEY = keyOf("lib/server/pickersBuilder.ts", "PICKERS_SYMBOLS_KEY");
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
commands++;
const u = ((await redis.get(SYMBOLS_KEY)) ?? []).map((s) => String(s).toUpperCase());
const price = new Map(), shares = new Map();
for (let i = 0; i < u.length; i += 100) {
  const chunk = u.slice(i, i + 100);
  commands++;
  const rows = await redis.hmget("msh:price-pool:v1", ...chunk);
  chunk.forEach((s, j) => { const p = Array.isArray(rows) ? rows[j] : rows?.[s]; if (typeof p?.price === "number") price.set(s, p.price); });
}
for (let i = 0; i < u.length; i += 25) {
  const chunk = u.slice(i, i + 25);
  commands++;
  const vals = await redis.mget(...chunk.map((s) => `${FACTS}:${s}`));
  chunk.forEach((s, j) => { const c = vals[j]?.cover; if (typeof c?.val === "number") shares.set(s, c.val); });
}
const capped = u.filter((s) => price.has(s) && shares.has(s)).sort((a, b) => price.get(b) * shares.get(b) - price.get(a) * shares.get(a));
const rank = new Map(capped.map((s, i) => [s, i + 1]));
console.log(`pickers universe ${u.length}; ranked ${capped.length}`);
console.log(`RANKED ${u.map((s) => `${s}:${rank.get(s) ?? "-"}`).join(" ")}`);
console.log(`Redis commands used by this read: ${commands}`);
