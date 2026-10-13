// THE #856 24 H METER LINE (#553 COWORK #225). READ-ONLY, ENFORCED.
//
// Reads the bandwidth meter's day hashes (msh:redis-units:v1:<YYYYMMDD>) for
// the UTC days given (default: today and yesterday) and prints, per source and
// per caller, reads, units and the bytes derived from the per-unit constants.
// HGETALL only, one command per day. The log carries counts and sizes only.
//
//   node scripts/redis-meter-day.mjs [YYYYMMDD ...]   (relay: write-redis-meter-day)
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }
const READ_VERBS = new Set(["HGETALL"]);
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
const redis = (await import("@upstash/redis")).Redis.fromEnv({ automaticDeserialization: false });

// Copied from BYTES_PER_UNIT in lib/server/redisBandwidth.ts on 2026-10-13
// (importing it would pull in the app's Redis client).
const BYTES_PER_UNIT = {
  "picker-payload": 3_329, "picker-symbols": 9, "picker-charts": 10_963,
  "history-single": 109_962, "history-bulk": 109_962, "price-pool": 220,
  "tiingo-eod": 71_300, "tiingo-pool": 92, "tiingo-eod-last": 174,
  "sec-facts": 17_400, news: 32_300, "sec-fundamentals": 1_013,
};
const asObj = (h) => (Array.isArray(h) ? Object.fromEntries(Array.from({ length: h.length / 2 }, (_, i) => [h[2 * i], h[2 * i + 1]])) : h ?? {});
const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
const days = process.argv.slice(2).length ? process.argv.slice(2) : [ymd(Date.now()), ymd(Date.now() - 86_400_000)];

console.log(`read at ${new Date().toISOString()}`);
for (const day of days) {
  const h = asObj(await redis.hgetall(`msh:redis-units:v1:${day}`));
  const rows = new Map(); // source -> caller -> {reads, units}
  for (const [k, v] of Object.entries(h)) {
    const p = k.split(":");
    if (p.length !== 3 || !(p[0] in BYTES_PER_UNIT) || /^h\d{2}$/.test(p[1]) || !["units", "reads"].includes(p[2])) continue;
    const bySrc = rows.get(p[0]) ?? new Map();
    const r = bySrc.get(p[1]) ?? { reads: 0, units: 0 };
    r[p[2]] += Number(v) || 0;
    bySrc.set(p[1], r);
    rows.set(p[0], bySrc);
  }
  let total = 0;
  const lines = [];
  for (const [src, bySrc] of rows) {
    let sr = 0, su = 0;
    for (const r of bySrc.values()) { sr += r.reads; su += r.units; }
    const bytes = su * BYTES_PER_UNIT[src];
    total += bytes;
    const callers = [...bySrc].sort((a, b) => b[1].units - a[1].units)
      .map(([c, r]) => `${c} ${r.reads}r/${r.units}u/${mb(r.units * BYTES_PER_UNIT[src])}`).join(" · ");
    lines.push([bytes, `  ${src}: ${sr} reads · ${su} units · ${mb(bytes)}\n      ${callers}`]);
  }
  console.log(`\n== ${day} (UTC day; ${Object.keys(h).length} fields) total ≈ ${mb(total)}`);
  for (const [, l] of lines.sort((a, b) => b[0] - a[0])) console.log(l);
}
console.log(`\nRedis commands ${commands} (read-only)`);
