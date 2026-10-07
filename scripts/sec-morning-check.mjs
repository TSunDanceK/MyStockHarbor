// THE 05:05 CHECK-IN (#552 COWORK #191 item 5). READ-ONLY.
// Store: GET (report dates, fact sets, manifest), ZCARD + EXISTS (cold queue,
// the 25 queued names). Anything else is refused. No SEC requests.
import fs from "node:fs";
import { register } from "node:module";
import { Redis } from "@upstash/redis";

register("./lib/ts-resolve-app.mjs", import.meta.url);
const READS = new Set(["get", "zcard", "exists"]);
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
const { valueOf } = await import("../lib/server/secFactCodec.ts");
const { splitAdjusted, provenSplits } = await import("../lib/server/secSplitAdjust.ts");
const keyOf = (file, name) => (fs.readFileSync(file, "utf8").match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const MANIFEST = keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY");
const RD = keyOf("lib/server/secReportDatesStore.ts", "SEC_REPORT_DATES_PREFIX");
const COLD = keyOf("lib/server/secColdFetch.ts", "SEC_COLD_QUEUE_KEY");
if (!FACTS || !MANIFEST || !RD || !COLD) { console.error("FATAL: a key moved"); process.exit(2); }
const redis = Redis.fromEnv();
const iso = (ms) => (ms ? new Date(ms).toISOString() : "-");

console.log("1. BACKFILL SURVIVAL (report-date events)");
for (const s of ["JPM", "BAC", "MS", "WFC", "C", "GS"]) {
  const r = await redis.get(`${RD}:${s}`);
  console.log(`  ${s}: ${r ? `${r.events?.length ?? 0} events · record at ${r.at} · newest ${r.events?.[0]?.periodEnd ?? "-"} · next ${JSON.stringify(r.next)}` : "no record"}`);
}

const manifest = await redis.get(MANIFEST);
const ent = (s) => manifest?.symbols?.[s] ?? null;
console.log("\n2. MS, SONY, POOL fact sets");
for (const s of ["MS", "SONY", "POOL"]) {
  const set = await redis.get(`${FACTS}:${s}`);
  const e = ent(s);
  console.log(`  ${s}: fact set ${set?.quarters ? `yes · written ${iso(set.at)} · ${set.quarters.length}q/${set.years?.length ?? 0}y · chains ${set.c ?? "-"}` : "NO"} · manifest ${e ? JSON.stringify({ contentHash: e.contentHash ? "set" : null, needsReverify: e.needsReverify, c: e.c ?? null }) : "no entry"}`);
  if (s === "SONY" && set?.quarters) {
    const proven = provenSplits(set);
    const adj = splitAdjusted(set);
    const eps = (ps) => [...ps].sort((a, b) => (a.e < b.e ? 1 : -1)).slice(0, 5).map((p) => `${p.e}:${valueOf(p, "epsDiluted")}`).join(" ");
    console.log(`    share-version ${set.sv ?? "-"} · asr ${set.asr ? "present" : "absent"} · proven splits ${JSON.stringify(proven)} · spa ${adj.spa ? JSON.stringify(adj.spa) : "none"}`);
    console.log(`    years EPS stored:   ${eps(set.years ?? [])}`);
    console.log(`    years EPS adjusted: ${eps(adj.years ?? [])}`);
  }
}

console.log("\n3. THE 25 QUEUED LAST NIGHT");
const Q = "SNDK MRNA FORM PBR XP IREN MPWR MS FICO ECHO TWST LULU WK PWR PNC TEM NOC WELL TSCO DVN TFC MNST WAT EQT HONA".split(" ");
const filled = [], missing = [];
for (const s of Q) ((await redis.exists(`${FACTS}:${s}`)) ? filled : missing).push(s);
console.log(`  filled ${filled.length}/25${missing.length ? ` · still missing: ${missing.join(" ")}` : ""}`);
console.log(`  cold queue size now: ${await redis.zcard(COLD)}`);
console.log(`\nStore commands: ${JSON.stringify(counts)}`);
