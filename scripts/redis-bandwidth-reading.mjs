// A FRESH REDIS BANDWIDTH READING (#553 COWORK #191/#194, the 750 proposal).
// READ-ONLY, ENFORCED (HGETALL, GET). Calls the /cache-health panel's own
// reader, readRedisBandwidth(7): the last 7 day-hashes, projected to 30 days,
// the figure lib/server/redisBandwidth.ts records as REDIS_PROJECTION_MEASURED_*.
// Then what that reading projects at 750 and at the affordable cap, through
// the file's own functions.
//
// PUBLIC LOG: byte totals and caller names only.
//
//   node scripts/redis-bandwidth-reading.mjs   (relay: write-redis-bandwidth-reading)
import { register } from "node:module";
register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }
const READ_VERBS = new Set(["HGETALL", "GET"]);
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
const B = await import("../lib/server/redisBandwidth.ts");
const GB = 1024 ** 3;
const rep = await B.readRedisBandwidth(7);
const universe = JSON.parse(JSON.stringify((await (await import("@upstash/redis")).Redis.fromEnv().get("msh:pickers:v10:symbols")) ?? []));
console.log(`window 7 days, missing ${rep.daysMissing} · total ${(rep.totalBytes / GB).toFixed(2)} GB · ${(rep.bytesPerDay / GB).toFixed(3)} GB/day · projected ${(rep.projectedMonthBytes / GB).toFixed(2)} GB/month of ${(rep.capBytes / GB).toFixed(0)} GB (${((rep.projectedMonthBytes / rep.capBytes) * 100).toFixed(1)}%)`);
console.log(`recorded measurement: ${(B.REDIS_PROJECTION_MEASURED_BYTES / GB).toFixed(2)} GB/month at cap ${B.REDIS_PROJECTION_MEASURED_AT_CAP} on ${B.REDIS_PROJECTION_MEASURED_AT}; universe today ${Array.isArray(universe) ? universe.length : "?"}`);
for (const cap of [700, 750]) {
  const at = (rep.projectedMonthBytes * cap) / 700;
  console.log(`  linear at ${cap}: ${(at / GB).toFixed(2)} GB/month (${((at / rep.capBytes) * 100).toFixed(1)}% of plan)`);
}
console.log(`  affordable cap at this reading: ${B.redisAffordableUniverseCap(rep.projectedMonthBytes, 700, rep.capBytes)}`);
console.log(`top callers (7 days):`);
for (const r of rep.rows.slice(0, 8)) console.log(`  ${r.source} / ${r.caller}: ${(r.bytes / GB).toFixed(2)} GB`);
console.log(`\nRedis commands ${commands} (read-only)`);
