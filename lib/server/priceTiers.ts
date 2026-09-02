// Which symbols are worth a 15-minute price, and which are fine at 30.
//
// THE PROBLEM THIS SOLVES. #392 wired quote calls into reserveFmpCallSlot and
// lowered the guard to 200/min. That worked -- http-429 went 171 -> 0 -- but it
// cost throughput: priceRefreshed fell 189 -> 130 per run and the share of the
// universe past its own 15-minute policy went 27% -> 52%. Over half the rows on
// a picker page were outside the freshness the page implies.
//
// Raising the guard back is not the fix; it re-opens the 429s. The fix is to
// stop spending the budget on refreshes that cannot matter, in two independent
// ways that multiply:
//
//   1. marketHours.ts        -- skip the ~two thirds of runs when the market is
//                               shut and the price cannot have moved.
//   2. these tiers           -- ask for a 15-minute price only where 15 minutes
//                               is worth something.
//
// The first is what pays for the second. Concentrating the same throughput into
// the ~8.5 hours prices actually move is roughly a 3x saving that costs nothing,
// which is why a 15-minute tier is affordable at all.
//
// ─────────────────────────────────────────────────────────────────────────────
// TIER 1 IS ATTENTION, NOT SIZE. EXPLICITLY NOT MARKET CAP.
//
// Market cap tells you what a company is worth, not whether anyone is looking
// at it. A live picker list showed FSLY at $3.33B directly above MSFT at
// $3.72T: cap-ordering would have put a $3.7T name nobody on the site had
// opened in the fast tier and left the $3.3B name they were actually reading in
// the slow one. Cap is also almost perfectly stable, so a cap-selected tier 1
// would never change membership -- it would be a hardcoded list wearing a
// heuristic's clothes.
//
// So tier 1 is assembled from signals this site ALREADY collects about where
// attention is, each of which costs nothing extra to read:
//
//   picker result sets  the rows a picker page actually PUT ON SCREEN --
//                       recorded by the page that rendered them, not inferred
//                       from the payload. See "above the fold" below.
//   deliberate views    searchDemand's ticker-interest counter -- a symbol a
//                       real person selected from search. Client-beacon only,
//                       so crawlers that never run JS never inflate it.
//   today's movers      the free gainers/losers/most-actives buckets
//                       warm-price-pool already fetches. A stock moving today
//                       is one whose stale price is most visibly wrong.
//   search promotions   capped, see below.
//
// THE SEARCH CAP IS A DECISION, NOT A CONSTANT TO TUNE. Search demand is the
// one input a stranger can move: it is public, unauthenticated and only
// rate-limited per IP. Uncapped, a bored script could promote the whole
// universe into the 15-minute tier and quietly undo this entire change.
// TIER1_SEARCH_PROMOTION_CAP bounds that blast radius at 100 symbols.
// ─────────────────────────────────────────────────────────────────────────────

import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const TIER1_KEY = "msh:price-tier1:v1";
// Outlives the warm-targets cache that writes it, so a failed rebuild degrades
// to a slightly stale tier list rather than to no tier list -- which would
// silently demote the whole universe to 30 minutes.
const TIER1_TTL_SECONDS = 2 * 60 * 60;

/** Top stocks by attention, plus up to 100 searched symbols. */
export const TIER1_TTL_MS = 15 * 60_000;
/** Everything else in the universe. */
export const TIER2_TTL_MS = 60 * 60_000;

// 60, CHANGED FROM 30, AND THE OLD ARGUMENT WAS NOT WRONG -- IT WAS SIZED FOR A
// SMALLER UNIVERSE. It read: "the bandwidth difference is immaterial at this
// universe size, and during a volatile session an hour-old percentage change is
// visibly wrong to anyone with a second source open". Both halves were true at
// 700 symbols. Neither survives 3,000:
//
//   15/30 at 3,000   7,000 calls/hour against a usable ceiling of ~6,720.
//                    117 of 140 permitted calls a minute, sustained for nine
//                    hours, leaving nothing for history, earnings or
//                    fundamentals. It does not fit.
//   15/60 at 3,000   4,500 calls/hour, 75 of 140, ~374 MB/month.
//
// So the trade is four times the coverage against a tail that is an hour old
// rather than half an hour, and the fast tier -- the ~500 names anyone is
// actually looking at -- keeps its 15 minutes. That is the whole point of
// having tiers: the degradation lands where it is least visible.
//
// AN ADAPTIVE BACKOFF WAS CONSIDERED AND REJECTED. "Do not refresh what is not
// moving" bought ~22% of a budget that already has a third spare, and its cost
// was per-symbol drift state whose failure mode is a plausible-looking wrong
// price with nothing reporting it. Do not build it.

export const TIER1_SEARCH_PROMOTION_CAP = 100;

// How many of each free signal to take. Bounded so that one signal going
// haywire (a mover bucket returning the whole market, a picker build returning
// an unusually large result set) cannot swallow the universe.
export const TIER1_MOVER_CAP = 150;

// ─────────────────────────────────────────────────────────────────────────────
// ABOVE THE FOLD: THE PAGE RECORDS WHAT IT RENDERED.
//
// The first version of this signal took the first TIER1_PICKER_CAP (400)
// entries of the pickers payload's signalRecords. That was wrong twice over:
//
//   * A picker page renders `config.maxItems ?? 36` rows; the rest sit behind
//     "Show more" (PickerResultPage.tsx, PickerResultsGrid's
//     sortedEntries.slice(0, visibleCount)). So 400 entries stood in for ~36
//     rendered ones -- roughly 364 symbols promoted to the 15-minute tier for
//     being in a payload, not for being looked at.
//   * WHICH 400 was decided by signalRecords' order, and signalRecords is
//     pushed inside the universe analysis loop (pickersBuilder.ts:3567) and
//     never sorted. It is iteration order. That is a stable ordering dressed as
//     a signal -- the exact thing this file already refuses market cap for.
//
// It could not be reconstructed here either: 33 of the 36 picker routes are
// `kind: "preset"`, built by filtering signalRecords with each page's own
// presetFilters and sorting by its own orderBy. Reproducing that in a cron
// means importing 36 page configs and re-running the page's own logic, and the
// answer would be a guess at what the page did rather than what it did.
//
// So the claim is made by the thing that can actually make it. The page writes
// its own above-the-fold symbols on render; this reads them back. Same Redis
// client and same render path as the readPricePoolBulk that already runs there,
// so it carries no new prerender risk (PAGE_READ_CACHE, see redisCacheMode.ts).
// Pages are ISR'd at 1800s, so this is ~72 writes an hour across all 36 routes.
//
// ONE KEY PER ROUTE, WITH ITS OWN TTL, so a page that stops being rendered
// drops out of the signal on its own rather than lingering in a shared hash
// until something evicts it. Absence is meaningful here: a route nobody has
// loaded in two hours has no above-the-fold rows, and should not have any.
const FOLD_KEY_PREFIX = "msh:picker-fold:v1:";
// Comfortably longer than the 1800s page revalidate, so a normally-serving page
// is always represented, and short enough that a removed or renamed route
// disappears within a couple of hours.
const FOLD_TTL_SECONDS = 2 * 60 * 60;
// Nothing to do with taste: the largest maxItems any picker page declares. A
// page rendering more than this would be under-recorded, which
// scripts/check-price-tiers.mjs asserts against the pages themselves.
export const FOLD_MAX_ROWS_PER_ROUTE = 60;

// ─────────────────────────────────────────────────────────────────────────────
// A BASE THAT WORKS WITH ZERO VISITORS, AND AN ATTENTION LAYER ON TOP.
//
// THE DEFECT THIS FIXES IS LIVE, not hypothetical. Two of the three signals
// this selector read were TRAFFIC-FED -- readAboveFold records a row when a
// page renders, and readSearchDemand needs three distinct searchers before a
// symbol counts. The site has essentially no traffic yet, so both are empty and
// tier 1 collapsed to the mover buckets alone. The design measured attention
// without ever checking that any existed.
//
// #396 made it worse. The picker signal used to be the first 400 rows of the
// pickers payload, which was arbitrary -- ranked by position in an analysis
// loop. Moving it to above-the-fold-on-render was right in principle and traded
// an arbitrary signal for a near-empty one. This fixes both: the arbitrary
// ordering stays gone, and nothing traffic-fed is load-bearing.
//
//   BASE   works with no visitors at all
//     preset            ~100 hand-curated mega-caps, PRESET_UNIVERSE
//     dollar volume     price x volume from the pool, top TIER1_DOLLAR_VOLUME_CAP
//     movers            the free gainer/loser/most-active buckets
//
//   LAYER  adds as traffic arrives, never required
//     searched          capped at TIER1_SEARCH_PROMOTION_CAP
//     rendered rows     readAboveFold, unchanged
//
// DOLLAR VOLUME IS NOT MARKET CAP, AND THE DISTINCTION IS THE WHOLE POINT.
// Market cap was rejected here in #395 and stays rejected: a live picker list
// showed FSLY at $3.33B directly above MSFT at $3.72T, and cap ordering would
// put a $3.7T name nobody has opened in the fast tier. Dollar volume measures
// how much is actually being TRADED, which is much closer to "whose stale price
// would be noticed" -- a $3B name can out-trade a sleepy $50B utility. Both
// price and volume are already on PricePoolRow, so this costs no FMP call.
// ─────────────────────────────────────────────────────────────────────────────

/** Top names by price x volume. Fixed, not a fraction of the universe. */
export const TIER1_DOLLAR_VOLUME_CAP = 300;

export type Tier1Signals = {
  // ---- base: must produce a usable tier 1 with every field below it empty ----
  /** PRESET_UNIVERSE, the hand-curated mega-caps. */
  presetSymbols: string[];
  /** Universe symbols ranked by pooled price x volume, heaviest first. */
  dollarVolumeRanked: string[];
  /** Today's gainers / losers / most-actives. */
  moverSymbols: string[];

  // ---- layer: traffic-fed, additive, never required ----
  /** Symbols people deliberately selected, most-wanted first. */
  searchedSymbols: string[];
  /** Rows a picker page actually rendered above the fold. */
  pickerSymbols: string[];

  /** The universe the warm jobs maintain; tier 1 is always a subset of it. */
  universe: string[];
};

/**
 * Rank universe symbols by pooled dollar volume, heaviest first.
 *
 * COLD ROWS ARE UNKNOWN, NOT ZERO, and are left out of the ranking entirely
 * rather than sorted to the bottom. A symbol with no pool row has no dollar
 * volume to compare; ranking it last would be asserting it is quiet when the
 * truth is that nobody has asked yet, and a newly admitted mover would be
 * exactly the symbol that gets it wrong.
 *
 * Leaving it out is safe because tier only decides HOW OFTEN a symbol refreshes
 * after its first price, and isPriceDue already treats a symbol with no `ts` as
 * DUE -- so a cold symbol is picked up on the very next run whatever tier it is
 * in, gains a row, and ranks properly from then on. The exposure is one run.
 *
 * The tie-break on symbol is not cosmetic: without it two runs over identical
 * pool data could produce different tier 1 sets, and the membership of the fast
 * tier would flicker for reasons nothing could explain.
 */
export function rankByDollarVolume(
  rows: Map<string, { price: number | null; volume: number | null }>,
  universe: string[]
): string[] {
  const scored: Array<{ symbol: string; dollars: number }> = [];
  for (const raw of universe) {
    const symbol = clean(raw);
    const row = rows.get(symbol);
    if (!row || row.price == null || row.volume == null) continue;
    const dollars = row.price * row.volume;
    if (!Number.isFinite(dollars) || dollars <= 0) continue;
    scored.push({ symbol, dollars });
  }
  scored.sort((a, b) => b.dollars - a.dollars || a.symbol.localeCompare(b.symbol));
  return scored.map((s) => s.symbol);
}

function clean(value: string) {
  return String(value || "").trim().toUpperCase();
}

/**
 * Assemble tier 1 from the attention signals.
 *
 * PURE, so it can be RUN by the invariant check rather than pattern-matched out
 * of the source. A regex over this file could not tell a cap that is applied
 * from one that is merely declared, and this project has shipped that exact
 * false confidence before (claude/traps/a-regex-over-source-has-no-scope.md).
 *
 * Order matters: each source is capped independently and the caps are applied
 * BEFORE the union, so a large picker set cannot crowd out the searched symbols
 * a person explicitly asked for.
 */
export function selectTier1(signals: Tier1Signals): string[] {
  const universe = new Set(signals.universe.map(clean).filter(Boolean));
  if (!universe.size) return [];

  // `list ?? []` is not defensive clutter. deriveTier1 assembles five arrays and
  // every one of them can be absent if a future caller forgets a field -- and a
  // throw here does not degrade tier 1, it propagates out through
  // getWarmTargetSymbols and takes the work list for ALL THREE warm jobs with
  // it. A selector whose entire purpose is "never return nothing" must not be
  // the thing that returns nothing by throwing.
  const take = (list: string[] | undefined | null, cap: number) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of list ?? []) {
      const symbol = clean(raw);
      // Tier 1 NEVER admits a symbol outside the warm universe. Promoting one
      // would hand a stranger with a search box the power to add work to every
      // run for a ticker the site does not display.
      if (!symbol || seen.has(symbol) || !universe.has(symbol)) continue;
      seen.add(symbol);
      out.push(symbol);
      if (out.length >= cap) break;
    }
    return out;
  };

  return Array.from(
    new Set([
      // BASE FIRST, so that when a cap does bind it is the traffic-fed layer
      // that gives way -- the opposite would let a quiet week shrink the fast
      // tier, which is the failure this ordering exists to prevent.
      ...take(signals.presetSymbols, signals.presetSymbols?.length ?? 0),
      ...take(signals.dollarVolumeRanked, TIER1_DOLLAR_VOLUME_CAP),
      ...take(signals.moverSymbols, TIER1_MOVER_CAP),

      // LAYER.
      ...take(signals.searchedSymbols, TIER1_SEARCH_PROMOTION_CAP),
      // NO CAP. There is nothing arbitrary left to bound: this list is already
      // bounded by what the pages rendered, which is the real quantity. Adding
      // a number here would be trimming the signal until it looked right, which
      // is what the 400 was.
      ...take(signals.pickerSymbols, Number.MAX_SAFE_INTEGER),
    ])
  );
}

/**
 * The freshness policy for one symbol, in ms.
 *
 * Tier 2 is the default on purpose: an unreadable tier list, an empty one, or a
 * symbol nobody has looked at all degrade to 30 minutes, never to "never
 * refresh".
 */
export function priceTtlMsFor(symbol: string, tier1: ReadonlySet<string>): number {
  return tier1.has(clean(symbol)) ? TIER1_TTL_MS : TIER2_TTL_MS;
}

/**
 * Is this symbol's pooled price past its own tier's policy?
 *
 * A symbol with no row at all (ts undefined) is due: never-fetched must sort
 * ahead of merely-stale, not be mistaken for fresh.
 */
export function isPriceDue(
  lastTs: number | undefined | null,
  symbol: string,
  tier1: ReadonlySet<string>,
  nowMs: number
): boolean {
  if (typeof lastTs !== "number" || !Number.isFinite(lastTs) || lastTs <= 0) return true;
  return nowMs - lastTs >= priceTtlMsFor(symbol, tier1);
}

/**
 * Record the symbols a picker page just rendered above the fold.
 *
 * Called from the page's own render. Never throws and never blocks a render on
 * a Redis fault -- a lost write costs this route its tier-1 contribution for
 * one revalidate window, nothing else.
 */
export async function recordAboveFold(route: string, symbols: string[]): Promise<void> {
  if (!redis || !route || !symbols.length) return;
  const rows = Array.from(new Set(symbols.map(clean).filter(Boolean))).slice(
    0,
    FOLD_MAX_ROWS_PER_ROUTE
  );
  if (!rows.length) return;
  try {
    await redis.set(`${FOLD_KEY_PREFIX}${route}`, rows, { ex: FOLD_TTL_SECONDS });
  } catch {
    // fail open -- never break a page render for a telemetry write.
  }
}

/**
 * The union of what every listed picker route last rendered above the fold.
 *
 * Reads by the registry rather than by SCAN: lib/pickerRoutes.ts is already
 * asserted against the pages that exist (scripts/check-picker-routes.mjs), so
 * it cannot silently miss a route, and one MGET is one command regardless of
 * how many there are.
 */
export async function readAboveFold(routes: readonly string[]): Promise<string[]> {
  if (!redis || !routes.length) return [];
  try {
    const stored = await redis.mget<(string[] | null)[]>(
      ...routes.map((route) => `${FOLD_KEY_PREFIX}${route}`)
    );
    const out: string[] = [];
    for (const rows of stored ?? []) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const symbol = clean(row);
        if (symbol) out.push(symbol);
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function writeTier1(symbols: string[]): Promise<void> {
  if (!redis) return;
  // NEVER WRITE AN EMPTY LIST. An empty tier 1 is what a failed pickers read
  // looks like, and pinning it would silently demote the whole site to 30
  // minutes with every job still reporting a clean run -- the same failure
  // warmTargets guards against for its own list.
  if (!symbols.length) return;
  try {
    await redis.set(TIER1_KEY, symbols, { ex: TIER1_TTL_SECONDS });
  } catch {
    // fail open -- a failed write costs a tier, not correctness.
  }
}

export async function readTier1(): Promise<Set<string>> {
  if (!redis) return new Set();
  try {
    const stored = await redis.get<string[]>(TIER1_KEY);
    if (!Array.isArray(stored)) return new Set();
    return new Set(stored.map(clean).filter(Boolean));
  } catch {
    return new Set();
  }
}
