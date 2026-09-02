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
import { markRefreshed, registerSymbols } from "./stalenessQueue";
import { fmpFetch } from "./fmpUsage";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { hasFmpCapacity, reserveFmpCallSlot } from "./historyCache";
import { isActiveMarketWindow } from "./marketHours";
import { isPriceDue, readTier1, TIER2_TTL_MS } from "./priceTiers";
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
const PRICE_MAX_PER_RUN = 220; // bound a single run's length (~<1 min even paced)

/** Runs available inside one tier-2 TTL, from the registry's own cron. */
function runsPerTier2Window(): number {
  const seconds = cronIntervalSeconds(JOBS["warm-price-pool"].cron);
  if (!Number.isFinite(seconds) || seconds <= 0) return 1;
  return Math.max(1, Math.floor(TIER2_TTL_MS / (seconds * 1000)));
}
// PE trickle: small per-run slice; slow-moving data, so this just needs to roll.
const PE_MAX_PER_RUN = 20;
const FMP_MIN_HEADROOM_CALLS = 60; // leave room for history/earnings + live traffic

// Free "market performance" buckets checked before the per-symbol rotation.
const MOVER_BUCKET_PATHS = ["biggest-gainers", "biggest-losers", "most-actives"] as const;

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
async function fetchStableQuote(sym: string, apiKey: string): Promise<QuoteLite | null> {
  try {
    await reserveFmpCallSlot();
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(
      sym
    )}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fmpFetch(url, { next: { revalidate: 300 }, headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const row = (Array.isArray(json) ? json[0] : json) as Record<string, unknown> | null;
    if (!row) return null;
    return {
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
    };
  } catch {
    return null;
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
  const priceCap = Math.min(
    PRICE_MAX_PER_RUN,
    Math.max(PRICE_MIN_PER_RUN, Math.ceil(clean.length / runsPerTier2Window()))
  );

  const due = clean.filter(
    (sym) => !bucketFreshened.has(sym) && isPriceDue(existing.get(sym)?.ts, sym, tier1, nowMs)
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

  let pxRefreshed = 0;
  let peRefreshed = 0;
  // A quote that was attempted and did not land -- FMP non-200, a parse
  // failure, or a throw. RECORDED RATHER THAN INFERRED. A failed symbol keeps
  // its old `ts`, so it is still past its TTL and sorts to the front of the
  // next run's due set five minutes later; the failure costs one cron period,
  // not one TTL. That is a claim about behaviour, and this counter is what
  // makes it checkable instead of assumed.
  let quoteFailures = 0;
  // Runs that ended early because the FMP budget ran out mid-rotation. This is
  // the one path that DOES cost a symbol its next slot rather than five
  // minutes, because everything after the break is never attempted at all.
  let capacityStopped = false;
  // How many of this run's quotes actually carried a session open. The guard
  // below turns "the plan stopped sending OHLC" from an invisible degradation
  // into a line in the log and a field on the run record.
  let openCarried = 0;

  for (const sym of targets) {
    const prev = existing.get(sym);
    const wantPrice = priceSet.has(sym);
    const wantPe = peSet.has(sym);

    let quote: QuoteLite | null = null;
    let peFetched = false;
    let peValue: number | null = null;

    if (wantPrice) {
      if (!(await hasFmpCapacity(1, FMP_MIN_HEADROOM_CALLS))) {
        capacityStopped = true;
        break;
      }
      quote = await fetchStableQuote(sym, apiKey);
      if (!quote) quoteFailures++;
    }
    if (wantPe) {
      if (await hasFmpCapacity(1, FMP_MIN_HEADROOM_CALLS)) {
        peValue = await fetchPeTtm(sym, apiKey);
        peFetched = true;
      }
    }

    if (!quote && !peFetched) continue; // nothing landed for this symbol

    // A symbol can already have a bucket-sourced row in `payload` (bucket gave
    // price, this loop is here only for its independent PE trickle) -- merge
    // onto it rather than clobbering the fresh bucket price/changePct/ts.
    const already = payload[sym];
    payload[sym] = {
      price: quote ? quote.price : already?.price ?? prev?.price ?? null,
      changePct: quote ? quote.changePct : already?.changePct ?? prev?.changePct ?? null,
      volume: quote ? quote.volume : already?.volume ?? prev?.volume ?? null,
      marketCap: quote ? quote.marketCap : already?.marketCap ?? prev?.marketCap ?? null,
      open: quote ? quote.open : already?.open ?? prev?.open ?? null,
      dayHigh: quote ? quote.dayHigh : already?.dayHigh ?? prev?.dayHigh ?? null,
      dayLow: quote ? quote.dayLow : already?.dayLow ?? prev?.dayLow ?? null,
      // carry forward last-known PE if this run didn't (re)fetch a value
      pe: peFetched ? peValue ?? prev?.pe ?? null : already?.pe ?? prev?.pe ?? null,
      ts: quote ? nowMs : already?.ts ?? prev?.ts ?? nowMs,
      peTs: peFetched ? nowMs : already?.peTs ?? prev?.peTs ?? 0,
    };
    if (quote) pxRefreshed++;
    if (quote && quote.open != null) openCarried++;
    if (peFetched && peValue != null) peRefreshed++;
  }

  // Staleness bookkeeping. `payload` keys are exactly the symbols this run
  // actually refreshed, so the score means what the health page says it means.
  // registerSymbols is `nx`, seeding newcomers at 0 (never refreshed) without
  // ever overwriting a real refresh time.
  await registerSymbols("pricePool", clean);
  const refreshed = Object.keys(payload);
  if (refreshed.length) await markRefreshed("pricePool", refreshed);

  let written = 0;
  try {
    if (Object.keys(payload).length) {
      await redis.hset(PRICE_POOL_KEY, payload);
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
    capacityStopped,
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
