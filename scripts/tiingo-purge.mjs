// Delete every Tiingo key (#553 COWORK #55 §2; contract §7, on termination).
//
// The contract says all raw Tiingo data is deleted on termination, with written
// certification. Every Tiingo key lives under ONE prefix, msh:tiingo:
// (lib/server/marketData/keys.ts), so this is a SCAN of that prefix and a DEL
// of what it finds. It prints counts by key family, never a value.
//
// DRY RUN unless --apply. After --apply it scans again and exits 1 unless 0
// keys remain, so the log is the evidence for the certification.
//
//   relay tasks: write-tiingo-purge-dry, write-tiingo-purge
//   Redis: 1 SCAN per 1,000 keys, + 1 DEL per 500 keys with --apply,
//          + the confirming SCAN. ~850 keys today: ~2 dry, ~6 applied.
//
// Also turn the two jobs off first (Edge Config kill switch, or remove their
// crons), or the next run writes the keys back.
import { Redis } from "@upstash/redis";

const PREFIX = "msh:tiingo:";
const apply = process.argv.includes("--apply");
const redis = Redis.fromEnv();
let commands = 0;

async function scanAll() {
  const keys = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, { match: `${PREFIX}*`, count: 1000 });
    commands++;
    cursor = String(next);
    keys.push(...batch.map(String));
  } while (cursor !== "0");
  return [...new Set(keys)];
}

const family = (k) => k.slice(PREFIX.length).split(":")[0];
const tally = (keys) => {
  const m = new Map();
  for (const k of keys) m.set(family(k), (m.get(family(k)) ?? 0) + 1);
  return [...m.entries()].map(([f, n]) => `${f}: ${n}`).join("; ") || "(none)";
};

const keys = await scanAll();
console.log(`keys under ${PREFIX}: ${keys.length} (${tally(keys)})`);
if (keys.some((k) => !k.startsWith(PREFIX))) {
  console.error("FATAL: SCAN returned a key outside the prefix. Nothing deleted.");
  process.exit(2);
}
if (!apply) {
  console.log(`DRY RUN: would DEL ${keys.length} key(s). Redis commands: ${commands}`);
  process.exit(0);
}
let removed = 0;
for (let i = 0; i < keys.length; i += 500) {
  removed += await redis.del(...keys.slice(i, i + 500));
  commands++;
}
const left = await scanAll();
console.log(`applied: DEL removed ${removed}; keys left under ${PREFIX}: ${left.length} at ${new Date().toISOString()}. Redis commands: ${commands}`);
process.exit(left.length ? 1 : 0);
