import { Redis } from "@upstash/redis";
import { getPickersData } from "./pickersBuilder";
import { readDynamicUniverse } from "./dynamicUniverseCache";
import { PAGE_READ_CACHE } from "./redisCacheMode";

// Single source of truth for "which symbols do the background warm jobs
// maintain data for" -- used by warm-price-pool, warm-stock-data and
// warm-fundamentals so the three can never drift apart.
//
// WHY A UNION, NOT A REPLACEMENT
// ------------------------------
// All three jobs previously took their work list from `payload.signalRecords`
// -- the symbols the last pickers build actually analyzed. That is the set the
// site DISPLAYS, so it must stay covered: drop a symbol from here and its
// price, PE, market cap and valuation columns go blank on a page that is
// currently rendering it.
//
// But it is not the set the site will display NEXT build. The dynamic universe
// is the rolling candidate pool, and a symbol that rotates into the scan having
// never been warmed arrives completely cold -- no price, no fundamentals, no
// extended data -- and stays that way until the next daily fundamentals run.
// That is precisely the failure mode that raising UNIVERSE_CAP and adding scan
// rotation would otherwise create.
//
// So it must be BOTH:
//   signalRecords      -> what is on screen now. Never drop these.
//   dynamic universe   -> what could be on screen next. Warm them in advance.
//
// Replacing rather than unioning would be an outright regression, and not an
// obvious one: PRESET_UNIVERSE's ~100 mega-caps are guaranteed slots in the
// pickers scan but are NOT necessarily members of the dynamic universe (that
// pool is fed by market discovery and search demand). Point the warm jobs at
// the dynamic universe alone and AAPL/MSFT/NVDA can silently lose their pooled
// price and PE while still being displayed on every screener page.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THE RESULT IS CACHED IN ITS OWN KEY
//
// Deriving that union is cheap. FETCHING ITS INPUT WAS NOT.
//
// getPickersData() reads the whole pickers payload -- ~8 MB -- out of Redis,
// and this function used it for exactly one thing: `.map(r => r.symbol)`, a
// list of ~450 tickers, about 3 KB. Everything else crossed the network and was
// discarded.
//
// Three crons call this. Measured 2026-08-28, on a day when production served
// ~250 user requests in three hours:
//
//   warm-price-pool    */3  ->  480 runs/day  ->  ~3.8 GB/day
//   warm-stock-data   */10  ->  144 runs/day  ->  ~1.1 GB/day
//   warm-fundamentals  0 *  ->   24 runs/day  ->  ~0.2 GB/day
//                                  648/day        ~5 GB/day
//
// ~150 GB a month of Redis read bandwidth to look up a few kilobytes of ticker
// symbols. That is the shape of the spend that suspended the Upstash database
// on 2026-08-28 (claude/outage-upstash-suspended-2026-08-28.md); user traffic
// was nowhere near large enough to explain it.
//
// So the union is now computed at most once per WARM_TARGETS_TTL_SECONDS and
// parked in its own small key. Simulated against the real cron schedule, the
// expensive read happens 45 times a day instead of 648 -- ~5.06 GB/day down to
// ~0.35 GB/day, a 93% cut -- and every other call is a few-KB GET.
//
// WHAT THIS DOES NOT CHANGE: cadence, coverage, or which symbols get warmed.
// warm-price-pool still runs every 3 minutes and still refreshes a quarter of
// the universe per run, so full price coverage stays at ~12 minutes. Only the
// to-do-list lookup got cheaper.
//
// ON THE TTL. 30 minutes is a staleness budget, not a performance knob. It
// bounds how long a symbol newly admitted to the displayed set can wait before
// the warm jobs know about it. That is comfortably inside what the consumers
// already tolerate -- warm-stock-data takes ~3h for a full lap and
// warm-fundamentals is hourly -- so the binding constraint is unchanged.
// Shortening it costs bandwidth linearly and buys nothing those jobs can use.
//
// There is deliberately no explicit invalidation on a pickers rebuild. Adding
// one means writing to this key from pickersBuilder.ts, a 117KB file that
// cannot be edited through the GitHub connector, to shave minutes off a lag
// nothing downstream is fast enough to notice.
// ─────────────────────────────────────────────────────────────────────────────

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const WARM_TARGETS_KEY = "msh:warm-targets:v1";
const WARM_TARGETS_TTL_SECONDS = 30 * 60;

export type WarmTargets = {
  symbols: string[];
  displayed: number;
  universe: number;
};

type CachedWarmTargets = WarmTargets & { builtAt: number };

function isUsable(value: unknown): value is CachedWarmTargets {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CachedWarmTargets>;
  return (
    Array.isArray(candidate.symbols) &&
    candidate.symbols.length > 0 &&
    candidate.symbols.every((s) => typeof s === "string" && s.length > 0)
  );
}

async function readCachedTargets(): Promise<CachedWarmTargets | null> {
  if (!redis) return null;
  try {
    const cached = await redis.get<CachedWarmTargets>(WARM_TARGETS_KEY);
    return isUsable(cached) ? cached : null;
  } catch {
    // fail open -- a failed read just means we pay for the full derivation,
    // which is exactly the previous behaviour.
    return null;
  }
}

async function writeCachedTargets(targets: WarmTargets) {
  if (!redis) return;
  // NEVER CACHE AN EMPTY LIST. An empty result means the pickers read failed or
  // the payload was mid-rebuild, and pinning that for 30 minutes would idle all
  // three warm jobs -- prices would silently go stale site-wide with every job
  // reporting a clean run against zero targets.
  if (!targets.symbols.length) return;
  try {
    await redis.set<CachedWarmTargets>(
      WARM_TARGETS_KEY,
      { ...targets, builtAt: Date.now() },
      { ex: WARM_TARGETS_TTL_SECONDS }
    );
  } catch (error) {
    // fail open -- a failed write costs bandwidth on the next run, not
    // correctness.
    console.warn(
      "[warm-targets] cache write failed",
      error instanceof Error ? error.message : error
    );
  }
}

/**
 * Symbols the background jobs should keep warm: everything the last pickers
 * build analyzed, plus the whole rolling dynamic universe.
 *
 * Served from a small Redis key when one is warm; derived from the full pickers
 * payload otherwise, then cached. Callers see no difference -- same name, same
 * signature, same return shape as before.
 *
 * Fail-open at every step. The jobs must never end up with an empty work list
 * because a secondary read failed.
 */
export async function getWarmTargetSymbols(base: string): Promise<WarmTargets> {
  const cached = await readCachedTargets();
  if (cached) {
    return {
      symbols: cached.symbols,
      displayed: cached.displayed,
      universe: cached.universe,
    };
  }

  // Cache miss. This is the ~8 MB read; log it so the cut is visible in Vercel
  // logs and a regression to per-run reads is obvious rather than silent.
  console.log("[warm-targets] cache miss -- deriving from the pickers payload");

  const payload = await getPickersData(base);
  const displayed = Array.from(
    new Set((payload.signalRecords ?? []).map((r) => r.symbol).filter(Boolean))
  );

  let universeSymbols: string[] = [];
  try {
    universeSymbols = (await readDynamicUniverse()).map((entry) => entry.symbol).filter(Boolean);
  } catch {
    // fail open -- fall back to displayed-only, i.e. the pre-change behaviour
  }

  const symbols = Array.from(new Set([...displayed, ...universeSymbols]));
  const targets: WarmTargets = {
    symbols,
    displayed: displayed.length,
    universe: universeSymbols.length,
  };

  await writeCachedTargets(targets);

  return targets;
}
