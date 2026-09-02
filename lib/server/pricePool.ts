// The FMP calls below carried `cache: "no-store"`, which opts any route that
// reaches them out of static rendering entirely -- the same class of bailout
// @upstash/redis caused via its own no-store default (lib/server/redisCacheMode.ts).
// They only fire on a Redis miss, so the bailout is intermittent and invisible:
// the route silently renders per request whenever the cache happens to be cold.
// Redis remains the real cache here, with its own TTL; this short Next
// revalidate exists so the call stops forcing the route dynamic, and it dedupes
// identical misses inside one render pass. Same fix as historyCache.ts; see
// claude/picker-pages-isr-2026-08-20.md.
import { Redis } from "@upstash/redis";
import { markRefreshed, registerSymbols, deferSymbol, readDeferred } from "./stalenessQueue";
import { isFmpErrorEnvelope } from "./fmpResponse";
import { fmpFetch } from "./fmpUsage";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import {
  hasFmpCapacity,
  reserveFmpCallSlot,
  FMP_SAFE_CALLS_PER_MINUTE,
} from "./historyCache";
import { isActiveMarketWindow } from "./marketHours";
import { isPriceDue, readTier1, TIER1_TTL_MS, TIER2_TTL_MS } from "./priceTiers";
import { JOBS, cronIntervalSeconds } from "./jobRuns";

// A single Redis HASH holding a lightweight, rolling-fresh quote for every
// symbol the screener can display: price, % change, volume, market cap and PE.
// Using ONE hash (not one key per symbol) keeps Redis command + storage cost
// near zero -- a refresh is a single HSET of just the slice we touched, and a
// page read is a single HMGET for just the symbols it shows. Populated by the
// warm-price-pool cron (app/api/jobs/warm-price-pool); READ-ONLY on page
// renders so a page load never spends an FMP call.
//
// FMP Starter plan reality (confirmed live 2026-07-22/23):
//   * No working multi-symbol quote endpoint (stable/batch-quote 402,
//     api/v3/quote 403) -> every field is ONE call PER TICKER.
//   * stable/quote (per symbol)   -> price / %chg / volume / marketCap (no PE)
//   * stable/ratios-ttm (per sym) -> priceToEarningsRatioTTM (the only PE source)
//   * Limit is 300 calls/MIN (no daily cap; a 30-day rolling bandwidth cap on
//     top -- FMP_BANDWIDTH_CAP_BYTES in fmpUsage.ts). The working guard is
//     lower still (FMP_SAFE_CALLS_PER_MINUTE, 200 since #392) and quote calls
//     now count against it, which is what made the tier policy below
//     necessary.
//
// PRICE and PE have very different volatilities, so they refresh on independent
// rotations, each tracked by its own timestamp on the row:
//   * price (`ts`)   -> refreshed for whichever symbols are PAST THEIR OWN
//     TIER'S TTL: 15 minutes for the attention tier, 30 for everything else
//     (lib/server/priceTiers.ts). Only during the buffered US session
//     (lib/server/marketHours.ts) -- outside it the last traded price is the
//     price, so a refresh returns what is already stored. The per-run cap is
//     derived from that TTL and the registry's own cron rather than stated as a
//     fraction of the universe, which is a unit that changes meaning whenever
//     the cadence does.
//   * PE (`peTs`)    -> slow trickle of the stalest-by-`peTs` symbols per run;
//     a P/E barely moves hour to hour, so full coverage in a couple hours then
//     just rolling is plenty. Last-known PE is carried forward on a miss.
// Only the touched fields are written; everything else persists. The hash also
// carries a safety TTL (reset every run) so a stopped cron self-expires.
//
// FREE HEAD START -- FMP "market performance" buckets (confirmed live 2026-07-23):
// stable/biggest-gainers, stable/biggest-losers, stable/most-actives are each
// ONE call returning up to 50 ranked rows (price + changesPercentage, no volume
// or marketCap). Real overlap with our curated/index universe is modest --
// gainers/losers skew hard to penny stocks, most-actives skews to leveraged
// ETFs -- typically ~15-20% of a run's universe, mostly via most-actives. Still
// free (3 calls total regardless of universe size), so every run spends them
// first: any universe symbol they cover gets its price/%change from the bucket
// instead of a per-symbol stable/quote call, and is excluded from this run's
// stalest-slice selection. This NEVER expands the universe (bucket rows outside
// `clean` are ignored) and NEVER replaces the per-symbol rotation -- it only
// shrinks what that rotation has to do this run. Buckets don't carry volume/PE,
// so those fields still only ever come from the per-symbol calls below.
//
// COLD-START SEED (STEP 3, 2026-08-06 follow-up session): a symbol just
// admitted by discovery (app/api/market/route.ts) has ts=0 here, so it wins
// the stalest-first sort on the very next warm-price-pool run -- but if a
// discovery batch admits enough symbols to exceed a single run's priceCap,
// some of them queue behind each other across several runs. Discovery already fetches a stable/quote per admitted symbol for its
// own purposes (building the homepage-movers quote cache); seedColdPricePoolRows
// below reuses that ALREADY-FETCHED quote to give the symbol a real baseline
// row immediately, at zero extra FMP cost. It only fills symbols with NO
// existing pool row, so it can never clobber a fresher value the normal
// rotation already wrote. This is stable/quote data (confirmed live, not an
// average -- see /api/debug/fmp-endpoints STEP 1 the same session), not
// screener data, so it carries none of the staleness caveats screener price
// would.

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const PRICE_POOL_KEY = "msh:price-pool:v1";
const PRICE_POOL_HASH_TTL_SECONDS = 12 * 60 * 60; // reset each run; bridges gaps

// Price coverage is now driven by the TIER POLICY, not by a fixed fraction of
// the universe per run. It used to be "cover everything in PRICE_TARGET_RUNS
// runs", which is a cadence stated in runs -- a unit that silently changes
// meaning whenever the cron does, and did (#374 took it from */3 to */5 and
// stretched full coverage from ~12 to ~20 minutes without a line of code
// changing). Selection is now "whatever is past its own tier's TTL", so the
// policy is stated in minutes and the cron cannot quietly rewrite it.
//
// The per-run cap is DERIVED from that policy and the real cron rather than
// typed: to give every tier-2 symbol a refresh inside TIER2_TTL_MS you need
// universe / (TTL / cron-period) symbols per run. Both inputs already exist and
// are already the source of truth for other readers -- the JOBS registry is
// what /cache-health's schedule text is computed from, for the same reason
// (jobRuns.ts:98, after a page spent an hour telling readers a cadence that had
// moved).
const PRICE_MIN_PER_RUN = 40; // don't bother sub-slicing a tiny universe
// PRICE_MAX_PER_RUN is derived below, once its two inputs exist.

/** Runs available inside one TTL window, from the registry's own cron. */
function runsPerWindow(ttlMs: number): number {
  const seconds = cronIntervalSeconds(JOBS["warm-price-pool"].cron);
  if (!Number.isFinite(seconds) || seconds <= 0) return 1;
  return Math.max(1, Math.floor(ttlMs / (seconds * 1000)));
}

export function runsPerTier1Window(): number {
  return runsPerWindow(TIER1_TTL_MS);
}

export function runsPerTier2Window(): number {
  return runsPerWindow(TIER2_TTL_MS);
}
// PE trickle: small per-run slice; slow-moving data, so this just needs to roll.
const PE_MAX_PER_RUN = 20;
const FMP_MIN_HEADROOM_CALLS = 60; // leave room for history/earnings + live traffic

// ─────────────────────────────────────────────────────────────────────────────
// THE RUN OUTLIVES THE MINUTE BUCKET.
//
// This loop used to `break` the moment hasFmpCapacity said no, which is
// `current + 1 + 60 <= 200` -- i.e. the instant the CURRENT MINUTE reached 140
// calls. Production, 2026-09-02, four consecutive runs:
//
//     08:01  priceCap 190   priceRefreshed 136
//     08:05  priceCap 190   priceRefreshed 132
//     08:10  priceCap 190   priceRefreshed 128
//     08:15  priceCap 190   priceRefreshed 136
//
// The cap was 190 and was NEVER the binding constraint. 140 minus the three
// mover buckets and the PE trickle is exactly the 128-136 observed. The run
// stopped on one exhausted minute while holding a maxDuration of 300 seconds --
// four of every five minutes of its own budget went unused, and the route's own
// lock comment already said "a run may take all 300s".
//
// `break` is the wrong verb. The minute bucket refills sixty seconds later and
// the run is still alive to use it. So the loop now WAITS for the next bucket
// and ends on the RUN'S OWN clock instead.
//
// WHY NOT LEAN ON reserveFmpCallSlot'S WAIT. It waits at most FMP_MAX_WAIT_MS
// (20s) and then THROWS capacity-timeout (historyCache.ts). A bucket wait can
// be up to 60s, so its wait is not sufficient here -- and inside
// fetchStableQuote that throw is caught and returned as null, which would show
// up as a quote failure rather than as the pacing it actually is. This wait sits
// OUTSIDE the fetch, so a full minute boundary costs a pause, not a fake error.
// FMP_MAX_WAIT_MS is untouched; other callers depend on it.
//
// THE BUDGET IS 240s, NOT 300. maxDuration is 300 and the lock TTL is sized
// against it, but a run that spends all 300 has nothing left for the HSET, the
// staleness bookkeeping, the TTL reset and the response -- it would be killed
// mid-write and discard everything it just fetched, which is the exact failure
// the 60 -> 300 bump was made to stop. 240 leaves a minute of tail. Worst-case
// wall clock: the last symbol may START at 239.9s and then costs one
// reserveFmpCallSlot wait (<=20s) plus the FMP round trip, so ~265s -- inside
// maxDuration and well inside the 6-minute lock TTL.
const PRICE_RUN_BUDGET_MS = 240_000;
// Poll rather than sleeping to the bucket edge: the minute may roll over, or
// another job may finish and free room, well before the boundary.
const PRICE_BUDGET_POLL_MS = 5_000;

// THE MOST CALLS ONE RUN CAN MAKE, DERIVED FROM THE RUN ITSELF.
//
// This was a typed 220, commented "bound a single run's length (~<1 min even
// paced)". That comment described a constraint #396 removed: the loop no longer
// ends on the first exhausted minute, it waits for the next bucket and runs to
// PRICE_RUN_BUDGET_MS. So the bound was sized for a one-minute run that no
// longer exists, and was capping a four-minute one at a quarter of its reach.
//
// The real ceiling is arithmetic over two constants that already exist:
//
//   usable rate  FMP_SAFE_CALLS_PER_MINUTE - FMP_MIN_HEADROOM_CALLS = 140/min
//   run length   PRICE_RUN_BUDGET_MS                                = 4 min
//                                                                   = 560 calls
//
// Derived rather than typed for the reason the cadence was: 220 stopped being
// true when the run budget changed and nothing said so. Move either input and
// this follows.
const USABLE_CALLS_PER_MINUTE = FMP_SAFE_CALLS_PER_MINUTE - FMP_MIN_HEADROOM_CALLS;
const PRICE_MAX_PER_RUN = Math.floor(
  USABLE_CALLS_PER_MINUTE * (PRICE_RUN_BUDGET_MS / 60_000)
);

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Wait until there is FMP room for one more call, or until the run is out of
 * its own time.
 *
 * Returns "out-of-time" ONLY on the run's clock. An exhausted minute is a
 * pause; the end of the run's budget is the only thing that ends the run.
 */
async function waitForPriceBudget(deadlineMs: number): Promise<"ok" | "out-of-time"> {
  while (true) {
    if (await hasFmpCapacity(1, FMP_MIN_HEADROOM_CALLS)) return "ok";
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) return "out-of-time";
    await sleep(Math.min(PRICE_BUDGET_POLL_MS, remaining));
  }
}
// ─────────────────────────────────────────────────────────────────────────────

// Free "market performance" buckets checked before the per-symbol rotation.
const MOVER_BUCKET_PATHS = ["biggest-gainers", "biggest-losers", "most-actives"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// A SYMBOL THAT KEEPS FAILING MUST STOP BEING RETRIED EVERY RUN.
//
// The loop's `if (!quote && !peFetched) continue` is CORRECT for a transient:
// a failed symbol keeps its old `ts`, stays past its TTL and sorts to the FRONT
// of the next run's due set, so a blip costs one cron period rather than one
// TTL. #395 argued for exactly that and it stays.
//
// What was missing is what happens on the Nth consecutive failure. For a
// permanently dead ticker the same mechanism is an infinite loop: front of the
// queue, fails, front of the queue, fails -- up to 288 calls a day, forever,
// for a symbol that will never answer again. There was no deferSymbol for
// pricePool anywhere.
//
// THE THRESHOLD IS 3, AND THE REASONING IS THE CRON PERIOD. At */5, three
// consecutive failures span ~10-15 minutes of the session. One bad FMP minute
// does not survive that; two would trip on a single blip plus its retry. Five
// would be safer against false positives and costs two more runs of an
// infinite loop, which is the thing being bounded.
//
// THE BACKOFF IS DERIVED FROM THE STREAK ITSELF, so there is no second piece of
// state to keep in step: 1h at the third failure, doubling, capped at a day.
//
//   streak  3    4    5    6     7     8+
//   defer   1h   2h   4h   8h   16h   24h
//
// WORST CASE FOR A SYMBOL THAT IS ACTUALLY ALIVE -- a trading halt, or FMP
// briefly wrong about it: it is skipped for at most 24 hours, and because the
// deferral expires on wall-clock time while refreshes only happen inside the
// session, the practical worst case is ~24h plus the closed hours it lands in,
// so about 30 hours of a frozen price. That is the cost of the cap. It is only
// reached after eight consecutive failures, by which point "alive" is a thin
// hypothesis -- and markRefreshed already ZREMs the deferral, so one successful
// fetch clears the whole thing.
//
// A DEFERRAL THAT NEVER EXPIRES IS AN EVICTION WEARING A SMALLER NAME. Nothing
// here removes a symbol from anything; the cap is what keeps that true.
const PRICE_FAIL_DEFER_AFTER = 3;
const PRICE_FAIL_DEFER_BASE_SECONDS = 60 * 60;
const PRICE_FAIL_DEFER_MAX_SECONDS = 24 * 60 * 60;

// Above this share of empty responses, a run's deferrals are discarded whole.
// Half is deliberately far above anything a real delisting pattern produces --
// this is not a sensitivity dial, it is a "the world is obviously broken" line.
const PRICE_EMPTY_RATE_ABORT = 0.5;

/**
 * How long to park a symbol after `streak` consecutive failures.
 *
 * PURE, so the invariant check can RUN it: "no symbol can be parked
 * permanently" is a claim about behaviour over inputs, and a regex over this
 * file cannot test a cap.
 */
export function priceFailDeferSeconds(streak: number): number {
  if (streak < PRICE_FAIL_DEFER_AFTER) return 0;
  const doublings = streak - PRICE_FAIL_DEFER_AFTER;
  const seconds = PRICE_FAIL_DEFER_BASE_SECONDS * 2 ** Math.min(doublings, 20);
  return Math.min(PRICE_FAIL_DEFER_MAX_SECONDS, seconds);
}
// ─────────────────────────────────────────────────────────────────────────────

export type PricePoolRow = {
  price: number | null;
  changePct: number | null;
  volume: number | null;
  marketCap: number | null;
  /**
   * Today's session open / high / low, when the quote carried them.
   *
   * ZERO EXTRA BANDWIDTH. stable/quote already returns open, dayHigh and dayLow
   * in the same response fetchStableQuote reads price and volume from; those
   * bytes are paid for and were being thrown away.
   *
   * NULL IS MEANINGFUL AND MUST STAY VISIBLE. A price-pool row is close to
   * being able to stand in for a daily bar, and Point's open/high/low are
   * OPTIONAL -- so a synthesised bar missing them would type-check and slot
   * silently into the series. MA, RSI, MACD and Bollinger read `close` and would
   * look fine; ATR spike and the support/resistance detector read high/low and
   * would quietly stop firing, with no error anywhere
   * (claude/traps/a-visible-failure-is-not-a-harmless-one.md). Explicit null
   * beats absent, and warmPricePool logs once if a whole run produced no opens.
   */
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  pe: number | null;
  ts: number; // ms epoch price was last fetched
  peTs?: number; // ms epoch PE was last fetched (independent rotation)
  /**
   * Consecutive failed quote attempts. Reset to 0 by any success.
   *
   * ON THE ROW RATHER THAN IN ITS OWN KEY, deliberately. A separate hash would
   * need an HDEL per success to clear -- and there is no hdel anywhere in this
   * codebase, which is exactly how the price-pool and picker-chart hashes came
   * to hold immortal fields. This rides the row it describes: written by the
   * same HSET, expired by the same TTL, and removed by the same eviction.
   */
  failStreak?: number;
};

function cleanSymbol(value: string) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function uniqueClean(symbols: string[]): string[] {
  return Array.from(new Set(symbols.map(cleanSymbol).filter(Boolean)));
}

/**
 * Redis-ONLY bulk read of the pooled quotes for the symbols a page shows, in a
 * single HMGET. Never touches FMP. Any symbol not in the pool is simply absent
 * from the returned map (caller falls back to the EOD close from chartPoints).
 */
export async function readPricePoolBulk(
  symbols: string[]
): Promise<Map<string, PricePoolRow>> {
  const out = new Map<string, PricePoolRow>();
  if (!redis) return out;

  const fields = uniqueClean(symbols);
  if (!fields.length) return out;

  try {
    // Upstash's hmget returns an object keyed by field name; some versions
    // return an array aligned to the requested fields. Handle both so the read
    // never silently returns nothing.
    const raw = (await redis.hmget(PRICE_POOL_KEY, ...fields)) as unknown;
    const asArray = Array.isArray(raw) ? (raw as (PricePoolRow | null)[]) : null;
    const asObj =
      !asArray && raw && typeof raw === "object"
        ? (raw as Record<string, PricePoolRow | null>)
        : null;
    if (asArray || asObj) {
      fields.forEach((sym, i) => {
        const row = asArray ? asArray[i] : asObj ? asObj[sym] : null;
        if (row && typeof row === "object" && typeof row.ts === "number") {
          out.set(sym, {
            price: num(row.price),
            changePct: num(row.changePct),
            volume: num(row.volume),
            open: num(row.open),
            dayHigh: num(row.dayHigh),
            dayLow: num(row.dayLow),
            marketCap: num(row.marketCap),
            pe: num(row.pe),
            ts: row.ts,
            peTs: num(row.peTs) ?? 0,
            failStreak: num(row.failStreak) ?? 0,
          });
        }
      });
    }
  } catch {
    // fail open -- a read failure just means "no pooled quotes this render".
  }

  return out;
}

export type ColdSeedRow = {
  symbol: string;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  marketCap: number | null;
};

/**
 * Cold-start seed: write a baseline price-pool row for symbols that don't
 * already have one, using a quote ALREADY fetched elsewhere -- specifically
 * discovery's own stable/quote call when admitting a newly-found symbol (see
 * app/api/market/route.ts). No FMP call happens here; this is pure Redis.
 *
 * Only fills symbols with NO existing row (checked via readPricePoolBulk), so
 * it can never clobber a fresher value the normal warm-price-pool rotation
 * already wrote -- worst case it's a no-op.
 *
 * Why this matters: a never-warmed symbol has ts=0 in the pool, so it already
 * wins warm-price-pool's stalest-first sort and is typically picked up on the
 * very next cron run. But if a single discovery batch admits enough symbols to
 * exceed that run's priceCap (PRICE_MAX_PER_RUN=220), the overflow queues
 * behind other stale symbols for another run or more. This gives those symbols
 * a real row immediately instead.
 *
 * Deliberately does not touch `pe` (left null) or `peTs` (left 0) -- PE has no
 * cheap already-fetched source at discovery time, so it still only ever comes
 * from warm-price-pool's own ratios-ttm rotation, unchanged.
 */
export async function seedColdPricePoolRows(
  rows: ColdSeedRow[],
  nowMs: number
): Promise<number> {
  if (!redis || !rows.length) return 0;

  const clean = rows
    .map((r) => ({ ...r, symbol: cleanSymbol(r.symbol) }))
    .filter(
      (r) => r.symbol && (r.price != null || r.changePct != null || r.volume != null)
    );
  if (!clean.length) return 0;

  const existing = await readPricePoolBulk(clean.map((r) => r.symbol));

  const payload: Record<string, PricePoolRow> = {};
  for (const row of clean) {
    if (existing.has(row.symbol)) continue; // never overwrite an existing row
    if (payload[row.symbol]) continue; // dedupe within this call
    payload[row.symbol] = {
      price: row.price,
      changePct: row.changePct,
      volume: row.volume,
      marketCap: row.marketCap,
      // Discovery's quote is not re-read here, so OHLC is genuinely unknown at
      // seed time. Explicit null, same reasoning as `pe` below: absent and
      // "not fetched yet" must not be the same reading.
      open: null,
      dayHigh: null,
      dayLow: null,
      pe: null, // unknown until warm-price-pool's PE rotation reaches it
      ts: nowMs,
      peTs: 0,
    };
  }

  if (!Object.keys(payload).length) return 0;

  try {
    await redis.hset(PRICE_POOL_KEY, payload);
  } catch {
    return 0; // fail open
  }

  return Object.keys(payload).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// LAST-KNOWN-GOOD vs SESSION-SCOPED. The one rule that decides whether a field
// carries forward, and the one thing to get right before adding a field to
// PricePoolRow.
//
//   CARRY FORWARD -- price, marketCap, pe. These describe a company, not a
//   session. A value FMP did not send this time is UNKNOWN, the previous one is
//   the best answer anyone has, and `ts` dates it.
//
//   DO NOT CARRY FORWARD -- open, dayHigh, dayLow, volume, changePct. These are
//   SESSION-SCOPED. Yesterday's dayHigh is not an unknown-but-similar version
//   of today's dayHigh; it is a DIFFERENT SESSION'S NUMBER. Writing it under
//   today's `ts` is not staleness, it is a wrong value stated as a current one.
//
// PricePoolRow's own doc comment, a few lines above those fields, is the
// argument: "NULL IS MEANINGFUL AND MUST STAY VISIBLE... MA, RSI, MACD and
// Bollinger read close and would look fine; ATR spike and the
// support/resistance detector read high/low and would quietly stop firing...
// Explicit null beats absent". A fallback turns that DESIGNED stop-firing into
// silent wrong values -- a-visible-failure-is-not-a-harmless-one pointing the
// other way.
//
// AND IT WOULD NOT DECAY, IT WOULD FREEZE. The scenario shouldWarnMissingOpen
// exists for is "stable/quote stopped carrying OHLC on this plan". In that
// scenario EVERY subsequent run also falls back, so the carried values never
// refresh: pinned at the last good session, on rows whose `ts` says "fetched
// seconds ago", indefinitely. It would also split the signal, since
// openCarried counts `quote.open` rather than what was stored -- the warning
// would fire while the rows looked healthy.
//
// PURE, so scripts/check-dead-symbol-honesty.mjs can RUN it. Which branch a
// field takes is the claim, and a regex over seven ternaries cannot see it.
type PoolMergeInput = {
  quote: QuoteLite | null;
  already: PricePoolRow | undefined;
  prev: PricePoolRow | undefined;
  quoteAt: number;
  peFetched: boolean;
  peValue: number | null;
  nowMs: number;
};

export function mergePoolRow(input: PoolMergeInput): PricePoolRow {
  const { quote, already, prev, quoteAt, peFetched, peValue, nowMs } = input;
  return {
    // LAST-KNOWN-GOOD. num() returns null for absent AND non-finite, so without
    // these a valid row missing `price` replaced a good stored price with null
    // while stamping `ts` fresh.
    price: quote ? quote.price ?? prev?.price ?? null : already?.price ?? prev?.price ?? null,
    marketCap: quote
      ? quote.marketCap ?? prev?.marketCap ?? null
      : already?.marketCap ?? prev?.marketCap ?? null,

    // SESSION-SCOPED. No prev on the quote branch: a quote that landed without
    // these is FMP telling us today's numbers are unavailable, and null is the
    // honest record of that.
    changePct: quote ? quote.changePct : already?.changePct ?? prev?.changePct ?? null,
    volume: quote ? quote.volume : already?.volume ?? prev?.volume ?? null,
    open: quote ? quote.open : already?.open ?? prev?.open ?? null,
    dayHigh: quote ? quote.dayHigh : already?.dayHigh ?? prev?.dayHigh ?? null,
    dayLow: quote ? quote.dayLow : already?.dayLow ?? prev?.dayLow ?? null,

    // carry forward last-known PE if this run didn't (re)fetch a value
    pe: peFetched ? peValue ?? prev?.pe ?? null : already?.pe ?? prev?.pe ?? null,
    ts: quote ? quoteAt : already?.ts ?? prev?.ts ?? nowMs,
    peTs: peFetched ? Date.now() : already?.peTs ?? prev?.peTs ?? 0,
    // Any landing clears the streak. markRefreshed also ZREMs the deferral,
    // so one good fetch fully un-parks a symbol.
    failStreak: quote ? 0 : already?.failStreak ?? prev?.failStreak ?? 0,
  };
}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Should a run warn that no quote carried a session open?
 *
 * PULLED OUT AS A PREDICATE so it can be RUN rather than pattern-matched. The
 * harness previously asserted this with two regexes, one of which was a strict
 * substring of the other and therefore could never fail independently -- it
 * looked like two checks and was one
 * (claude/traps/a-regex-over-source-has-no-scope.md).
 *
 * The condition itself: a run that fetched quotes and got an open from none of
 * them is the signal. A run that fetched NO quotes has nothing to say about the
 * fields, and warning there would report our own idleness as FMP's outage.
 */
export function shouldWarnMissingOpen(pxRefreshed: number, openCarried: number): boolean {
  return pxRefreshed > 0 && openCarried === 0;
}

type QuoteLite = {
  price: number | null;
  changePct: number | null;
  volume: number | null;
  marketCap: number | null;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
};

// Per-symbol live quote (price/%chg/volume/marketCap). stable/quote is the only
// working intraday quote endpoint on this plan; it returns `changePercentage`
// (no trailing "s") and has no PE field.
/**
 * WHAT A FAILED QUOTE ACTUALLY MEANS, kept separate from the fact that it
 * failed.
 *
 * THIS RETURNED `QuoteLite | null` AND EVERY FAILURE MODE COLLAPSED INTO THE
 * NULL: a 429, a 402, a 5xx, a network throw, a parse failure, and
 * reserveFmpCallSlot's own capacity-timeout. That was harmless while nothing
 * acted on it. It stopped being harmless the moment failStreak attached a
 * CONSEQUENCE -- "this ticker is dead" -- to a signal that mostly means "we are
 * being rate-limited right now".
 *
 * waitForPriceBudget's own comment already said this: a capacity-timeout throw
 * inside the fetch "would show up as a quote failure rather than as the pacing
 * it actually is". The deferral turned that mislabel into an action.
 *
 * IT IS NOT THEORETICAL, AND IT CONCENTRATES RATHER THAN SPREADS.
 * warm-picker-universe logged http-429:155 on 08-30, http-429:670 on 08-31
 * (700 of 700 symbols failed), http-429:171 on 09-01, and capacity-timeout:40
 * on 09-02 -- a healthy day. And a failed symbol keeps its stale `ts`, so it
 * sorts to the FRONT of the next run's due set: under a systemic cause the same
 * cohort is retried first, under the same conditions, and fails again. Three
 * runs of that is a streak of 3 for the whole universe.
 *
 *   "row"      the symbol answered. The only outcome that clears a streak.
 *   "empty"    HTTP 200 and no row FOR THIS SYMBOL. The only outcome that is
 *              evidence about the TICKER, and the only one that may park it.
 *   "refused"  FMP or our own pacing declined to answer. Evidence about the
 *              SERVICE, not the symbol. Counted, never acted on.
 */
type QuoteOutcome =
  | { kind: "row"; quote: QuoteLite }
  | { kind: "empty" }
  | { kind: "refused"; status: number | null };

async function fetchStableQuote(sym: string, apiKey: string): Promise<QuoteOutcome> {
  // OUR OWN PACING, IN ITS OWN try/catch. reserveFmpCallSlot throws
  // capacity-timeout after FMP_MAX_WAIT_MS, and letting that fall through to
  // the outer catch would file our internal back-pressure as FMP's answer
  // about the symbol -- which is exactly the mislabel this type exists to end.
  try {
    await reserveFmpCallSlot();
  } catch {
    return { kind: "refused", status: null };
  }

  try {
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(
      sym
    )}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fmpFetch(url, { next: { revalidate: 300 }, headers: { accept: "application/json" } });
    // A non-ok status is the SERVICE declining -- 429 rate limit, 402 plan, 5xx
    // outage. None of them says anything about whether this ticker still
    // trades.
    if (!res.ok) return { kind: "refused", status: res.status };
    const json = await res.json().catch(() => null);
    if (json === null) return { kind: "refused", status: res.status };

    // AN ERROR ENVELOPE IS THE SERVICE TALKING, SO IT IS "refused", NOT
    // "empty". This hole was fixed in stockDataCache's hasRows and missed here,
    // on the one path #404's eviction gate depends on. FMP answers a rate limit
    // or a bad key with HTTP 200 and {"Error Message": "..."}: res.ok is true,
    // the body is non-null, and `Array.isArray(json) ? json[0] : json` hands
    // the envelope back AS A ROW. The call site then treated seven nulls as a
    // successful quote -- overwriting a live price with null, stamping `ts`
    // fresh, and CLEARING failStreak and failAt.
    //
    // Both of #404's directions broke from this one branch: a rate-limited
    // afternoon nulled out live prices and marked them green, and a genuinely
    // delisted ticker answered with an envelope had its streak reset every run,
    // so it could never accumulate toward eviction.
    //
    // Classifying it "empty" would fix the first half and keep the second: an
    // envelope must not park a symbol either.
    if (isFmpErrorEnvelope(json)) return { kind: "refused", status: res.status };

    const row = (Array.isArray(json) ? json[0] : json) as Record<string, unknown> | null;
    // HTTP 200 with no row is FMP answering "I have nothing for this symbol",
    // which is the delisting signal.
    if (!row) return { kind: "empty" };
    // AND AGAIN ON THE UNWRAPPED ROW. isFmpErrorEnvelope returns false for an
    // array, so `[{"Error Message": "..."}]` passes the check above, becomes
    // `row`, has keys, and would be accepted as data -- clearing failStreak and
    // failAt, which is #404's eviction evidence gone. The array carve-out was
    // decided for hasFmpRows where the cost is a mislabelled refresh; here it
    // is a delisted ticker that can never accumulate toward removal, so this
    // path does not inherit that trade.
    if (isFmpErrorEnvelope(row)) return { kind: "refused", status: res.status };
    // A BARE `{}` IS TREATED AS A REFUSAL, NOT AN EMPTY, AND THE REASON IS THE
    // ASYMMETRY. FMP says "no such symbol" with `[]`, not with `{}`; a bare
    // object with no keys is far more likely a truncated or malformed body. On
    // an ambiguous response the two mistakes do not cost the same -- calling it
    // refused costs one retry, calling it empty feeds a deferral and, through
    // #404, an eviction. The non-destructive branch wins ties.
    if (!Array.isArray(json) && !Object.keys(row).length) {
      return { kind: "refused", status: res.status };
    }
    return {
      kind: "row",
      quote: {
      price: num(row.price),
      changePct: num(row.changePercentage) ?? num(row.changesPercentage),
      volume: num(row.volume),
      marketCap: num(row.marketCap),
      // Already in this response. `num` returns null for anything non-finite,
      // so a plan that stops sending these degrades to explicit nulls rather
      // than to absent keys.
      open: num(row.open),
      dayHigh: num(row.dayHigh),
      dayLow: num(row.dayLow),
      },
    };
  } catch {
    // A network throw is the service too.
    return { kind: "refused", status: null };
  }
}

// Per-symbol trailing-twelve-month P/E from stable/ratios-ttm. This is the only
// endpoint on this plan that carries PE. Field is priceToEarningsRatioTTM (with
// legacy-name fallbacks). Absurd/negative PE (loss-makers) is nulled so the
// column stays meaningful.
async function fetchPeTtm(sym: string, apiKey: string): Promise<number | null> {
  try {
    await reserveFmpCallSlot();
    const url = `https://financialmodelingprep.com/stable/ratios-ttm?symbol=${encodeURIComponent(
      sym
    )}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fmpFetch(url, { next: { revalidate: 300 }, headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const row = (Array.isArray(json) ? json[0] : json) as Record<string, unknown> | null;
    if (!row) return null;
    const pe =
      num(row.priceToEarningsRatioTTM) ??
      num(row.priceEarningsRatioTTM) ??
      num(row.peRatioTTM) ??
      num(row.peRatio);
    if (pe == null || pe <= 0 || pe > 100000) return null;
    return pe;
  } catch {
    return null;
  }
}

type MoverRow = { price: number | null; changePct: number | null };

// One "market performance" bucket call. Returns price/%change for whatever
// tickers FMP includes (typically 50, ranked by that bucket's criterion). No
// volume/marketCap field on this endpoint family.
async function fetchMoverBucket(
  path: string,
  apiKey: string
): Promise<Map<string, MoverRow>> {
  const out = new Map<string, MoverRow>();
  try {
    await reserveFmpCallSlot();
    const url = `https://financialmodelingprep.com/stable/${path}?apikey=${encodeURIComponent(
      apiKey
    )}`;
    const res = await fmpFetch(url, { next: { revalidate: 300 }, headers: { accept: "application/json" } });
    if (!res.ok) return out;
    const json = await res.json().catch(() => null);
    if (!Array.isArray(json)) return out;
    for (const row of json as Record<string, unknown>[]) {
      const sym = cleanSymbol(String(row?.symbol ?? ""));
      if (!sym || out.has(sym)) continue;
      out.set(sym, {
        price: num(row.price),
        changePct: num(row.changesPercentage) ?? num(row.changePercentage),
      });
    }
  } catch {
    // fail open -- a bucket miss just means those symbols fall through to the
    // normal per-symbol rotation below.
  }
  return out;
}

// All 3 buckets, merged (first bucket to mention a symbol wins -- gainers,
// losers, actives rarely overlap on the same ticker in practice). Cheap: 3
// calls total regardless of universe size, so we always attempt all 3 as long
// as there's FMP headroom.
async function fetchMoverBuckets(apiKey: string): Promise<Map<string, MoverRow>> {
  const merged = new Map<string, MoverRow>();
  for (const path of MOVER_BUCKET_PATHS) {
    if (!(await hasFmpCapacity(1, FMP_MIN_HEADROOM_CALLS))) break;
    const bucket = await fetchMoverBucket(path, apiKey);
    for (const [sym, row] of bucket) {
      if (!merged.has(sym)) merged.set(sym, row);
    }
  }
  return merged;
}

/**
 * Cron worker: refresh the pool.
 *
 * Returns immediately outside the buffered US session -- see marketHours.ts for
 * why that is the saving that pays for the 15-minute tier.
 *
 * Inside it: spends the 3 free mover-bucket calls first (any universe symbol
 * they cover gets a free price/%change refresh and is excluded from this run's
 * pick), then refreshes whichever remaining symbols are past their own tier's
 * TTL, most-important tier first, up to a cap derived from the tier policy and
 * the cron period.
 * PE is refreshed for a small stalest-by-`peTs` trickle. Only touched fields
 * are written back (a single HSET) + the hash's safety expiry is reset.
 * Everything not refreshed keeps its prior value. Budget-guarded and fail-open
 * throughout.
 */
export async function warmPricePool(symbols: string[], nowMs: number) {
  const apiKey = process.env.FMP_API_KEY;
  const clean = uniqueClean(symbols);

  if (!redis || !apiKey || !clean.length) {
    return {
      ok: false,
      reason: !redis ? "no-redis" : !apiKey ? "no-fmp-key" : "no-symbols",
      written: 0,
    };
  }

  // MARKET-HOURS GATE, BEFORE ANY READ OR CALL.
  //
  // Outside the buffered session the last traded price IS the price: a refresh
  // returns the number already in the pool. The cron fires every 5 minutes
  // around the clock, so roughly two thirds of its runs were re-fetching a
  // value that could not have moved. Skipping them is what makes a 15-minute
  // tier affordable at all (see priceTiers.ts).
  //
  // Returns ok:true. A skip here is a HEALTHY outcome, and reporting it as a
  // failure would make /cache-health red for sixteen hours a day and teach
  // everyone to ignore it. `skipped` is on the record so it stays
  // distinguishable from the job having stopped running.
  if (!isActiveMarketWindow(new Date(nowMs))) {
    // RESET THE TTL BEFORE RETURNING. This was a plain return in #395 and it
    // emptied the pool every night.
    //
    // PRICE_POOL_HASH_TTL_SECONDS is 12 hours and its comment says "reset each
    // run; bridges gaps" -- it exists to notice that the CRON HAS STOPPED, not
    // that the market is shut. Once the gate started returning before the
    // expire below, nothing refreshed it across the closed hours, and HSET does
    // not clear or extend an existing TTL. The active window ends at 17:00 ET
    // and reopens at 08:00 ET, a 15-hour gap on a weeknight and 63 across a
    // weekend, so the whole hash expired at ~05:00 ET every weekday and stayed
    // gone all weekend: every picker page fell back to end-of-day closes, and
    // the pool rebuilt from cold each morning.
    //
    // A skipped run is still the cron running. Keeping the reset here restores
    // "12 hours with no run at all" as the meaning of the TTL, at one Redis
    // command per skip.
    try {
      await redis.expire(PRICE_POOL_KEY, PRICE_POOL_HASH_TTL_SECONDS);
    } catch {
      // fail open -- the pool keeps whatever TTL it has.
    }
    return { ok: true, skipped: true, reason: "market-closed", written: 0 };
  }

  const existing = await readPricePoolBulk(clean);
  const cleanSet = new Set(clean);

  // Tier 1 is derived in warmTargets.ts and parked in its own key. An
  // unreadable or empty set is not fatal: priceTtlMsFor defaults to tier 2, so
  // the worst case is the whole universe on the 30-minute policy -- degraded,
  // never stalled.
  const tier1 = await readTier1();

  // Free head start from the mover buckets. Only symbols already in our own
  // universe are used -- bucket rows for names outside `clean` are ignored, so
  // this never expands what the site analyzes/displays.
  const moverHits = await fetchMoverBuckets(apiKey);
  const payload: Record<string, PricePoolRow> = {};
  const bucketFreshened = new Set<string>();
  for (const [sym, row] of moverHits) {
    if (!cleanSet.has(sym)) continue;
    if (row.price == null && row.changePct == null) continue;
    const prev = existing.get(sym);
    payload[sym] = {
      price: row.price ?? prev?.price ?? null,
      changePct: row.changePct ?? prev?.changePct ?? null,
      // Buckets don't carry volume/marketCap/OHLC -- carry forward whatever the
      // pool already has; the per-symbol rotation is still the only source.
      volume: prev?.volume ?? null,
      marketCap: prev?.marketCap ?? null,
      open: prev?.open ?? null,
      dayHigh: prev?.dayHigh ?? null,
      dayLow: prev?.dayLow ?? null,
      pe: prev?.pe ?? null,
      ts: nowMs,
      peTs: prev?.peTs ?? 0,
    };
    bucketFreshened.add(sym);
  }

  // Price slice: symbols PAST THEIR OWN TIER'S TTL, excluding those a free
  // bucket hit already freshened this run.
  //
  // This is the change that buys back the throughput #392 cost. The old rule
  // was "the stalest ceil(n/4)", which always found work: a symbol refreshed
  // four minutes ago was still eligible if it happened to be the stalest, so
  // the run spent its whole budget every time regardless of whether anything
  // had actually aged out. Selecting on the policy instead means a run does
  // exactly the work the policy requires and stops, and the budget it does not
  // spend is budget the history and earnings jobs can.
  // THE CAP IS DERIVED FROM THE ACTUAL MIX, NOT FROM ONE TIER.
  //
  // It was ceil(universe / runsPerTier2Window()), i.e. sized as though every
  // symbol were on the 30-minute policy. They are not: the first live tier-1
  // build came out at 415 of 759 symbols, so that formula produced
  // ceil(759/6) = 127 -- BELOW the 139/run the fast tier alone requires, and a
  // reduction from the 190 it replaced at the very moment the freshness
  // requirement went up.
  //
  // Each tier needs its own count over its own number of runs, summed:
  //   ceil(415/3) + ceil(344/6) = 139 + 58 = 197
  // which is what the run actually has to do, and is under PRICE_MAX_PER_RUN.
  // Same failure #395 named for the old formula and fixed one level too high: a
  // quantity stated in a unit that changes meaning when something else moves.
  const tier1InUniverse = clean.reduce((n, sym) => n + (tier1.has(sym) ? 1 : 0), 0);
  const tier2InUniverse = clean.length - tier1InUniverse;
  const capNeeded =
    Math.ceil(tier1InUniverse / runsPerTier1Window()) +
    Math.ceil(tier2InUniverse / runsPerTier2Window());
  const priceCap = Math.min(PRICE_MAX_PER_RUN, Math.max(PRICE_MIN_PER_RUN, capNeeded));

  // Symbols parked after repeated failures. READ, not merely written: the price
  // pool picks its own work by TTL rather than asking claimStalest for the
  // stalest N, so without this read the deferral would be write-only and the
  // infinite retry loop would continue with a record of itself.
  const deferred = await readDeferred("pricePool");

  const due = clean.filter(
    (sym) =>
      !bucketFreshened.has(sym) &&
      !deferred.has(sym) &&
      isPriceDue(existing.get(sym)?.ts, sym, tier1, nowMs)
  );

  // TIER FIRST, THEN STALEST WITHIN TIER -- not stalest overall.
  //
  // Sorting the due set by raw timestamp would systematically favour tier 2:
  // its symbols are ALLOWED to be twice as old, so they would always look
  // staler and would crowd the 15-minute tier out of every capped run. Ordering
  // by tier makes the degradation match the policy: when the cap binds, tier 2
  // is what slips, which is the whole reason for having tiers.
  const priceSlice = due
    .sort((a, b) => {
      const tierDelta = Number(tier1.has(b)) - Number(tier1.has(a));
      if (tierDelta) return tierDelta;
      return (existing.get(a)?.ts ?? 0) - (existing.get(b)?.ts ?? 0);
    })
    .slice(0, priceCap);
  const priceSet = new Set(priceSlice);

  // Due but not attempted this run, because the cap bound. THE POINT OF
  // RECORDING IT is that the true worst-case staleness is otherwise assumed
  // rather than known: every symbol counted here waits at least another cron
  // period beyond its TTL, and a run record showing a persistent non-zero here
  // is the signal that the cap -- not the policy -- is what actually governs
  // freshness.
  const deferredByCap = Math.max(0, due.length - priceSlice.length);

  // PE slice: stalest-by-peTs, small trickle. Independent of bucket hits (PE
  // never comes from a bucket).
  const peSlice = [...clean]
    .sort((a, b) => (existing.get(a)?.peTs ?? 0) - (existing.get(b)?.peTs ?? 0))
    .slice(0, PE_MAX_PER_RUN);
  const peSet = new Set(peSlice);

  // Union, price-slice first (PE-only symbols are usually already in it).
  const targets = Array.from(new Set([...priceSlice, ...peSlice]));

  // Fixed at the top of the working loop so every check compares against one
  // instant, not a drifting "now".
  const runDeadlineMs = nowMs + PRICE_RUN_BUDGET_MS;

  let pxRefreshed = 0;
  let peRefreshed = 0;
  // A quote that was attempted and did not land -- FMP non-200, a parse
  // failure, or a throw. RECORDED RATHER THAN INFERRED. A failed symbol keeps
  // its old `ts`, so it is still past its TTL and sorts to the front of the
  // next run's due set five minutes later; the failure costs one cron period,
  // not one TTL. That is a claim about behaviour, and this counter is what
  // makes it checkable instead of assumed.
  let quoteFailures = 0;
  // The two causes, separated. `quoteFailures` still means "attempted and did
  // not land" so historical run records stay comparable; these say WHY.
  let quotesRefused = 0;
  let empties = 0;
  let priceAttempts = 0;
  const pendingDefers: Array<{ symbol: string; seconds: number }> = [];
  let deferSuppressed = false;
  // Rows written for symbols that returned NOTHING, kept apart from `payload`
  // so markRefreshed cannot be called with them. They carry the failure streak
  // and an unchanged `ts`.
  const failPayload: Record<string, PricePoolRow> = {};
  let newlyDeferred = 0;
  // Did the run stop with work still due?
  //
  // RENAMED FROM capacityStopped, DELIBERATELY, BECAUSE IT NOW MEANS SOMETHING
  // ELSE. It used to mean "the current minute filled up", which was true on
  // essentially every run and therefore said nothing. Now that an exhausted
  // minute is a pause rather than an ending, the only thing that ends a run
  // early is the run's own time budget -- a far rarer and much more useful
  // signal. Keeping the old name for the new meaning would leave every
  // historical run record on /cache-health reading as if it meant the new
  // thing, which is worse than a field that visibly changed.
  let outOfTime = false;
  // How many of this run's quotes actually carried a session open. The guard
  // below turns "the plan stopped sending OHLC" from an invisible degradation
  // into a line in the log and a field on the run record.
  let openCarried = 0;

  for (const sym of targets) {
    const prev = existing.get(sym);
    const wantPrice = priceSet.has(sym);
    const wantPe = peSet.has(sym);

    let quote: QuoteLite | null = null;
    // WHEN THE QUOTE ACTUALLY LANDED, not when the run started.
    //
    // This was `nowMs` for both, which was harmless while a run finished inside
    // a minute. Now that a run may span four, a symbol refreshed at minute four
    // would be stamped four minutes old the instant it was written -- and
    // isPriceDue would re-select it four minutes early, spending the budget
    // this change exists to recover on a quote that was already fresh.
    let quoteAt = nowMs;
    // Which of the three outcomes this symbol produced, so the failure block
    // below can act on the CAUSE rather than on the absence of a quote.
    let lastOutcome: "row" | "empty" | "refused" | "none" = "none";
    let peFetched = false;
    let peValue: number | null = null;

    // The run's own clock, checked before starting a symbol rather than after.
    // A symbol begun at the deadline still gets to finish; one begun past it
    // would push the write tail past maxDuration.
    if (Date.now() >= runDeadlineMs) {
      outOfTime = true;
      break;
    }

    if (wantPrice) {
      if ((await waitForPriceBudget(runDeadlineMs)) === "out-of-time") {
        outOfTime = true;
        break;
      }
      priceAttempts++;
      const outcome = await fetchStableQuote(sym, apiKey);
      quoteAt = Date.now();
      lastOutcome = outcome.kind;
      if (outcome.kind === "row") {
        quote = outcome.quote;
      } else {
        // KEPT MEANING "attempted and did not land", so the existing run-record
        // history stays comparable across this change.
        quoteFailures++;
        if (outcome.kind === "empty") empties++;
        else quotesRefused++;
      }
    }
    if (wantPe) {
      if (await hasFmpCapacity(1, FMP_MIN_HEADROOM_CALLS)) {
        peValue = await fetchPeTtm(sym, apiKey);
        peFetched = true;
      }
    }

    if (!quote && !peFetched) {
      // NOTHING LANDED. Record the streak rather than dropping the symbol on
      // the floor, and park it once the streak says this is not a blip.
      //
      // `ts` IS DELIBERATELY UNCHANGED. Advancing it would make a failed fetch
      // look like a successful refresh -- the symbol would fall out of the due
      // set for a full TTL and the page would keep rendering a carried-forward
      // price as if it had just been checked. Leaving it stale is what keeps
      // the symbol due the moment its deferral lapses.
      //
      // This row goes into `failPayload`, NOT `payload`: `payload`'s keys are
      // what markRefreshed is called with, and marking a symbol that returned
      // nothing as freshly refreshed is the same lie stockDataCache was telling.
      // ONLY AN "empty" TOUCHES THE STREAK. A refusal is evidence about FMP,
      // not about this ticker, and incrementing on it is how a rate-limited
      // afternoon becomes a universe full of "dead" symbols.
      if (wantPrice && lastOutcome === "empty") {
        const streak = (prev?.failStreak ?? 0) + 1;
        failPayload[sym] = {
          price: prev?.price ?? null,
          changePct: prev?.changePct ?? null,
          volume: prev?.volume ?? null,
          marketCap: prev?.marketCap ?? null,
          open: prev?.open ?? null,
          dayHigh: prev?.dayHigh ?? null,
          dayLow: prev?.dayLow ?? null,
          pe: prev?.pe ?? null,
          ts: prev?.ts ?? 0,
          peTs: prev?.peTs ?? 0,
          failStreak: streak,
        };
        // BUFFERED, NOT APPLIED. See the circuit breaker after the loop: a
        // deferral written inline cannot be taken back once the run turns out
        // to have been a bad afternoon rather than a set of dead tickers.
        const deferFor = priceFailDeferSeconds(streak);
        if (deferFor > 0) pendingDefers.push({ symbol: sym, seconds: deferFor });
      }
      continue;
    }

    // A symbol can already have a bucket-sourced row in `payload` (bucket gave
    // price, this loop is here only for its independent PE trickle) -- merge
    // onto it rather than clobbering the fresh bucket price/changePct/ts.
    const already = payload[sym];
    payload[sym] = mergePoolRow({
      quote,
      already,
      prev,
      quoteAt,
      peFetched,
      peValue,
      nowMs,
    });
    if (quote) pxRefreshed++;
    if (quote && quote.open != null) openCarried++;
    if (peFetched && peValue != null) peRefreshed++;
  }

  // Staleness bookkeeping. `payload` keys are exactly the symbols this run
  // actually refreshed, so the score means what the health page says it means.
  // registerSymbols is `nx`, seeding newcomers at 0 (never refreshed) without
  // ever overwriting a real refresh time.
  await registerSymbols("pricePool", clean);
  // ─────────────────────────────────────────────────────────────────────────
  // BELT AS WELL AS BRACES: A RUN THAT LOOKS LIKE A MASSACRE IS NOT ONE.
  //
  // Classifying outcomes (above) is the brace: a 429 no longer counts as
  // evidence about a ticker. This is the belt, for the failure that classifying
  // cannot catch -- FMP answering 200 with an empty body across the board, a
  // bad API key returning empties, or any bug that turns real rows into
  // nothing.
  //
  // DEAD TICKERS DO NOT ARRIVE 300 AT A TIME. Delistings are a handful a year
  // and arrive one at a time; an empty rate above half the run's attempts is a
  // statement about the service, whatever the status codes said. So the whole
  // buffer is discarded rather than trimmed: a run this degraded has no
  // trustworthy evidence in it at all, and picking the "most confident"
  // deferrals out of untrustworthy evidence is just a smaller version of the
  // same mistake.
  //
  // The streaks in failPayload are still WRITTEN. A symbol that is genuinely
  // dead keeps accumulating across runs and gets parked on a normal day; only
  // the ACTION is withheld.
  const emptyRate = priceAttempts > 0 ? empties / priceAttempts : 0;
  if (emptyRate > PRICE_EMPTY_RATE_ABORT && pendingDefers.length) {
    deferSuppressed = true;
    console.warn(
      `[warm-price-pool] SUPPRESSED ${pendingDefers.length} deferral(s): ` +
        `${empties} of ${priceAttempts} price attempts returned an empty body ` +
        `(${Math.round(emptyRate * 100)}%). Dead tickers do not arrive in cohorts -- ` +
        `treating this as an upstream fault, not as ${pendingDefers.length} delistings.`
    );
  } else {
    for (const { symbol, seconds } of pendingDefers) {
      await deferSymbol("pricePool", symbol, seconds);
      newlyDeferred++;
    }
  }

  // ONLY `payload`. failPayload's symbols returned nothing, and marking them
  // refreshed would reset the staleness of exactly the symbols that most need
  // to look stale.
  const refreshed = Object.keys(payload);
  if (refreshed.length) await markRefreshed("pricePool", refreshed);

  let written = 0;
  try {
    // One HSET for both. The failure rows have to be written or the streak
    // cannot survive to the next run, but they are counted separately so
    // `written` keeps meaning "rows carrying fresh data".
    const merged = { ...failPayload, ...payload };
    if (Object.keys(merged).length) {
      await redis.hset(PRICE_POOL_KEY, merged);
      written = Object.keys(payload).length;
    }
    // Always reset the safety TTL so an all-skipped run can't let the hash lapse.
    await redis.expire(PRICE_POOL_KEY, PRICE_POOL_HASH_TTL_SECONDS);
  } catch {
    // fail open -- a failed warm just means the pool keeps its prior values.
  }

  // ONCE PER RUN, AND ONLY WHEN IT MEANS SOMETHING. A run that fetched quotes
  // and got a session open from none of them is the signal that stable/quote has
  // stopped carrying OHLC on this plan -- which would otherwise show up nowhere,
  // because every consumer of open/dayHigh/dayLow treats them as optional and
  // simply stops firing (ATR spike, the support/resistance detector). A run that
  // fetched NO quotes at all is silent here: it has nothing to say about the
  // fields, and warning would be reporting our own idleness as their outage
  // (claude/traps/absence-needs-the-producer-to-have-run.md).
  if (shouldWarnMissingOpen(pxRefreshed, openCarried)) {
    console.warn(
      `[warm-price-pool] WARNING: ${pxRefreshed} quotes fetched and NOT ONE carried an "open". ` +
        "stable/quote has probably stopped returning open/dayHigh/dayLow on this plan. " +
        "ATR spike and the support/resistance detector read high/low and will quietly stop firing."
    );
  }

  return {
    ok: true,
    universe: clean.length,
    priceCap,
    tier1: tier1.size,
    // What the policy said was due this run, and what the cap would not let us
    // reach. `due` at or below `priceCap` with `deferredByCap` 0 is the healthy
    // shape: it means freshness is governed by the tier TTLs, which is the
    // thing this design promises. A persistent non-zero deferral means the cap
    // is the real policy and the TTLs are aspirational.
    due: due.length,
    deferredByCap,
    quoteFailures,
    // The two causes, separable on /cache-health. quotesRefused spiking with
    // empties flat is an FMP incident and nothing should be parked; empties
    // rising alone is what a delisting actually looks like.
    quotesRefused,
    empties,
    priceAttempts,
    deferSuppressed,
    // Symbols parked this run after PRICE_FAIL_DEFER_AFTER consecutive
    // failures, and how many are currently parked in total. A rising
    // deferredSymbols with a flat newlyDeferred is a settled set of dead
    // tickers; a rising newlyDeferred is something breaking.
    newlyDeferred,
    deferredSymbols: deferred.size,
    outOfTime,
    bucketFreshened: bucketFreshened.size,
    priceRefreshed: pxRefreshed,
    // Reported alongside priceRefreshed rather than only warned about, so the
    // ratio is visible on the cache health page's job record before it reaches
    // zero -- a slow decline is a different thing from a cliff, and a warning
    // that only fires at zero cannot show one.
    openCarried,
    peRefreshed,
    written,
  };
}
