// Four reductions in how many Redis commands a build spends, and the invariants
// that keep them from quietly regressing.
//
// The shared mistake they came from: a PIPELINE IS NOT A BULK READ. Pipelining
// 700 GETs is one round-trip but still 700 billed commands, and every one of
// these sites was written as a pipeline believing the round-trip was the cost.
// Upstash bills commands, so the fix is MGET -- chunked, because a single reply
// over the whole universe breaches the 10MB per-response ceiling, which is what
// the original comments were right to worry about.
//
// Asserted against source with comments stripped: the code below is explained in
// prose naming pipeline, mget and lock, and a grep counting those would pass on
// the explanation alone.
//
//   node scripts/check-command-budget.mjs
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const history = readCodeOnly("lib/server/historyCache.ts");
const pickers = readCodeOnly("lib/server/pickersBuilder.ts");
const pricePoolRoute = readCodeOnly("app/api/jobs/warm-price-pool/route.ts");
const pricePool = fs.readFileSync(path.join(process.cwd(), "lib/server/pricePool.ts"), "utf8");

const bodyOf = (src, signature) => {
  const start = src.indexOf(signature);
  if (start === -1) return "";
  const rest = src.slice(start + signature.length);
  const end = rest.search(/\n(?:export |async function |function |const )/);
  return end === -1 ? rest : rest.slice(0, end);
};

console.log("\n=== 1. Bulk reads are chunked MGETs, not per-symbol pipelines ===\n");

check(
  "history bulk reads no longer build a per-symbol pipeline",
  !/pipeline\.get</.test(history),
  "one pipelined GET per symbol is ~700 billed commands for a single build"
);

check(
  "history reads in bounded chunks",
  /HISTORY_MGET_CHUNK/.test(history) && /redis\.mget</.test(history),
  "an unbounded mget over the universe is one reply, and a history entry can carry 1400 bars"
);

const chunkSize = history.match(/const HISTORY_MGET_CHUNK = (\d+);/)?.[1];
check(
  "the history chunk stays in the 40-60 band",
  Number(chunkSize) >= 40 && Number(chunkSize) <= 60,
  `sized against the 10MB response ceiling rather than for round-trip count — found ${chunkSize}`
);

check(
  "earnings reads in bounded chunks too",
  /EARNINGS_MGET_CHUNK/.test(pickers) && /chunkKeys\(/.test(pickers),
  "same ceiling applies, even though earnings rows are smaller than chart series"
);

check(
  "the earnings rows are read once and passed on, not read twice",
  /queueEarningsWarmupSymbols\(\s*universe,\s*earningsBySymbol\s*\)/.test(pickers),
  "these two ran back to back over the same universe, so every earnings key was fetched twice"
);

check(
  "queueing no longer re-reads the rows for itself",
  !/readPipeline/.test(pickers),
  "that pipeline was the 1,400-command half of this, and it fetched keys the next line fetched again"
);

console.log("\n=== 2. warm-price-pool cannot overlap itself ===\n");

check(
  "the run takes an NX lock",
  /nx: true/.test(pricePoolRoute) && /PRICE_POOL_LOCK_KEY/.test(pricePoolRoute),
  "the cron period and maxDuration are both 300s, so consecutive runs can touch exactly"
);

const ttl = pricePoolRoute.match(/const PRICE_POOL_LOCK_TTL_SECONDS = (\d+) \* 60;/)?.[1];
const maxDuration = pricePoolRoute.match(/export const maxDuration = (\d+);/)?.[1];
check(
  "the lock TTL outlives maxDuration",
  Number(ttl) * 60 > Number(maxDuration),
  `a TTL at or under maxDuration expires mid-overrun, i.e. it fails open in the one case it exists for — ${ttl}m vs ${maxDuration}s`
);

check(
  "a lock-skip is recorded, not silent",
  /skipped: true, reason: "locked"/.test(pricePoolRoute),
  "an unrecorded skip looks identical on /cache-health to the job having stopped running"
);

check(
  "the lock is released on the failure path too",
  /finally \{\s*await releaseLock\(lock\);/.test(pricePoolRoute),
  "a throw that kept the lock would block every run until the TTL expired"
);

check(
  "release compares the token before deleting",
  /current === token/.test(pricePoolRoute),
  "a run that overran its TTL no longer owns the lock, and deleting it would let a third run in"
);

console.log("\n=== 3. No fourth copy of the price-pool cadence ===\n");

check(
  "pricePool.ts states coverage in RUNS, not minutes",
  !/every ~?1[25] min|\*\/3 cron|3-minute cron/.test(pricePool.replace(/#374 took it from \*\/3 to \*\/5/, "")),
  "wall-clock coverage is a function of a cron that has already moved once, so counting runs is what stays true"
);

console.log("\n=== 4. /stock/* fetches a symbol's history once per render ===\n");

const getDaily = bodyOf(history, "export async function getDailyHistory(");

check(
  "getDailyHistory shares an in-flight promise",
  /historyInFlight/.test(getDaily),
  "the page calls this twice per render, and on a cold symbol the loser spends up to 40 GETs polling for the winner"
);

check(
  "a forced call bypasses the shared promise",
  /if \(force\) return await getDailyHistoryInner\(symbol, true, caller\);/.test(getDaily),
  "adopting an in-flight ordinary fetch would let a forced refresh report success having refreshed nothing"
);

check(
  "the in-flight entry is cleared in a finally",
  /finally \{[^}]*historyInFlight\.delete/s.test(history),
  "a rejected fetch left in the map would pin a permanently failing promise for the life of the instance"
);

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\nFAILED (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
