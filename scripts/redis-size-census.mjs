// UPSTASH 10 MB REQUEST LIMIT: WHO COULD HIT IT (#553 COWORK #82). Read-only.
//
// 1. DRY FORCED BUILDS of the three plays builders (plays, bull flags,
//    descending triangles). The real getXData(..., { forceRefresh: true })
//    runs; every Redis WRITE is answered with a synthetic OK and never sent,
//    and its request body is measured -- the body is exactly what Upstash's
//    10 MB limit applies to. Reads go to Redis as usual.
// 2. LIVE KEYS: for the builders' keys and the second list (benchmarks, sector
//    performance and breadth, capex x3, secListing's two keys), the stored
//    size and the exact request a rewrite of that value would send
//    (JSON.stringify of the command, as @upstash/redis sends it). A rejected
//    write leaves the old value, so the live size is a floor, not proof.
//
// PUBLIC LOG: keys, byte counts, counts and timestamps only.
//
//   node scripts/redis-size-census.mjs
import { register } from "node:module";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/next-server-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);

delete process.env.FMP_API_KEY; // no FMP refetch on a history miss
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.error("FATAL: needs the Upstash credentials (write- relay job).");
  process.exit(2);
}

const LIMIT = 10 * 1024 * 1024;
const READ_VERBS = new Set([
  "GET", "MGET", "HGET", "HMGET", "HGETALL", "HKEYS", "HLEN", "HEXISTS", "SMEMBERS", "SISMEMBER", "SCARD",
  "ZRANGE", "ZREVRANGE", "ZRANGEBYSCORE", "ZREVRANGEBYSCORE", "ZSCORE", "ZCARD", "EXISTS", "TTL", "PTTL",
  "STRLEN", "TYPE", "LRANGE", "LLEN", "GETRANGE", "SCAN", "HSTRLEN",
]);
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
const meter = { reads: 0, faked: 0 };
let writes = []; // { verb, key, bytes }
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith(UPSTASH)) return realFetch(input, init);
  const raw = typeof init?.body === "string" ? init.body : "";
  let body = null;
  try { body = JSON.parse(raw); } catch { body = null; }
  const pipeline = Array.isArray(body) && Array.isArray(body[0]);
  const cmds = pipeline ? body : Array.isArray(body) ? [body] : [];
  const isWrite = cmds.some((c) => !READ_VERBS.has(String(c?.[0] ?? "").toUpperCase()));
  if (!isWrite) {
    meter.reads += cmds.length || 1;
    return realFetch(input, init);
  }
  // A WRITE: measured, never sent. The whole request is what the limit sees.
  meter.faked += cmds.length;
  const key = cmds.map((c) => `${String(c[0]).toUpperCase()} ${String(c[1] ?? "")}`).join(" | ").slice(0, 120);
  writes.push({ key, bytes: Buffer.byteLength(raw), pipeline, n: cmds.length });
  const ok = (c) => {
    const v = String(c?.[0] ?? "").toUpperCase();
    return { result: v === "SET" || v === "MSET" ? "OK" : v === "EVAL" || v === "EVALSHA" ? null : 1 };
  };
  const out = pipeline ? cmds.map(ok) : ok(cmds[0]);
  return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
};

const { Redis } = await import("@upstash/redis");
const redis = Redis.fromEnv();
const fmt = (b) => `${(b / 1024 / 1024).toFixed(2)} MB (${((b / LIMIT) * 100).toFixed(1)}% of 10 MB)`;

// ── 1. dry forced builds ────────────────────────────────────────────────────
const BUILDERS = [
  { name: "plays", file: "../lib/server/playsBuilder.ts", fn: "getPlaysData", key: "msh:plays:v5:main" },
  { name: "bull-flags", file: "../lib/server/bullFlagsBuilder.ts", fn: "getBullFlagsData", key: "msh:bull-flags:v1:main" },
  { name: "desc-tri", file: "../lib/server/descendingTrianglesBuilder.ts", fn: "getDescendingTrianglesData", key: "msh:descending-triangles:v4:main" },
];
console.log("1. DRY FORCED BUILDS (writes measured, never sent)");
for (const b of BUILDERS) {
  writes = [];
  const t = Date.now();
  try {
    const mod = await import(new URL(b.file, import.meta.url).href);
    const res = await mod[b.fn]("https://www.mystockharbor.com", { forceRefresh: true });
    const data = res?.data ?? {};
    const sections = Array.isArray(data.sections) ? data.sections : [];
    const items = sections.flatMap((s) => (Array.isArray(s.items) ? s.items : []));
    const pts = items.map((i) => (Array.isArray(i.chartPoints) ? i.chartPoints.length : 0));
    const symbols = new Set(items.map((i) => i.symbol)).size;
    const payloadBytes = Buffer.byteLength(JSON.stringify({ cachedAt: Date.now(), data }));
    const main = writes.filter((w) => w.key.includes(b.key) && !w.key.includes(":lock")).sort((x, y) => y.bytes - x.bytes)[0];
    console.log(`  ${b.name}: universe ${data.universeSize ?? "?"}, sections ${sections.length}, items ${items.length}, symbols ${symbols}, chart points/item max ${pts.length ? Math.max(...pts) : 0} median ${pts.length ? pts.sort((x, y) => x - y)[Math.floor(pts.length / 2)] : 0} (${Date.now() - t} ms)`);
    console.log(`    payload JSON ${fmt(payloadBytes)}; the SET request for ${b.key}: ${main ? fmt(main.bytes) : "NOT ATTEMPTED"}`);
    const big = writes.filter((w) => w !== main).sort((x, y) => y.bytes - x.bytes).slice(0, 3);
    for (const w of big) console.log(`    other write: ${w.key} — ${w.bytes} bytes${w.pipeline ? ` (pipeline of ${w.n})` : ""}`);
  } catch (err) {
    console.log(`  ${b.name}: build threw (${err instanceof Error ? err.message.slice(0, 160) : "error"}) (${Date.now() - t} ms)`);
  }
}

// ── 2. live keys ────────────────────────────────────────────────────────────
async function scanAll(match) {
  const out = [];
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, { match, count: 500 });
    cursor = String(next);
    out.push(...keys);
  } while (cursor !== "0");
  return out.sort();
}
const live = [
  ...BUILDERS.map((b) => b.key),
  ...(await scanAll("msh:benchmarks:*")),
  "msh:sector-performance:v2",
  ...(await scanAll("msh:sector-breadth:v1:*")),
  "msh:capex:spending:v1",
  "msh:capex:contracts:v1",
  "msh:capex:receivers:v1",
  "msh:universe:sec-cik:v1",
  "msh:universe:sec-changes:v1",
];
console.log("\n2. LIVE KEYS (stored size, and the request a rewrite of that value sends)");
for (const key of live) {
  const type = await redis.type(key);
  if (type === "none") { console.log(`  ${key}: ABSENT`); continue; }
  const ttl = await redis.ttl(key);
  if (type === "string") {
    const len = await redis.strlen(key);
    const raw = await redis.get(key);
    const req = Buffer.byteLength(JSON.stringify(["SET", key, typeof raw === "string" ? raw : JSON.stringify(raw)]));
    const at = raw && typeof raw === "object" ? raw.cachedAt ?? raw.at ?? raw.updatedAt ?? raw.builtAt : undefined;
    const age = Number.isFinite(Number(at)) ? `${((Date.now() - Number(at)) / 3_600_000).toFixed(1)} h` : typeof at === "string" ? at : "-";
    console.log(`  ${key}: string, STRLEN ${len}, rewrite request ${fmt(req)}, TTL ${ttl}, written ${age}`);
  } else if (type === "hash") {
    const all = (await redis.hgetall(key)) ?? {};
    const fields = Object.keys(all).length;
    const req = Buffer.byteLength(JSON.stringify(["HSET", key, ...Object.entries(all).flatMap(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])]));
    console.log(`  ${key}: hash, ${fields} fields, full-map HSET request ${fmt(req)}, TTL ${ttl}`);
  } else {
    console.log(`  ${key}: ${type}, TTL ${ttl}`);
  }
}
console.log(`\nRedis: ${meter.reads} read commands sent; ${meter.faked} write commands measured and NOT sent.`);
process.exit(0);
