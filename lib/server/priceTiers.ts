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
//   picker result sets  the symbols the last build actually put on screen.
//                       If a row is rendered with a % change, that % change is
//                       being read.
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
export const TIER2_TTL_MS = 30 * 60_000;

// 30 rather than 60 is deliberate. The bandwidth difference between them is
// immaterial at this universe size, and during a volatile session an hour-old
// percentage change is visibly wrong to anyone with a second source open --
// which is worse than the saving is worth.

export const TIER1_SEARCH_PROMOTION_CAP = 100;

// How many of each free signal to take. Bounded so that one signal going
// haywire (a mover bucket returning the whole market, a picker build returning
// an unusually large result set) cannot swallow the universe.
export const TIER1_MOVER_CAP = 150;
export const TIER1_PICKER_CAP = 400;

export type Tier1Signals = {
  /** Symbols the last pickers build put on screen. */
  pickerSymbols: string[];
  /** Symbols people deliberately selected, most-wanted first. */
  searchedSymbols: string[];
  /** Today's gainers / losers / most-actives. */
  moverSymbols: string[];
  /** The universe the warm jobs maintain; tier 1 is always a subset of it. */
  universe: string[];
};

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

  const take = (list: string[], cap: number) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of list) {
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
      ...take(signals.searchedSymbols, TIER1_SEARCH_PROMOTION_CAP),
      ...take(signals.moverSymbols, TIER1_MOVER_CAP),
      ...take(signals.pickerSymbols, TIER1_PICKER_CAP),
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
