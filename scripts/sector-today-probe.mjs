// Why does a sector's "Sector today" read "--"? READ-ONLY. #553 COWORK #12.
//
// Mirrors buildSectorPerformance (lib/server/sectorPanels.ts): the top 25 names
// of each sector from msh:sector-index:v1, their price-pool rows, and the 30-min
// freshness gate that decides whether a name counts toward `day`. Also prints the
// cached table the page is serving right now (msh:sector-performance:v1).
//   relay task: write-sector-today-probe
//   Redis cost: 3 GETs + 1 TTL + 1 HMGET (275 fields) = 5 commands, once.
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const SAMPLE = 25;
const MAX_AGE_MS = 30 * 60 * 1000;
const now = Date.now();

const [index, table, health] = await Promise.all([
  redis.get("msh:sector-index:v1"),
  redis.get("msh:sector-performance:v1"),
  redis.get("msh:pricepool:session-health:v1"),
]);
const ttl = await redis.ttl("msh:sector-performance:v1");
if (!index?.bySlug) throw new Error("msh:sector-index:v1 missing");
const age = (ms) => (ms == null ? "-" : `${Math.round(ms / 60000)}m`);
console.log(`now ${new Date(now).toISOString()} · index built ${age(now - index.builtAt)} ago · classified ${index.classified}/${index.total}`);
console.log(`cached table built ${table ? age(now - table.builtAt) : "-"} ago (ttl ${ttl}s)`);
console.log(`pool session health: ${JSON.stringify(health)}\n`);

const bySlug = Object.fromEntries(Object.entries(index.bySlug).map(([k, v]) => [k, v.slice(0, SAMPLE)]));
const all = [...new Set(Object.values(bySlug).flat())];
const raw = await redis.hmget("msh:price-pool:v1", ...all);
const pool = new Map();
all.forEach((s, i) => {
  let r = Array.isArray(raw) ? raw[i] : raw?.[s];
  if (typeof r === "string") try { r = JSON.parse(r); } catch { r = null; }
  if (r && typeof r === "object") pool.set(s, r);
});

console.log("sector | names | in pool | fresh ≤30m | pool age min/median/max | cached day / rank | stale examples");
for (const [slug, syms] of Object.entries(bySlug)) {
  const ages = syms.map((s) => pool.get(s)).filter(Boolean).map((r) => now - r.ts).sort((a, b) => a - b);
  const fresh = syms.filter((s) => { const r = pool.get(s); return r && now - r.ts <= MAX_AGE_MS && typeof r.changePct === "number"; });
  const row = table?.rows?.find((r) => r.slug === slug);
  const stale = syms.filter((s) => !fresh.includes(s)).slice(0, 6).map((s) => `${s}:${pool.has(s) ? age(now - pool.get(s).ts) : "absent"}`);
  console.log(`${slug} | ${syms.length} | ${ages.length} | ${fresh.length} | ${age(ages[0])}/${age(ages[Math.floor(ages.length / 2)])}/${age(ages[ages.length - 1])} | ${row?.day == null ? "--" : row.day.toFixed(2) + "%"} / ${row?.rank ?? "-"} (sampled ${row?.sampled ?? "-"}) | ${stale.join(" ")}`);
}
console.log("\nRedis commands used: 5 (read-only)");
