// WHAT MOVES THE UPSTASH BYTES (#553 COWORK #212 item 2). READ-ONLY, ENFORCED.
//
// Sizes only: STRLEN / HLEN / HSTRLEN / MEMORY USAGE, the manifest GET (its
// chunk list), HKEYS on the charts hash, and the bandwidth meter's own day
// hashes and the pickers build-trigger hash (counts). No value is printed;
// the log carries key names, byte sizes and counts only.
//
//   node scripts/redis-bytes-census.mjs   (relay: write-redis-bytes-census)
import { register } from "node:module";
register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }
const READ_VERBS = new Set(["GET", "STRLEN", "HLEN", "HSTRLEN", "HKEYS", "HGETALL"]);
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
// Literal names, each checked against its source constant on 2026-10-12
// (importing the builders would pull in next/server).
const PICKERS_MANIFEST_KEY = "msh:pickers:v10:manifest"; // pickersBuilder.ts
const PICKERS_BUILD_TRIGGERS_PREFIX = "msh:pickers-build-triggers:v1"; // pickersBuilder.ts
const PICKER_CHARTS_KEY = "msh:picker-charts:v1"; // pickerChartsCache.ts
const PICKERS_SEC_KEY = "msh:pickers:sec-fundamentals:v1"; // pickersSecFundamentals.ts
const PLAYS = "msh:plays:v5:main", FLAGS = "msh:bull-flags:v1:main", TRI = "msh:descending-triangles:v4:main";
const factKey = (s) => `msh:sec:facts:v1:${s.toUpperCase()}`; // secFactStore.ts SEC_FACTS_PREFIX
const { tiingoEodKey, TIINGO_QUOTES_KEY, TIINGO_EOD_LAST_KEY } = await import("../lib/server/marketData/keys.ts");

// automaticDeserialization:false makes HGETALL a flat [field, value, ...] array.
const asObj = (h) => (Array.isArray(h) ? Object.fromEntries(Array.from({ length: h.length / 2 }, (_, i) => [h[2 * i], h[2 * i + 1]])) : h ?? {});
const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;
const kb = (n) => `${(n / 1e3).toFixed(1)} KB`;

console.log("== 1. The pickers payload (what every picker-page regeneration reads)");
const manifestRaw = await redis.get(PICKERS_MANIFEST_KEY);
const manifest = typeof manifestRaw === "string" ? JSON.parse(manifestRaw) : manifestRaw;
const manifestBytes = await redis.strlen(PICKERS_MANIFEST_KEY);
let chunkBytes = 0;
for (const k of manifest?.chunkKeys ?? []) chunkBytes += await redis.strlen(k);
console.log(`  manifest ${mb(manifestBytes)} · ${manifest?.chunkKeys?.length ?? 0} chunks ${mb(chunkBytes)} · records ${manifest?.recordCount ?? "?"} · payload read = ${mb(manifestBytes + chunkBytes)}`);
const v9 = await redis.strlen("msh:pickers:v9:charts-off-payload");
console.log(`  v9 fallback payload ${mb(v9)}`);

console.log("\n== 2. The picker-charts hash (re-attached on every read)");
const fields = (await redis.hkeys(PICKER_CHARTS_KEY)) ?? [];
let sample = 0;
const step = Math.max(1, Math.floor(fields.length / 60));
const picked = fields.filter((_, i) => i % step === 0).slice(0, 60);
for (const f of picked) sample += await redis.hstrlen(PICKER_CHARTS_KEY, f);
const avg = picked.length ? sample / picked.length : 0;
console.log(`  fields ${fields.length} · avg ${kb(avg)} (sample ${picked.length}) · whole hash ≈ ${mb(avg * fields.length)}`);

console.log("\n== 3. Other large single keys");
for (const [label, key] of [["plays", PLAYS], ["bull flags", FLAGS], ["descending triangles", TRI]]) {
  console.log(`  ${label}: ${mb(await redis.strlen(key))}`);
}
for (const [label, key] of [["tiingo quotes (HGETALL)", TIINGO_QUOTES_KEY], ["tiingo eod-last (HGETALL)", TIINGO_EOD_LAST_KEY], ["pickers sec rows (HGETALL)", PICKERS_SEC_KEY]]) {
  const n = await redis.hlen(key);
  const fs = ((await redis.hkeys(key)) ?? []).slice(0, 30);
  let s = 0; for (const f of fs) s += await redis.hstrlen(key, f);
  console.log(`  ${label}: ${n} fields · avg ${fs.length ? kb(s / fs.length) : "?"} · whole ≈ ${fs.length ? mb((s / fs.length) * n) : "?"}`);
}

console.log("\n== 4. Per-symbol keys, sampled (the render-path reads)");
const SAMPLE = (process.env.SAMPLE || "AAPL MSFT NVDA AMZN GOOGL META TSLA JPM V WMT XOM JNJ PG KO PEP BKNG CEG NFLX AMD INTC").split(/\s+/);
for (const [label, keyOf] of [["tiingo eod v2", tiingoEodKey], ["sec facts v1", factKey], ["news v1", (s) => `msh:news:v1:${s}`], ["history v7 (FMP era)", (s) => `msh:history:v7:${s}`], ["stockdata v1 (FMP era)", (s) => `msh:stockdata:v1:${s}`]]) {
  const sizes = [];
  for (const s of SAMPLE) sizes.push(await redis.strlen(keyOf(s)));
  const present = sizes.filter((n) => n > 0);
  console.log(`  ${label}: ${present.length}/${SAMPLE.length} present · avg ${present.length ? kb(present.reduce((a, b) => a + b, 0) / present.length) : "–"} · max ${present.length ? kb(Math.max(...present)) : "–"}`);
}

console.log("\n== 5. The bandwidth meter's own counters, last 7 UTC days (units and reads per source)");
for (let i = 0; i < 7; i++) {
  const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10).replace(/-/g, "");
  const h = asObj(await redis.hgetall(`msh:redis-units:v1:${day}`));
  const bySource = {};
  for (const [k, v] of Object.entries(h)) {
    const m = /^([^:]+):(units|reads)$/.exec(k); // the per-source totals only
    if (!m) continue;
    const src = m[1];
    bySource[src] = bySource[src] ?? { units: 0, reads: 0 };
    bySource[src][m[2]] += Number(v) || 0;
  }
  const line = Object.entries(bySource).sort((a, b) => b[1].units - a[1].units).map(([s, x]) => `${s} ${x.reads}r/${x.units}u`).join(" · ");
  console.log(`  ${day}: ${line || "(none)"}`);
  if (i < 2) {
    const callers = Object.entries(h).filter(([k]) => /^picker-(charts|payload):[^:h][^:]*:reads$/.test(k)).map(([k, v]) => `${k.replace(/:reads$/, "")}=${v}`).join(" · ");
    if (callers) console.log(`      by caller (reads): ${callers}`);
  }
}

console.log("\n== 6. Pickers build triggers, last 3 days (builds, not reads)");
for (let i = 0; i < 3; i++) {
  const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
  const h = asObj(await redis.hgetall(`${PICKERS_BUILD_TRIGGERS_PREFIX}:${day}`));
  const total = Object.values(h).reduce((a, b) => a + (Number(b) || 0), 0);
  console.log(`  ${day}: ${total} build attempt(s) · ${Object.entries(h).map(([k, v]) => `${k}=${v}`).join(" ; ").slice(0, 400)}`);
}
console.log(`\nRedis commands ${commands} (read-only)`);
