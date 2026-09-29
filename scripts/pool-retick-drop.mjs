// DROP RETICKERED SYMBOLS FROM THE PRICE POOL (#553 COWORK #70).
//
// BK and EQR outlived their CIKs' move to BNY and VMRK as price-pool fields.
// The Tiingo universe already skips them by rule (retickeredOut), but the
// fields are dead rows. This finds them with the SAME rule -- the pool's
// fields, SEC's committed ticker file and the rename sweep's last-seen CIKs --
// and, with --apply, deletes exactly those fields. Dry run by default.
//
//   relay tasks: write-pool-retick-drop-dry   (prints, deletes nothing)
//                write-pool-retick-drop       (--apply; only on the owner's OK)
//   Redis: 1 HKEYS + 1 HMGET (+ 1 HDEL with --apply) = 2-3, once.
import "./lib/register-capex-ts.mjs";
import { Redis } from "@upstash/redis";

if (!process.argv.includes("--allow-writes")) {
  console.error("FATAL: write task invoked without --allow-writes; refusing.");
  process.exit(2);
}
const apply = process.argv.includes("--apply");
const U = await import("../lib/server/marketData/universe.ts");
const { loadTickerMap } = await import("../lib/server/secTickerMap.ts");
const { LAST_SEEN_CIK_KEY } = await import("../lib/server/secListing.ts");
const { lookupBySpelling } = await import("../lib/symbolSpellings.mjs");
const POOL_KEY = "msh:price-pool:v1";

const redis = Redis.fromEnv();
const fields = ((await redis.hkeys(POOL_KEY)) ?? []).map(String);
const live = loadTickerMap();
if (!live.present) {
  console.log(`no ticker map (${live.error ?? "absent"}): nothing judged, nothing deleted`);
  process.exit(1);
}
const unlisted = fields.filter((s) => !lookupBySpelling(live.map, s));
const raw = unlisted.length ? await redis.hmget(LAST_SEEN_CIK_KEY, ...unlisted) : [];
const lastSeen = new Map();
unlisted.forEach((s, i) => {
  const v = Array.isArray(raw) ? raw[i] : raw?.[s];
  if (v != null && /^\d{10}$/.test(String(v))) lastSeen.set(s, String(v));
});
const r = U.retickeredOut(fields, live, lastSeen);
console.log(`pool fields ${fields.length}; not in SEC's ticker file ${unlisted.length} (with a last-seen CIK ${lastSeen.size})`);
console.log(`retickered: ${r.dropped.length ? r.dropped.map((d) => `${d.symbol} -> ${d.listed.join("/")}`).join(", ") : "none"}`);
if (!apply || !r.dropped.length) {
  console.log(apply ? "nothing to delete" : "dry run: nothing deleted");
  process.exit(0);
}
const n = await redis.hdel(POOL_KEY, ...r.dropped.map((d) => d.symbol));
console.log(`deleted ${n} field(s) from the price pool`);
process.exit(0);
