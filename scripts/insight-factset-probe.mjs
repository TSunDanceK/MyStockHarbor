// WHY #814 LEFT OUT CRWD, C, KB, FERG, CRWV AND UMC (#553 COWORK #195 item 2).
// READ-ONLY, ENFORCED (HMGET, SISMEMBER). For each: in A's fact-set index, its
// picker SEC row's refusals, EPS basis and period end, and the growth facts'
// latest period (or why none). PUBLIC LOG: symbols, codes, dates and labels.
//
//   node scripts/insight-factset-probe.mjs   (relay: write-insight-factset-probe)
import { register } from "node:module";
register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }
const READ_VERBS = new Set(["HMGET", "SISMEMBER", "SMISMEMBER"]);
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
const redis = (await import("@upstash/redis")).Redis.fromEnv();
const { SEC_FACTS_INDEX_KEY } = await import("../lib/server/secManifest.ts");
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const NAMED = (process.env.NAMED || "CRWD C KB FERG CRWV UMC NVDA JPM").split(/\s+/);
const rows = await redis.hmget("msh:pickers:sec-fundamentals:v1", ...NAMED);
for (const s of NAMED) {
  const inIndex = await redis.sismember(SEC_FACTS_INDEX_KEY, s);
  const r = parse(rows?.[s] ?? null);
  if (!r) { console.log(`${s}: index ${inIndex ? "yes" : "no"} · NO picker row`); continue; }
  const g = r.growth;
  const growth = g == null ? "absent" : g.ok ? `${g.label} (end ${g.periodEnd}, filed ${g.filed})` : `refused ${g.why}`;
  const eps = r.eps == null ? (("eps" in r) ? "null" : "absent") : `${r.eps.basis} to ${r.eps.periodEnd}`;
  console.log(`${s}: index ${inIndex ? "yes" : "no"} · refusals [${(r.inputs?.refusals ?? []).join(", ")}] · eps ${eps} · growth ${growth} · built ${new Date(r.at).toISOString().slice(0, 10)}`);
}
console.log(`\nRedis commands ${commands} (read-only)`);
