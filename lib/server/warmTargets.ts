import { Redis } from "@upstash/redis";
import { getPickersData, readPickersSymbolsIfCached } from "./pickersBuilder";
import { readDynamicUniverse } from "./dynamicUniverseCache";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { readSearchDemand } from "./searchDemand";
import { readMarketState } from "./marketState";
import {
  selectTier1,
  writeTier1,
  readAboveFold,
  rankByDollarVolume,
  TIER1_SEARCH_PROMOTION_CAP,
} from "./priceTiers";
import { PRESET_UNIVERSE } from "./presetUniverse";
import { readPricePoolBulk } from "./pricePool";
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
// ─────────────────────────────────────────────────────────────────────────────
// THAT ~0.35 GB/DAY WAS WRONG BY TEN TIMES, AND THE ERROR IS INSTRUCTIVE.
//
// It prices a miss at "the ~8 MB read", which is what readPickersCache costs.
// But getPickersData does not only READ. On a payload miss it BUILDS, and a
// build reads every symbol's history out of Redis at ~110 KB a symbol -- about
// 80 MB. This key lives 30 minutes and the pickers payload lives 60, so roughly
// every other miss landed on an expired payload and a five-minute cron rebuilt
// the entire site.
//
// Measured in production 2026-09-04, market shut, no human traffic: hourly
// `[warm-targets] cache miss` -> `[pickers] build complete` -> warm-price-pool
// returning `{"skipped":true,"reason":"market-closed"}` without using the list
// it had just paid 80 MB and ten seconds for. See
// claude/history-read-path-2026-09-04.md.
//
// The paragraph above is left standing rather than corrected in place: it was
// true of the change it described, and the defect was that its cost model went
// stale when getPickersData's miss path became expensive. A number written in a
// comment is a measurement with no expiry date on it, which is why the fix is
// the meter in redisBandwidth.ts and not a better paragraph.
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// THE FALLBACK COPY, AND WHY A SECOND KEY RATHER THAN A LONGER TTL.
//
// The 30-minute TTL above is a STALENESS BUDGET -- it says how long a newly
// displayed symbol may wait before the warm jobs know about it. Lengthening it
// would trade that budget away. This key trades nothing: it is the same list,
// kept for a week, and it is read only when the fresh one has expired AND the
// pickers payload is not cached either.
//
// WHAT IT REPLACES. That combination used to fall through to getPickersData(),
// which BUILDS on a payload miss -- ~80 MB of Redis history reads and ten
// seconds, from a five-minute cron, to obtain a list of ~760 tickers. Measured
// hourly overnight with the market shut (see readPickersSymbolsIfCached).
//
// A day-old symbol list is a far smaller error than a full rebuild an hour: the
// list is the union of the displayed set and the rolling dynamic universe, and
// both move by a handful of tickers a day. Nothing downstream is fast enough to
// notice -- warm-stock-data laps in ~3h and warm-fundamentals is hourly, the
// same argument the 30-minute budget already rests on.
//
// A WEEK, NOT FOREVER. Long enough that no ordinary outage exhausts it, short
// enough that a permanently broken payload eventually reports an empty list
// rather than warming a set of tickers from an abandoned universe forever.
const WARM_TARGETS_FALLBACK_KEY = "msh:warm-targets:v1:last-good";
const WARM_TARGETS_FALLBACK_TTL_SECONDS = 7 * 24 * 60 * 60;

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

async function readFallbackTargets(): Promise<CachedWarmTargets | null> {
  if (!redis) return null;
  try {
    const cached = await redis.get<CachedWarmTargets>(WARM_TARGETS_FALLBACK_KEY);
    return isUsable(cached) ? cached : null;
  } catch {
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
    const entry: CachedWarmTargets = { ...targets, builtAt: Date.now() };
    // BOTH, IN ONE PIPELINE. Written together so the fallback can never be
    // older than the last successful derivation, and cannot drift into being a
    // list nothing ever refreshed.
    const p = redis.pipeline();
    p.set(WARM_TARGETS_KEY, entry, { ex: WARM_TARGETS_TTL_SECONDS });
    p.set(WARM_TARGETS_FALLBACK_KEY, entry, { ex: WARM_TARGETS_FALLBACK_TTL_SECONDS });
    await p.exec();
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

  // Cache miss. Log it so the cut is visible in Vercel logs and a regression to
  // per-run reads is obvious rather than silent.
  console.log("[warm-targets] cache miss -- deriving from the pickers payload");

  // A READ THAT CANNOT BECOME A BUILD.
  //
  // This used to be `await getPickersData(base)`, and that call does not only
  // read: on a payload miss it rebuilds the whole picker universe, which reads
  // every symbol's history out of Redis at ~110 KB each. The pickers payload
  // lives 60 minutes and this cache 30, so roughly every other miss landed on
  // an expired payload and a five-minute cron rebuilt the site. Observed
  // hourly, overnight, with the market shut and the caller then skipping.
  //
  // readPickersSymbolsIfCached returns null instead of building, and skips the
  // chart re-attach the symbol list never needed.
  let cachedSymbols = await readPickersSymbolsIfCached();

  if (!cachedSymbols) {
    // The payload is not cached. Serve the last good list rather than becoming
    // the thing that rebuilds it -- a day-old symbol list costs a handful of
    // tickers' freshness; a rebuild here costs ~80 MB and ten seconds, every
    // hour, forever.
    const fallback = await readFallbackTargets();
    if (fallback) {
      console.log(
        `[warm-targets] payload not cached -- serving the last good list ` +
          `(${fallback.symbols.length} symbols, ` +
          `${Math.round((Date.now() - fallback.builtAt) / 60000)}m old) rather than building`
      );
      return {
        symbols: fallback.symbols,
        displayed: fallback.displayed,
        universe: fallback.universe,
        tier1: fallback.tier1 ?? 0,
      };
    }

    // NO FRESH KEY, NO PAYLOAD, NO FALLBACK. A genuine cold start -- a new
    // deploy against an empty namespace -- and the only remaining option is to
    // build. Left in deliberately: the alternative is warm jobs that never
    // start, which is a silent site-wide freshness failure rather than a bill.
    console.warn(
      "[warm-targets] cold start -- no cached payload and no fallback list, building"
    );
    const payload = await getPickersData(base);
    cachedSymbols = (payload.signalRecords ?? []).map((r) => r.symbol).filter(Boolean);
  }

  const displayed = Array.from(new Set(cachedSymbols.filter(Boolean)));

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
 * A signal that throws is dropped rather than fatal: a tier 1 assembled from
 * some of its sources is worse than all of them, but far better than none -- an
 * empty tier 1 demotes the entire site to the 60-minute policy.
 *
 * THE BASE IS WHAT MAKES THAT SAFE. PRESET_UNIVERSE is a hand-typed array in
 * the bundle, so it cannot fail to load, cannot be empty, and does not need a
 * visitor, a Redis read or an FMP call. Even if every other signal here throws,
 * tier 1 is ~100 mega-caps rather than nothing. That is the property the
 * traffic-fed design did not have.
 */
async function deriveTier1(universe: string[]): Promise<string[]> {
  // ---- BASE. None of this needs a visitor. ----

  // Dollar volume, price x volume, straight off the pool rows the price warm
  // already maintains. One HMGET, no FMP call. NOT market cap -- see the note
  // above Tier1Signals for why the two are different questions.
  const dollarVolumeRanked = await readPricePoolBulk(universe)
    .then((rows) => rankByDollarVolume(rows, universe))
    .catch(() => [] as string[]);

  // ---- LAYER. Empty until the site has traffic, and that is fine. ----

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

  return selectTier1({
    presetSymbols: PRESET_UNIVERSE,
    dollarVolumeRanked,
    moverSymbols,
    searchedSymbols,
    pickerSymbols,
    universe,
  });
}
