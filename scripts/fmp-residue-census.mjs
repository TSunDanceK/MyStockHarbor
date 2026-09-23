// WHERE FMP DATA STILL SITS IN REDIS — B's area (#553 COWORK #5, 2026-09-23).
//
// Two questions, both read-only:
//   1. /stock/X/news: how many per-symbol news records (msh:news:v1:<SYM>) and
//      sector records (msh:sector-news:v1:<slug>) still hold FMP-era items --
//      items with provider "fmp" or no provider stamp at all (every free adapter
//      stamps one; the FMP paths before the stamp existed did not).
//   2. The cache-deletion plan for when FMP stops: every key PATTERN, by
//      prefix, with its key count and sampled TTLs. Which of them hold FMP
//      payloads is annotated from the code (lib/server/*), not guessed from
//      the key name alone.
//
// COST: one full SCAN (COUNT 1000 per call), 3 TTLs per prefix, one MGET per 50
// news records. Nothing is written.
//   relay task: write-fmp-residue-census (READ-ONLY despite the prefix: the
//   credentials live in that job)
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
let commands = 0;

// ─────────────────────────────────────────────── 1. the whole keyspace, by prefix
const buckets = new Map();
const newsKeys = [];
const sectorKeys = [];
let cursor = "0";
do {
  const [next, keys] = await redis.scan(cursor, { count: 1000 });
  commands++;
  cursor = String(next);
  for (const key of keys) {
    const parts = key.split(":");
    // msh:<area>:<version> is the pattern; deeper segments are per-symbol.
    const prefix = parts.slice(0, Math.min(parts.length - 1 || 1, 4)).join(":");
    const b = buckets.get(prefix) ?? { n: 0, sample: [] };
    b.n++;
    if (b.sample.length < 3) b.sample.push(key);
    buckets.set(prefix, b);
    if (/^msh:news:v1:[A-Z0-9.\-]+$/.test(key)) newsKeys.push(key);
    if (/^msh:sector-news:v1:[a-z-]+$/.test(key)) sectorKeys.push(key);
  }
} while (cursor !== "0");

const FMP_NOTE = {
  "msh:news:v1": "per-symbol news store — FMP-era items counted below",
  "msh:sector-news:v1": "sector news store — FMP items until #558's first refresh purges them",
  "msh:stockdata:v1": "FMP ratios-ttm/income/cash-flow/dividends/analyst rows (warm-stock-data)",
  "msh:pickers:fundamentals:v1": "FMP quote/profile marketCap, PE, sector, industry (warm-fundamentals)",
  "msh:pickers:profile:v1": "FMP /stable/profile (warm-fundamentals)",
  "msh:pickers:profile-noindustry:v1": "marker for FMP profiles with no industry",
  "msh:pickers:screener-fundamentals:v1": "FMP company-screener rows",
  "msh:price-pool:v1": "FMP quote fields (price, change, volume, marketCap, pe) — P, Friday",
  "msh:quote:v1": "FMP /stable/quote (60 s)",
  "msh:benchmarks": "FMP quotes for SPY/QQQ/DIA/IWM + crypto",
  "msh:market:state": "FMP discovery quotes (dynamic universe)",
  "msh:history:v7": "FMP daily bars — P, Friday",
  "msh:picker-charts:v1": "chart points cut from FMP bars — P",
  "msh:pickers:v10": "pickers payload: signals + chart points from FMP bars — P",
  "msh:plays:v5": "plays payload built from FMP bars — P",
  "msh:feed:ipo": "IPO feed cache; the fmp-namespaced entry is FMP data",
  "msh:reference:v1": "FMP earnings calendar / stock-list (Relay A's area)",
};
const noteFor = (prefix) => {
  for (const [p, note] of Object.entries(FMP_NOTE)) if (prefix === p || prefix.startsWith(`${p}:`)) return note;
  return "";
};

const rows = [...buckets].sort((a, b) => b[1].n - a[1].n);
console.log(`keyspace: ${rows.reduce((a, [, b]) => a + b.n, 0)} keys in ${rows.length} prefixes (SCAN calls ${commands})\n`);
console.log("prefix | keys | TTL (sampled, s) | FMP payload?");
for (const [prefix, b] of rows) {
  const note = noteFor(prefix);
  if (!note && b.n < 5) continue; // noise
  const ttls = [];
  for (const key of b.sample) {
    ttls.push(await redis.ttl(key));
    commands++;
  }
  console.log(`${prefix} | ${b.n} | ${ttls.join(",")} | ${note || "—"}`);
}

// ─────────────────────────────────────────────── 2. news stores, item by item
async function censusOf(keys, label) {
  let records = 0, withFmp = 0, items = 0, fmpItems = 0, newestFmp = null;
  const byProvider = new Map();
  for (let i = 0; i < keys.length; i += 50) {
    const group = keys.slice(i, i + 50);
    const values = await redis.mget(...group);
    commands++;
    for (const v of values) {
      if (!v || typeof v !== "object" || !Array.isArray(v.items)) continue;
      records++;
      let has = false;
      for (const item of v.items) {
        items++;
        const p = typeof item.provider === "string" ? item.provider : "(none)";
        byProvider.set(p, (byProvider.get(p) ?? 0) + 1);
        if (p === "fmp" || p === "(none)") {
          fmpItems++;
          has = true;
          const d = item.pubDate ? Date.parse(item.pubDate) : NaN;
          if (Number.isFinite(d) && (newestFmp === null || d > newestFmp)) newestFmp = d;
        }
      }
      if (has) withFmp++;
    }
  }
  console.log(
    `\n${label}: ${records} records, ${withFmp} hold FMP-era items; ${fmpItems} of ${items} items ` +
      `(${items ? ((fmpItems / items) * 100).toFixed(1) : 0}%); newest FMP-era item ${newestFmp ? new Date(newestFmp).toISOString().slice(0, 10) : "—"}`
  );
  console.log(`  items by provider: ${[...byProvider].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} ${n}`).join(" · ")}`);
}
await censusOf(newsKeys, "msh:news:v1 (stock news stores)");
await censusOf(sectorKeys, "msh:sector-news:v1 (sector news stores)");

console.log(`\nRedis commands used: ${commands} (read-only)`);
