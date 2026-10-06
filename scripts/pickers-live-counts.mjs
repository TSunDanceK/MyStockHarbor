// THE LIVE OVERSOLD / OVERBOUGHT COUNTS AFTER #796 (#553 COWORK #173), and
// whether MS is in the pickers universe (#553 COWORK #177). READ-ONLY,
// ENFORCED (GET, MGET).
//
// Reads the current pickers manifest (msh:pickers:v10:manifest) and its chunks
// the way readPickersV10 does, and counts the records whose `oversold` /
// `overbought` flag is set: the sets /oversold-stocks-today and
// /overbought-stocks-today list. Then the universe key (msh:pickers:v10:symbols)
// for MS, MRSH and MMC.
//
// PUBLIC LOG (#553): counts, the build time and symbols only; never a price.
//
//   node scripts/pickers-live-counts.mjs   (relay: write-pickers-live-counts)
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }
const READ_VERBS = new Set(["GET", "MGET"]);
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
let commands = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    if (!cmds.length) throw new Error("census is read-only: refused a request with no readable command");
    for (const c of cmds) if (!READ_VERBS.has(String(c?.[0] ?? "").toUpperCase())) throw new Error(`census is read-only: refused ${c?.[0]}`);
    commands += cmds.length;
  }
  return realFetch(input, init);
};
const redis = (await import("@upstash/redis")).Redis.fromEnv();
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);

const manifest = parse(await redis.get("msh:pickers:v10:manifest"));
if (!manifest || !Array.isArray(manifest.chunkKeys)) { console.log("no current manifest"); process.exit(1); }
const records = [];
for (let i = 0; i < manifest.chunkKeys.length; i += 20) {
  const chunks = await redis.mget(...manifest.chunkKeys.slice(i, i + 20));
  for (const c of chunks) { const a = parse(c); if (!Array.isArray(a)) { console.log("a chunk is missing"); process.exit(1); } records.push(...a); }
}
console.log(`build ${new Date(manifest.cachedAt).toISOString()}: ${records.length} records (manifest says ${manifest.recordCount})`);
console.log(`  oversold:   ${records.filter((r) => r?.oversold === true).length}`);
console.log(`  overbought: ${records.filter((r) => r?.overbought === true).length}`);

const universe = parse(await redis.get("msh:pickers:v10:symbols"));
const list = Array.isArray(universe) ? universe : Array.isArray(universe?.symbols) ? universe.symbols : [];
console.log(`\nuniverse ${list.length}: ${["MS", "MRSH", "MMC"].map((s) => `${s} ${list.includes(s) ? "in" : "not in"}`).join(", ")}`);
console.log(`\nRedis commands ${commands} (read-only: GET, MGET)`);
