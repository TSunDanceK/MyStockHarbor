import { Redis } from "@upstash/redis";
import { getPickersData } from "./pickersBuilder";
import { readDynamicUniverse } from "./dynamicUniverseCache";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { readSearchDemand } from "./searchDemand";
import { readMarketState } from "./marketState";
import { selectTier1, writeTier1, readAboveFold, TIER1_SEARCH_PROMOTION_CAP } from "./priceTiers";
import { PICKER_ROUTES } from "../pickerRoutes";

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
// THOSE CRON STRINGS ARE THE ONES THAT WERE LIVE ON THE DAY OF THE MEASUREMENT
// and are deliberately not updated -- #374 has since staggered all of them off
// minute :00, and rewriting them here would falsify a dated observation to make
// it look current. For what runs TODAY, read the JOBS registry in jobRuns.ts,
// which is the source of truth and is asserted against vercel.json.
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
// warm-price-pool still refreshes a quarter of the universe per run, so full
// price coverage takes four of its runs -- ~20 minutes since the 2026-08-31
// stagger moved it from */3 to */5 (#374). Only the to-do-list lookup got
// cheaper. The cadence itself lives in the JOBS registry (jobRuns.ts); this
// comment cites it as context and must not become another copy of it.
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
  /**
   * How many symbols the last derivation put in the 15-minute price tier.
   *
   * Reported rather than returned. The tier LIST lives in its own Redis key
   * (priceTiers.ts) because warm-price-pool needs it on every run including the
   * ones this cache serves from memory, and because a job that only wants the
   * count should not have to hold ~500 strings to get it. This number exists so
   * a run record can show the split without a second read -- a tier system
   * nobody can see the size of is one nobody will notice has collapsed.
   */
  tier1: number;
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
      tier1: cached.tier1 ?? 0,
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

  // PRICE TIER 1, DERIVED HERE AND NOWHERE ELSE.
  //
  // This is the one place that already holds the pickers payload, and that
  // payload is the single most expensive input the tier selection needs. Doing
  // it in warm-price-pool would mean either a second ~8 MB read every run --
  // the exact spend that suspended the Upstash database on 2026-08-28 -- or a
  // second cache with its own opinion about how stale is too stale. Doing it in
  // three jobs would mean three answers.
  //
  // It rides this cache's TTL for the same reason the symbol list does: 30
  // minutes bounds how long a newly-interesting symbol waits to be promoted,
  // which is well inside the 15 minutes the promotion buys it back.
  const tier1 = await deriveTier1(symbols);
  await writeTier1(tier1);

  const targets: WarmTargets = {
    symbols,
    displayed: displayed.length,
    universe: universeSymbols.length,
    tier1: tier1.length,
  };

  await writeCachedTargets(targets);

  return targets;
}

/**
 * Attention signals -> tier 1, fail-open at every step.
 *
 * EVERY INPUT IS FREE. Search demand and market state are small Redis reads the
 * site already maintains, and the picker symbols are in hand. Nothing here
 * spends an FMP call, which is what makes it safe to run on a cache miss inside
 * a cron whose whole purpose is to conserve that budget.
 *
 * A signal that throws is dropped rather than fatal: tier 1 assembled from two
 * of three sources is worse than three, but far better than none -- an empty
 * tier 1 demotes the entire site to the 30-minute policy.
 */
async function deriveTier1(universe: string[]): Promise<string[]> {
  // What the picker pages actually put on screen, recorded by the pages
  // themselves. NOT the first N of signalRecords: that array is pushed in
  // universe-iteration order and never sorted, so slicing it promoted symbols
  // for their position in an analysis loop. See priceTiers.ts.
  const pickerSymbols = await readAboveFold(PICKER_ROUTES).catch(() => [] as string[]);

  const searchedSymbols = await readSearchDemand(TIER1_SEARCH_PROMOTION_CAP)
    .then((rows) => rows.map((r) => r.symbol))
    .catch(() => [] as string[]);

  const moverSymbols = await readMarketState()
    .then((state) => [
      // Movers first: a stock moving today is the one whose stale price is most
      // visibly wrong. topTraded is volume-ranked and is the weaker signal, so
      // it fills whatever of the cap is left.
      ...state.topMovers.map((r) => r.symbol),
      ...state.topTraded.map((r) => r.symbol),
    ])
    .catch(() => [] as string[]);

  return selectTier1({ pickerSymbols, searchedSymbols, moverSymbols, universe });
}
