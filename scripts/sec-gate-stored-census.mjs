// STORED SEC SETS THAT FAIL THE SEED GATE (#552 COWORK #148). Reads only.
//
// The seed gate (lib/server/secSeedGate.ts) keeps new preferreds, warrants,
// notes and ETFs out of the sec-facts manifest and out of warm-pickers-sec,
// but sets stored BEFORE it existed stay in Redis. This lists them, symbol and
// reason, so the owner can decide whether to delete the keys. Nothing is
// deleted here. Also: how many of them still have an SEC picker row (the next
// warm-pickers-sec run prunes those, since the gate now drops the symbol).
//
//   relay task: write-sec-gate-stored-census (READ-ONLY despite the prefix:
//   the credentials live in that job). Redis: 1 SMEMBERS + 1 HKEYS.
import "./lib/register-ts-app.mjs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const { SEC_FACTS_INDEX_KEY } = await import("../lib/server/secManifest.ts");
const { secSeedRefusal } = await import("../lib/server/secSeedGate.ts");
const { cikForSymbol } = await import("../lib/server/secColdFetch.ts");
const { PICKERS_SEC_KEY } = await import("../lib/server/pickersSecFundamentals.ts");

const [stored, rows] = await Promise.all([redis.smembers(SEC_FACTS_INDEX_KEY), redis.hkeys(PICKERS_SEC_KEY)]);
const rowSet = new Set((rows ?? []).map((s) => String(s).toUpperCase()));
const byReason = new Map();
for (const s0 of stored ?? []) {
  const s = String(s0).toUpperCase();
  const cik = cikForSymbol(s);
  const why = cik ? secSeedRefusal(s, cik) : null;
  if (!why) continue;
  byReason.set(why, [...(byReason.get(why) ?? []), s]);
}
const total = [...byReason.values()].reduce((t, v) => t + v.length, 0);
console.log(`stored sets (index) ${stored?.length ?? 0} · failing the gate ${total} · SEC picker rows ${rowSet.size}`);
for (const [why, syms] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
  const withRow = syms.filter((s) => rowSet.has(s) || rowSet.has(s.replace(/\./g, "-")) || rowSet.has(s.replace(/-/g, ".")));
  console.log(`\n${why}: ${syms.length} (with a picker row today: ${withRow.length})`);
  console.log(`  ${syms.sort().join(", ")}`);
}
console.log("\nRedis commands: 2 (SMEMBERS, HKEYS), read-only. Nothing deleted.");
