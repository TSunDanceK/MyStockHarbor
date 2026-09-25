// One-time: fold dotted price-pool fields into their dashed field (#553 COWORK #53).
//
// The pool now keys every field by the dashed spelling (pricePool.poolField).
// Fields written under a dotted spelling before that are orphans: BRK.B's row
// was 656 h old on 2026-09-25 while BRK-B was refreshed every run. For each
// dotted field: if the dashed field exists, HDEL the dotted one; if it does not,
// copy the row across first, then HDEL. Prints every pair's row ages before,
// and the count of dotted fields left after (must be 0).
//
// DRY RUN unless --apply.
//   relay tasks: write-pool-spelling-migrate-dry, write-pool-spelling-migrate
//   Redis: HKEYS + HMGET (+ HSET if a dashed row is missing) + HDEL + HKEYS
//          = 4-5 commands, once.
import { Redis } from "@upstash/redis";
import { toDashed } from "../lib/symbolSpellings.mjs";

const KEY = "msh:price-pool:v1";
const apply = process.argv.includes("--apply");
const redis = Redis.fromEnv();
let commands = 0;
const age = (r) => (r && typeof r === "object" && r.ts ? `${Math.round((Date.now() - r.ts) / 3.6e6)} h` : "none");

const keys = ((await redis.hkeys(KEY)) ?? []).map(String);
commands++;
const dotted = keys.filter((k) => k.includes("."));
console.log(`pool fields ${keys.length}; dotted fields ${dotted.length}${dotted.length ? `: ${dotted.join(", ")}` : ""}`);
if (!dotted.length) {
  console.log(`nothing to do. Redis commands: ${commands}`);
  process.exit(0);
}
const both = dotted.flatMap((d) => [d, toDashed(d)]);
const got = await redis.hmget(KEY, ...both);
commands++;
const rowOf = (f, i) => (Array.isArray(got) ? got[i] : got?.[f]) ?? null;
const copies = {};
dotted.forEach((d, i) => {
  const dash = toDashed(d);
  const dr = rowOf(d, 2 * i), sr = rowOf(dash, 2 * i + 1);
  console.log(`before: ${d} row age ${age(dr)} | ${dash} row age ${age(sr)}${sr ? "" : " (missing: will copy)"}`);
  if (!sr && dr) copies[dash] = dr;
});
if (!apply) {
  console.log(`DRY RUN: would copy ${Object.keys(copies).length} row(s) and HDEL ${dotted.length} dotted field(s). Redis commands: ${commands}`);
  process.exit(0);
}
if (Object.keys(copies).length) { await redis.hset(KEY, copies); commands++; }
const removed = await redis.hdel(KEY, ...dotted);
commands++;
const after = ((await redis.hkeys(KEY)) ?? []).map(String).filter((k) => k.includes("."));
commands++;
console.log(`applied: copied ${Object.keys(copies).length}, removed ${removed}; dotted fields left: ${after.length}. Redis commands: ${commands}`);
process.exit(after.length ? 1 : 0);
