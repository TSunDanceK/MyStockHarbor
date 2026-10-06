// WHY A SYMBOL HAS NO FACT SET, AND (MODE=apply) QUEUE ONE FILL (#552 COWORK #185, MS).
//
// For each of SYMBOLS it prints the manifest entry's population fields, the
// seed gate's answer (secSeedRefusal, the shipped function), whether a fact
// set and a report-dates record exist, and whether it is already on the cold
// queue. That names why populate never reached it.
//
// MODE=apply adds it to the EXISTING cold queue (SEC_COLD_QUEUE_KEY) the way
// the site's own enqueue does for a person: scored now, `lt` so an existing
// entry keeps its older score, never past SEC_COLD_QUEUE_MAX, never for a
// symbol the seed gate refuses. The sec-facts run drains the queue (cold
// allowance per run) and builds the report-dates record beside the new set.
// No new cron; nothing else is written.
//
// Commands: 1 GET (manifest) + per symbol 2 EXISTS + 1 ZSCORE; apply adds
// 1 ZCARD + 1 ZADD per symbol queued. Anything else is refused before it leaves.
import fs from "node:fs";
import { register } from "node:module";
import { Redis } from "@upstash/redis";

register("./lib/ts-resolve-app.mjs", import.meta.url);

const MODE = process.env.MODE === "apply" ? "apply" : "read";
const ALLOWED = new Set(MODE === "apply" ? ["get", "exists", "zscore", "zcard", "zadd"] : ["get", "exists", "zscore"]);
const counts = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (process.env.UPSTASH_REDIS_REST_URL && url.startsWith(process.env.UPSTASH_REDIS_REST_URL)) {
    const body = JSON.parse(init.body ?? "null");
    for (const c of Array.isArray(body?.[0]) ? body : [body]) {
      const op = String(c?.[0]).toLowerCase();
      if (!ALLOWED.has(op)) throw new Error(`store guard: ${op} refused in MODE=${MODE}`);
      if (op === "zadd" && c[1] !== QUEUE_KEY) throw new Error("store guard: zadd outside the cold queue");
      counts[op] = (counts[op] ?? 0) + 1;
    }
  }
  return realFetch(input, init);
};

const keyOf = (file, name) => (fs.readFileSync(file, "utf8").match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const numOf = (file, name) => Number((fs.readFileSync(file, "utf8").match(new RegExp(`${name} = ([0-9_]+);`)) ?? [])[1]?.replace(/_/g, ""));
const MANIFEST_KEY = keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY");
const FACTS_PREFIX = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const DATES_PREFIX = keyOf("lib/server/secReportDatesStore.ts", "SEC_REPORT_DATES_PREFIX");
const QUEUE_KEY = keyOf("lib/server/secColdFetch.ts", "SEC_COLD_QUEUE_KEY");
const QUEUE_MAX = numOf("lib/server/secColdFetch.ts", "SEC_COLD_QUEUE_MAX");
if (!MANIFEST_KEY || !FACTS_PREFIX || !DATES_PREFIX || !QUEUE_KEY || !(QUEUE_MAX > 0)) { console.error("FATAL: a key or limit moved"); process.exit(2); }

const { secSeedRefusal } = await import("../lib/server/secSeedGate.ts");
const SYMBOLS = (process.env.SYMBOLS || "MS").split(/[,\s]+/).filter(Boolean).map((s) => s.toUpperCase());
const redis = Redis.fromEnv();
const manifest = await redis.get(MANIFEST_KEY);
if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }

console.log(`MODE=${MODE} · ${SYMBOLS.join(" ")}`);
for (const sym of SYMBOLS) {
  const e = manifest.symbols[sym];
  const refusal = secSeedRefusal(sym, e?.cik ?? null);
  const facts = await redis.exists(`${FACTS_PREFIX}:${sym}`);
  const dates = await redis.exists(`${DATES_PREFIX}:${sym}`);
  const score = await redis.zscore(QUEUE_KEY, sym);
  const pick = e ? Object.fromEntries(["cik", "contentHash", "needsReverify", "enqueuedAt", "lastFiled", "fetchedAt", "window", "lastError", "skip", "refusal"]
    .filter((k) => k in e).map((k) => [k, k === "contentHash" && e[k] ? "set" : e[k]])) : null;
  console.log(`\n${sym}: manifest ${e ? JSON.stringify(pick) : "NO ENTRY"}`);
  console.log(`   seed gate: ${refusal ?? "admitted"} · fact set: ${facts ? "yes" : "no"} · report-dates record: ${dates ? "yes" : "no"} · cold queue: ${score == null ? "no" : "yes"}`);
  const why = !e ? "not in the manifest" : !e.cik ? "no CIK" : refusal ? `refused by the seed gate (${refusal})`
    : e.needsReverify ? "waiting in reverify" : e.contentHash === null ? "in the populate queue, not yet reached" : facts ? "populated" : "manifest says populated (contentHash set) but no fact set is stored";
  console.log(`   why: ${why}`);
  if (MODE !== "apply") continue;
  if (refusal || !e?.cik) { console.log("   not queued (refused or no CIK)"); continue; }
  if (facts) { console.log("   not queued (a fact set exists)"); continue; }
  const size = await redis.zcard(QUEUE_KEY);
  if (size >= QUEUE_MAX) { console.log(`   not queued: the cold queue is full (${size}/${QUEUE_MAX})`); continue; }
  await redis.zadd(QUEUE_KEY, { lt: true }, { score: Date.now(), member: sym });
  console.log(`   QUEUED on the cold queue (size before ${size}/${QUEUE_MAX}); the next sec-facts run drains it`);
}
console.log(`\nStore commands: ${JSON.stringify(counts)}`);
