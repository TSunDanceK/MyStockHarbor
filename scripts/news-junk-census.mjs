// HOW MUCH OF THE STORED NEWS IS NOT NEWS, BY DAY (#553 COWORK #191 item 1).
// READ-ONLY, ENFORCED (GET, MGET). Every analysis-universe symbol's stored
// record (msh:news:v1:<SYM>) and every sector's (msh:sector-news:v1:<slug>);
// per publication day over the last 14: items held, and what
// lib/server/news/junkTitle.ts would drop, by reason. Writes nothing.
//
// PUBLIC LOG: counts and a few example headlines (public titles).
//
//   node scripts/news-junk-census.mjs   (relay: write-news-junk-census)
import { register } from "node:module";
register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);
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
    if (!cmds.length) throw new Error("census is read-only");
    for (const c of cmds) if (!READ_VERBS.has(String(c?.[0] ?? "").toUpperCase())) throw new Error(`census is read-only: refused ${c?.[0]}`);
    commands += cmds.length;
  }
  return realFetch(input, init);
};
const { junkReason } = await import("../lib/server/news/junkTitle.ts");
const { SECTORS } = await import("../lib/sectors.ts");
const redis = (await import("@upstash/redis")).Redis.fromEnv();
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const uni = parse(await redis.get("msh:pickers:v10:symbols")) ?? [];
const keys = [...uni.map((s) => `msh:news:v1:${String(s).toUpperCase()}`), ...(SECTORS ?? []).map((s) => `msh:sector-news:v1:${String(s.slug).toLowerCase()}`)];
const byDay = new Map();
const examples = new Map();
let records = 0, items = 0;
for (let i = 0; i < keys.length; i += 25) {
  const chunk = keys.slice(i, i + 25);
  const vals = await redis.mget(...chunk);
  for (const raw of vals) {
    const rec = parse(raw);
    if (!rec || !Array.isArray(rec.items)) continue;
    records++;
    for (const it of rec.items) {
      items++;
      const day = String(it.pubDate ?? "").slice(0, 10) || "undated";
      const d = byDay.get(day) ?? { total: 0, "filing-notice": 0, "quote-page": 0, "foreign-listing": 0 };
      d.total++;
      const why = junkReason(it.title, it.provider);
      if (why) { d[why]++; if ((examples.get(why) ?? []).length < 4) examples.set(why, [...(examples.get(why) ?? []), it.title]); }
      byDay.set(day, d);
    }
  }
}
console.log(`records ${records} (of ${keys.length} keys) · items ${items}`);
console.log("day | held | filing notices | quote pages | foreign listings | kept");
for (const day of [...byDay.keys()].sort().reverse().slice(0, 14)) {
  const d = byDay.get(day);
  const drop = d["filing-notice"] + d["quote-page"] + d["foreign-listing"];
  console.log(`${day} | ${d.total} | ${d["filing-notice"]} | ${d["quote-page"]} | ${d["foreign-listing"]} | ${d.total - drop}`);
}
const all = [...byDay.values()].reduce((a, d) => ({ fn: a.fn + d["filing-notice"], qp: a.qp + d["quote-page"], fl: a.fl + d["foreign-listing"] }), { fn: 0, qp: 0, fl: 0 });
console.log(`all held: filing notices ${all.fn} · quote pages ${all.qp} · foreign listings ${all.fl} · of ${items}`);
for (const [why, ex] of examples) console.log(`  e.g. ${why}: ${ex.join(" | ")}`);
console.log(`\nRedis commands ${commands} (read-only)`);
