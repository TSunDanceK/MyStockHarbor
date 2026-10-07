// COWORK #197 census, READ-ONLY: which earnings links point at a symbol with
// no stored SEC fact set (or one with no filed period). Reads the fact-set
// index, every stored set's period counts, and the bottleneck posts' tickers.
// Store: SMEMBERS, SCAN, MGET only. No SEC requests.
import fs from "node:fs";
import { register } from "node:module";
import { Redis } from "@upstash/redis";

register("./lib/ts-resolve-app.mjs", import.meta.url);
const READS = new Set(["smembers", "scan", "mget"]);
const counts = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (process.env.UPSTASH_REDIS_REST_URL && url.startsWith(process.env.UPSTASH_REDIS_REST_URL)) {
    const body = JSON.parse(init.body ?? "null");
    for (const c of Array.isArray(body?.[0]) ? body : [body]) {
      const op = String(c?.[0]).toLowerCase();
      if (!READS.has(op)) throw new Error(`read guard: ${op} refused`);
      counts[op] = (counts[op] ?? 0) + 1;
    }
  } else if (!url.startsWith("data:")) throw new Error("read guard: only the store may be reached");
  return realFetch(input, init);
};
const { getAllBottleneckPosts } = await import("../lib/bottlenecks.ts");
const { uniqueEtfs } = await import("../lib/curatedSymbols.ts");
const keyOf = (file, name) => (fs.readFileSync(file, "utf8").match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const INDEX = keyOf("lib/server/secManifest.ts", "SEC_FACTS_INDEX_KEY");
if (!FACTS || !INDEX) { console.error("FATAL: a key moved"); process.exit(2); }
const redis = Redis.fromEnv();

const index = new Set((await redis.smembers(INDEX)).map((s) => String(s).toUpperCase()));
const keys = [];
let cursor = "0";
do { const [next, batch] = await redis.scan(cursor, { match: `${FACTS}:*`, count: 1000 }); cursor = String(next); keys.push(...batch); } while (cursor !== "0");
const periods = new Map();
for (let i = 0; i < keys.length; i += 20) {
  const chunk = keys.slice(i, i + 20);
  const raw = await redis.mget(...chunk);
  chunk.forEach((k, j) => { const s = raw[j]; periods.set(k.slice(FACTS.length + 1).toUpperCase(), (s?.quarters?.length ?? 0) + (s?.years?.length ?? 0)); });
}
const keyOnly = [...periods.keys()].filter((s) => !index.has(s));
const indexOnly = [...index].filter((s) => !periods.has(s));
const empty = [...periods].filter(([, n]) => n === 0).map(([s]) => s);
console.log(`fact-set index members: ${index.size} · stored set keys: ${periods.size}`);
console.log(`  indexed but no key: ${indexOnly.length}${indexOnly.length ? ` (${indexOnly.slice(0, 20).join(" ")})` : ""}`);
console.log(`  key but not indexed: ${keyOnly.length}${keyOnly.length ? ` (${keyOnly.slice(0, 20).join(" ")})` : ""}`);
console.log(`  stored sets with NO filed period (0 quarters, 0 years): ${empty.length} · ${empty.sort().join(" ")}`);

const ETF = new Set(uniqueEtfs.map((s) => s.toUpperCase()));
const filed = (t) => { const u = t.toUpperCase(); const alt = u.includes(".") ? u.replace(/\./g, "-") : u.replace(/-/g, "."); return !ETF.has(u) && [u, alt].some((s) => index.has(s) && (periods.get(s) ?? 0) > 0); };
const posts = getAllBottleneckPosts();
let links = 0, priv = 0; const bad = new Map();
for (const p of posts) {
  for (const list of [p.supplyChain ?? [], p.customers ?? []]) for (const c of list) {
    if (!c.ticker) { priv++; continue; }
    links++;
    if (!filed(c.ticker)) bad.set(c.ticker, [...(bad.get(c.ticker) ?? []), p.symbol]);
  }
}
console.log(`\nBOTTLENECK PAGES: ${posts.length} posts · dependency cards with a ticker (each renders "Earnings →"): ${links} · private (no ticker, no links): ${priv}`);
console.log(`  cards whose ticker has NO filed fact set: ${[...bad.values()].reduce((a, v) => a + v.length, 0)} cards, ${bad.size} distinct tickers`);
for (const [t, on] of [...bad].sort()) {
  const u = t.toUpperCase();
  const why = ETF.has(u) ? "ETF" : !index.has(u) && !periods.has(u) ? "no fact set" : (periods.get(u) ?? 0) === 0 ? "empty set" : "not indexed";
  console.log(`    ${t} (${why}) · on ${[...new Set(on)].join(", ")}`);
}
const subjects = posts.map((p) => p.symbol).filter((s) => !filed(s));
console.log(`  post subjects (the page's own company) with no filed set: ${subjects.join(" ") || "none"}`);
console.log(`\nStore commands: ${JSON.stringify(counts)}`);
