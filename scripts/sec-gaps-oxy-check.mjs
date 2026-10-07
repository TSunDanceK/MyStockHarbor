// COWORK #195 items 3-4, READ-ONLY: why B's dry run reads "no fact set" for
// six symbols that have one (fact-set index membership, the pickers row), and
// why the pickers show Revenue "–" for OXY and PSX (their stored row and set).
// Store: GET, HGET, SISMEMBER only. No SEC requests.
import fs from "node:fs";
import { register } from "node:module";
import { Redis } from "@upstash/redis";

register("./lib/ts-resolve-app.mjs", import.meta.url);
const READS = new Set(["get", "hget", "sismember"]);
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
const keyOf = (file, name) => (fs.readFileSync(file, "utf8").match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const INDEX = keyOf("lib/server/secManifest.ts", "SEC_FACTS_INDEX_KEY");
const PICK = keyOf("lib/server/pickersSecFundamentals.ts", "PICKERS_SEC_KEY");
if (!FACTS || !INDEX || !PICK) { console.error("FATAL: a key moved"); process.exit(2); }
const redis = Redis.fromEnv();
const short = (v) => JSON.stringify(v)?.slice(0, 400);

console.log("1. THE SIX 'NO FACT SET' SYMBOLS");
for (const s of ["CRWD", "C", "KB", "FERG", "CRWV", "UMC"]) {
  const set = await redis.get(`${FACTS}:${s}`);
  console.log(`  ${s}: fact set ${set?.quarters ? `yes (${set.quarters.length}q, written ${new Date(set.at).toISOString()})` : "NO"} · in fact-set index: ${await redis.sismember(INDEX, s)} · pickers row: ${short(await redis.hget(PICK, s)) ?? "none"}`);
}

console.log("\n2. OXY / PSX");
for (const s of ["OXY", "PSX"]) {
  const set = await redis.get(`${FACTS}:${s}`);
  const q = [...(set?.quarters ?? [])].sort((a, b) => (a.e < b.e ? 1 : -1)).slice(0, 5);
  console.log(`  ${s}: set written ${set ? new Date(set.at).toISOString() : "-"} · chains ${set?.c ?? "-"}`);
  console.log(`    quarters revenue / operating income: ${q.map((p) => `${p.e} ${valueOf(p, "revenue")} / ${valueOf(p, "operatingIncome")}`).join(" · ")}`);
  console.log(`    pickers row: ${short(await redis.hget(PICK, s)) ?? "none"}`);
}
console.log(`\nStore commands: ${JSON.stringify(counts)}`);
