// READ-ONLY: WHAT WROTE BETWEEN 07:12 AND 07:27 UTC ON 1 OCT? (#553 COWORK #84)
// Pickers builds are dated by their build-scoped chunk keys (buildId is a base-36
// timestamp, chunks live 26 h); each build's chunk and manifest sizes are STRLENs.
// Plus today's build-trigger counts and the run records of the jobs near the
// window. Keys, sizes, counts and times only.
//
//   relay task: write-window-probe
import "./lib/register-ts-here.mjs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
let commands = 0;
const call = async (fn) => { commands++; return fn(); };
const iso = (ms) => new Date(ms).toISOString().slice(0, 19) + "Z";

async function scanAll(match) {
  const out = [];
  let cursor = "0";
  do {
    const [next, keys] = await call(() => redis.scan(cursor, { match, count: 1000 }));
    cursor = String(next);
    out.push(...keys);
  } while (cursor !== "0");
  return out;
}

console.log("1. PICKERS BUILDS IN THE LAST 26 H (from build-scoped chunk keys)");
const chunks = await scanAll("msh:pickers:v10:chunk:*");
const builds = new Map();
for (const k of chunks) {
  const id = k.split(":")[4];
  if (!builds.has(id)) builds.set(id, []);
  builds.get(id).push(k);
}
const rows = [];
for (const [id, keys] of builds) {
  const p = redis.pipeline();
  for (const k of keys) p.strlen(k);
  commands += keys.length;
  const lens = (await p.exec()).map(Number);
  const at = parseInt(id.split("-")[0], 36);
  rows.push({ at, n: keys.length, max: Math.max(...lens), total: lens.reduce((a, b) => a + b, 0) });
}
rows.sort((a, b) => a.at - b.at);
for (const r of rows) {
  const inWindow = r.at >= Date.parse("2026-10-01T07:05:00Z") && r.at <= Date.parse("2026-10-01T07:30:00Z");
  console.log(`  ${iso(r.at)}${inWindow ? "  <-- 07:05-07:30" : ""}: ${r.n} chunks, largest ${r.max} B, total ${r.total} B`);
}
for (const key of ["msh:pickers:v10:manifest", "msh:pickers:v10:manifest:last-good", "msh:pickers:v10:symbols", "msh:pickers:v9:charts-off-payload"]) {
  const len = await call(() => redis.strlen(key));
  const ttl = await call(() => redis.ttl(key));
  console.log(`  ${key}: STRLEN ${len}, TTL ${ttl}`);
}

console.log("\n2. BUILD TRIGGERS, 2026-10-01 (env|phase|entry|reason: count)");
const trig = (await call(() => redis.hgetall("msh:pickers-build-triggers:v1:2026-10-01"))) ?? {};
for (const [k, v] of Object.entries(trig).sort()) console.log(`  ${k}: ${v}`);

console.log("\n3. LAST RUN RECORDS");
for (const job of ["warm-picker-universe", "warm-earnings", "warm-fundamentals", "warm-pickers-sec", "warm-screener-fundamentals", "warm-stock-data"]) {
  const r = await call(() => redis.get(`msh:job-run:v1:${job}`));
  const run = typeof r === "string" ? JSON.parse(r) : r;
  if (!run) { console.log(`  ${job}: no record`); continue; }
  const s = run.summary ?? {};
  const pick = Object.fromEntries(Object.entries(s).filter(([k]) => /status|universe|payload|written|ms|degraded|refresh|symbols|commands|skipped|error/i.test(k)).slice(0, 10));
  console.log(`  ${job}: ${iso(run.at)} ok=${run.ok} ${JSON.stringify(pick)}`);
}

console.log("\n4. PAGE-TRIGGERED BUILDERS (1 h TTL keys)");
for (const key of ["msh:plays:v5:main", "msh:bull-flags:v1:main", "msh:descending-triangles:v4:main"]) {
  const ttl = await call(() => redis.ttl(key));
  const len = await call(() => redis.strlen(key));
  console.log(`  ${key}: ${ttl < 0 ? "absent/no TTL" : `written ~${iso(Date.now() - (3600 - ttl) * 1000)}`}, STRLEN ${len}`);
}
console.log(`\nRedis: ${commands} read commands`);
