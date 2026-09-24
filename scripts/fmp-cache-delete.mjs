// DELETE FMP DATA FROM REDIS, ONE SURFACE AT A TIME (#553 COWORK #8 §3).
//
// The owner's ruling: FMP data is deleted from caches, not left to age out, and
// each surface's keys go as soon as that surface's SEC/free replacement is
// merged and verified -- not all at once on 14 Oct. Each run needs the owner's
// GO in chat. This script is the mechanism; the GO is the gate.
//
// ── INPUTS, via the relay's SYMBOLS field (tokens, fixed vocabulary) ─────
//   surface=<name>     which key family (SURFACES below); required
//   mode=dry|delete    dry (default) only counts; delete UNLINKs
//   confirm=<name>     required with mode=delete, and must equal surface --
//                      a second, deliberate spelling of the target
//
// ── SAFETY, AS NUMBERS ───────────────────────────────────────────────────
//   - prefixes are a FIXED list per surface; no free-text pattern is accepted;
//   - at most MAX_KEYS keys per run (the census found 4,158 across every
//     B-area FMP prefix); more than that aborts before any delete;
//   - UNLINK in batches of 100; the first error stops the run;
//   - counts are printed BEFORE and re-scanned AFTER.
//   Cost: ~11 SCAN calls per prefix pass (10.6k-key keyspace, COUNT 1000),
//   plus one UNLINK per 100 keys.
//
// ── READ THIS BEFORE RUNNING A SURFACE ───────────────────────────────────
// A key family can only go once NOTHING READS OR WRITES it. Deleting keys a
// running warm job still writes is undone within hours; deleting keys a page
// still reads blanks those columns until the job refills them. Each surface
// below states what must be true first.
//
//   relay task: write-fmp-cache-delete
import { Redis } from "@upstash/redis";

const SURFACES = {
  // Readers: picker pages (P/E, industry, sector until the resolver PR; EPS,
  // Payout Ratio, Performance until Friday). Writers: warm-fundamentals,
  // warm-stock-data, warm-screener-fundamentals. Run only after those columns
  // have moved AND those FMP legs are switched off.
  pickers: ["msh:pickers:fundamentals:v1:", "msh:stockdata:v1:", "msh:pickers:screener-fundamentals:v1:"],
  // Readers: fundamentalsCache's profile leg. Writer: warm-fundamentals'
  // /stable/profile leg. After the sector/industry PR removes that leg. TTL is
  // up to 27 days, which is why it has to be deleted, not waited out.
  profile: ["msh:pickers:profile:v1:", "msh:pickers:profile-noindustry:v1:"],
  // Dashboard benchmark tiles. After Friday's price split replaces the quotes.
  benchmarks: ["msh:benchmarks:"],
};
const MAX_KEYS = 6000;

const tokens = (process.env.SYMBOLS || "").split(/[,\s]+/).filter(Boolean);
const arg = (name) => tokens.find((t) => t.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
const surface = arg("surface");
const mode = arg("mode") ?? "dry";
if (!surface || !Object.hasOwn(SURFACES, surface)) {
  console.error(`FATAL: surface= must be one of: ${Object.keys(SURFACES).join(", ")}`);
  process.exit(2);
}
if (mode !== "dry" && mode !== "delete") {
  console.error("FATAL: mode= is dry or delete");
  process.exit(2);
}
if (mode === "delete" && arg("confirm") !== surface) {
  console.error(`FATAL: mode=delete needs confirm=${surface} as well; nothing deleted.`);
  process.exit(2);
}

const redis = Redis.fromEnv();
let commands = 0;

async function scanPrefix(prefix) {
  const keys = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, { match: `${prefix}*`, count: 1000 });
    commands++;
    cursor = String(next);
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}

async function census(label) {
  const byPrefix = {};
  for (const prefix of SURFACES[surface]) byPrefix[prefix] = await scanPrefix(prefix);
  console.log(`\n${label}:`);
  for (const [prefix, keys] of Object.entries(byPrefix)) console.log(`  ${prefix}*  ${keys.length} keys`);
  return byPrefix;
}

console.log(`surface=${surface} mode=${mode}`);
const before = await census("BEFORE");
const all = Object.values(before).flat();
if (all.length > MAX_KEYS) {
  console.error(`FATAL: ${all.length} keys exceeds the ${MAX_KEYS} cap; nothing deleted.`);
  process.exit(1);
}

if (mode === "dry") {
  console.log(`\nDRY RUN: ${all.length} keys would be unlinked in ${Math.ceil(all.length / 100)} batches. Nothing deleted.`);
} else {
  let unlinked = 0;
  for (let i = 0; i < all.length; i += 100) {
    try {
      unlinked += Number(await redis.unlink(...all.slice(i, i + 100)));
      commands++;
    } catch (err) {
      console.error(`STOPPED on a Redis error after ${unlinked} keys: ${String(err).slice(0, 160)}`);
      process.exit(1);
    }
  }
  console.log(`\nUNLINKED ${unlinked} keys.`);
  await census("AFTER (re-scanned)");
}
console.log(`\nRedis commands used: ${commands}`);
