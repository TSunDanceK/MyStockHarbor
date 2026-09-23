// How many items each sector news page would show on the free stack (#553
// COWORK #11: the #558 preview showed every sector empty). READ-ONLY.
//
// Runs the SHIPPED pure window (lib/server/news/sectorWindow.ts ->
// composeFreeSectorPools) over what production holds: the sector index
// (msh:sector-index:v1, top 40 per sector, as the page takes), one MGET of those
// constituents' per-symbol news records, and one live wire poll. Counts are
// after a link-level dedupe; the page's similarity dedup may collapse a few
// more. Also reports how many items each CURRENT sector record holds and how
// many of them are FMP-era (what the page's read filter drops).
//   relay task: write-sector-news-count   (~13 commands)
import "./lib/register-ts-here.mjs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const { composeFreeSectorPools, isFromActiveProvider } = await import("../lib/server/news/sectorWindow.ts");
const { wireProvider } = await import("../lib/server/news/wireProvider.ts");

const ACTIVE = new Set(["gnews", "wire", "sec"]);
let commands = 0;
const index = await redis.get("msh:sector-index:v1");
commands++;
if (!index?.bySlug) {
  console.log("no sector index in Redis (msh:sector-index:v1) -- nothing to count");
  process.exit(0);
}
const wire = await wireProvider.fetchMarket().catch(() => []);
console.log(`wire poll: ${wire.length} items\n`);
console.log("sector | constituents w/ a news record | free window items | current record: items / FMP-era");
for (const [slug, symbols] of Object.entries(index.bySlug)) {
  const top = symbols.slice(0, 40);
  const values = top.length ? await redis.mget(...top.map((s) => `msh:news:v1:${s.toUpperCase()}`)) : [];
  commands++;
  const stored = new Map();
  values.forEach((v, i) => { if (v && Array.isArray(v.items) && v.items.length) stored.set(top[i].toUpperCase(), v.items); });
  const pools = composeFreeSectorPools(top, stored, wire, ACTIVE);
  const links = new Set(pools.flat().map((i) => i.link));
  const rec = await redis.get(`msh:sector-news:v1:${slug}`);
  commands++;
  const held = Array.isArray(rec?.items) ? rec.items : [];
  const fmpEra = held.filter((i) => !isFromActiveProvider(i, ACTIVE, "free")).length;
  console.log(`${slug} | ${stored.size}/${top.length} | ${links.size} | ${held.length} / ${fmpEra}`);
}
console.log(`\nRedis commands used: ${commands} (read-only)`);
