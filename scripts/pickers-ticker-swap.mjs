// One-off: the four stale tickers A found on EDGAR (Relay B, #553 COWORK #20).
//
//   BK  -> BNY   ticker change, same CIK
//   EQR -> VMRK  ticker change
//   EA          delisted 2026-08-04 (25-NSE)
//   WBS         delisted 2026-08-20 (25-NSE)
//
// A successor ENTERS WITH ITS PREDECESSOR'S SCORE. The dynamic universe keeps
// the top 700 by cumulative score; a ticker added at score 1 sits under
// hundreds of established names and is pruned before any build sees it, so a
// rename added "plainly" would vanish. The old ticker is then evicted through
// the sweep's own evictSymbol (keys, hashes, zsets, audit entry) and
// deregistered, exactly as the daily sweep would.
//
// Idempotent: a successor already scored is not boosted again, and evicting
// an absent symbol deletes nothing. `--dry` reports without writing.
//
//   relay task: write-pickers-ticker-swap (owner's GO only)
//   Redis: dynamic-universe read (2) + tombstone gate and ZINCRBYs for 2
//   successors (~4) + evictSymbol x4 (one pipeline + one ZADD each, ~8) +
//   deregister (~1) = ~15, once.
import "./lib/register-ts-here.mjs";

const dry = process.argv.includes("--dry");
const D = await import("../lib/server/dynamicUniverseCache.ts");
const E = await import("../lib/server/symbolEviction.ts");
const Q = await import("../lib/server/stalenessQueue.ts");
const T = await import("../lib/server/secTickerMap.ts");
const { lookupBySpelling } = await import("../lib/symbolSpellings.mjs");

const RENAMES = [["BK", "BNY"], ["EQR", "VMRK"]];
const DELISTED = ["EA", "WBS"];

const live = await T.resolveTickerMap();
if (live.source !== "redis" || live.stale) throw new Error(`refusing: SEC map ${live.source}, stale ${live.stale}`);
for (const [from, to] of RENAMES) {
  if (lookupBySpelling(live.map, from)) throw new Error(`refusing: SEC still lists ${from}`);
  if (!lookupBySpelling(live.map, to)) throw new Error(`refusing: SEC does not list ${to}`);
}
for (const s of DELISTED) if (lookupBySpelling(live.map, s)) throw new Error(`refusing: SEC still lists ${s}`);

const scores = new Map((await D.readDynamicUniverse()).map((e) => [e.symbol, e.score]));
for (const [from, to] of RENAMES) {
  const carry = scores.get(from) ?? 0;
  const have = scores.get(to) ?? 0;
  const boost = Math.max(0, carry - have);
  console.log(`${from} -> ${to}: ${from} score ${carry}, ${to} score ${have}; boost ${boost}${dry ? " (dry)" : ""}`);
  if (!dry && boost > 0) await D.addToDynamicUniverse([to], "market", boost);
}
const gone = [...RENAMES.map(([from]) => from), ...DELISTED];
for (const s of gone) {
  if (dry) { console.log(`evict ${s} (dry)`); continue; }
  const out = await E.evictSymbol(s);
  console.log(`evict ${s}: ${JSON.stringify(out)}`);
}
if (!dry) await Q.deregisterSymbols(gone);
if (!dry) {
  const after = new Map((await D.readDynamicUniverse()).map((e) => [e.symbol, e.score]));
  for (const [, to] of RENAMES) console.log(`after: ${to} score ${after.get(to) ?? "absent"}`);
  for (const s of gone) console.log(`after: ${s} ${after.has(s) ? "STILL PRESENT" : "gone"}`);
}
console.log("The Pickers payload picks the change up on its next build.");
