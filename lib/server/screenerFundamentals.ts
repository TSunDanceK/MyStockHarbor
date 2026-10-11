// The FMP company-screener call, and the fundamentals it carries.
//
// WHY THIS MODULE EXISTS. The screener response carries
// marketCap/sector/industry/beta/lastAnnualDividend for ~1000 symbols in ONE
// call, and cacheScreenerFundamentals stores them so warmFundamentals can skip
// a per-symbol `profile` fetch for every symbol it covers. That is the whole
// industry/sector backfill, at zero marginal FMP cost.
//
// It used to run ONLY as a side effect of a master-list rebuild inside
// app/api/market/route.ts -- which is itself gated on an Eastern-day rollover
// AND on that route being requested at all. Nothing calls /api/market on a
// schedule: pickersBuilder.fetchMarket() self-fetches it on CACHE MISS ONLY, so
// a consistently warm pickers cache means it is never reached.
//
// Measured 2026-08-22: no /api/market request in 24h, and the warm-fundamentals
// summary reported `screenerCovered: 0` -- the cache had drained past its 30h
// TTL with nothing to rewrite it, for all 755 symbols. Every symbol then needed
// a per-symbol profile fetch, metered at PROFILE_MAX_PER_RUN = 120 a day.
//
// That is claude/traps/absence-needs-the-producer-to-have-run.md exactly:
// `screenerCovered: 0` reads as "the screener covers nothing", when the real
// answer is that the thing which would have populated it never ran.
//
// So the refresh now has its own cron (app/api/jobs/warm-screener-fundamentals)
// and does not depend on anyone requesting a page. The market route calls this
// same function, so the two cannot drift
// (claude/traps/two-validators-for-one-value.md).
import { reserveFmpCallSlot } from "./historyCache";
import { fmpFetch, flushFmpUsage } from "./fmpUsage";
import { cacheScreenerFundamentals } from "./fundamentalsCache";

// ─────────────────────────────────────────────────────────────────────────────
// THE FLOOR AND THE LIMIT, AND WHICH ONE ACTUALLY BINDS.
//
// The screener returns rows market-cap-descending, so between these two the
// LIMIT decides the coverage floor and the market-cap constant only matters if
// the limit stops truncating first. At 1000 it never did: probe Q1 found the
// $300M and $1B calls returned BYTE-IDENTICAL responses, because the 1000th row
// was PATH at $9.66B -- nine times the floor. SCREENER_MIN_MARKET_CAP has
// therefore been INERT for its whole life.
//
// AT 3000 IT IS STILL INERT, AND THAT IS THE POINT OF RAISING THE LIMIT.
// Probe Q1 confirmed limit=3000 returns 3,000 rows and, with funds excluded,
// the coverage floor lands around $2B -- still above the $1B constant, with
// roughly $1B of margin. So the widened pool is bounded by the limit, not by
// the floor, and the constant stays a backstop rather than becoming the thing
// that shapes the universe.
//
// WHY THAT MATTERS ENOUGH TO WRITE DOWN. A constant that silently becomes
// load-bearing is worse than one that never was: the day the 3000th row would
// have been a $900M company, this quietly starts excluding it and nothing says
// so. The run now reports the OBSERVED floor -- the smallest market cap in the
// rows FMP actually returned -- so "has the constant started binding" is
// answerable from a run record rather than from reasoning. When observedFloor
// approaches SCREENER_MIN_MARKET_CAP, it has.
//
// WHAT THE LIMIT BUYS. The old $9.66B floor is why ONDS at $4.37B, up 171%,
// could never enter the universe except by being searched or turning up in a
// mover bucket -- which is exactly the stock a breakout screener exists to
// find. A ~$2B floor puts that whole band in the candidate pool.
//
// THIS DOES NOT CHANGE THE UNIVERSE SIZE. ANALYSIS_UNIVERSE_CAP is untouched at
// 700: the CANDIDATE SET widens and the analysed set does not, deliberately, so
// that if something moves it is clear which change did it.
export const SCREENER_MIN_MARKET_CAP = 1_000_000_000;
export const SCREENER_LIMIT = 3000;

/**
 * The smallest market cap in the returned rows.
 *
 * The screener answers market-cap-descending, so this is the real coverage
 * floor -- the thing SCREENER_MIN_MARKET_CAP is only a backstop for. Null when
 * no row carried a usable number, which is a different state from a low floor
 * and must not read as one.
 */
function observedFloor(rows: unknown[]): number | null {
  let min: number | null = null;
  for (const row of rows) {
    const cap = (row as { marketCap?: unknown })?.marketCap;
    if (typeof cap !== "number" || !Number.isFinite(cap) || cap <= 0) continue;
    if (min === null || cap < min) min = cap;
  }
  return min;
}

export type ScreenerRefreshResult = {
  ok: boolean;
  /**
   * Smallest market cap actually returned. Compare against
   * SCREENER_MIN_MARKET_CAP: while this sits well above it, the LIMIT is what
   * bounds the pool and the constant is inert. When they converge, the constant
   * has started shaping the universe and is a decision again, not a backstop.
   */
  observedFloor?: number | null;
  /** Why it produced nothing, when it produced nothing. */
  reason?: "no-fmp-key" | "http-error" | "bad-payload" | "threw";
  status?: number;
  /** Rows returned by FMP. */
  rows: number;
  /** Rows actually written to Redis by cacheScreenerFundamentals. */
  cached: number;
  /** Clean symbols, for the discovery master list. */
  symbols: string[];
};

/**
 * One company-screener call: caches the fundamentals it carries and returns the
 * symbols.
 *
 * ALWAYS LOGS, including the zero cases, and that is the point of the rewrite.
 * The previous version logged only `if (cached > 0)`, so the two failures that
 * actually happened -- never called, and called but wrote nothing -- were
 * indistinguishable from a healthy silent run. A write of 0 is the single most
 * important thing this function can report.
 */
export async function refreshScreenerFundamentals(
  apiKey: string | undefined
): Promise<ScreenerRefreshResult> {
  const empty = { rows: 0, cached: 0, symbols: [] as string[] };

  if (!apiKey) {
    console.warn("[screener-fundamentals] no FMP_API_KEY — nothing refreshed");
    return { ok: false, reason: "no-fmp-key", ...empty };
  }

  const url =
    `https://financialmodelingprep.com/stable/company-screener` +
    `?marketCapMoreThan=${SCREENER_MIN_MARKET_CAP}` +
    `&exchange=NASDAQ,NYSE` +
    `&isActivelyTrading=true` +
    // Equities only. Without these the screener returns ~42% mutual funds --
    // market cap and exchange filters do not exclude them.
    `&isEtf=false` +
    `&isFund=false` +
    `&limit=${SCREENER_LIMIT}` +
    `&apikey=${encodeURIComponent(apiKey)}`;

  try {
    await reserveFmpCallSlot();
    const res = await fmpFetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });

    if (!res.ok) {
      // Named, not swallowed. A 402 here is a plan restriction and means this
      // source is gone until the plan changes -- which is a completely
      // different problem from a transient 5xx, and the old `if (!res.ok)
      // return []` made them the same event.
      console.warn(`[screener-fundamentals] company-screener HTTP ${res.status} — 0 cached`);
      return { ok: false, reason: "http-error", status: res.status, ...empty };
    }

    const json = await res.json().catch(() => null);
    if (!Array.isArray(json)) {
      console.warn("[screener-fundamentals] company-screener returned a non-array payload — 0 cached");
      return { ok: false, reason: "bad-payload", status: res.status, ...empty };
    }

    let cached = 0;
    try {
      cached = await cacheScreenerFundamentals(json);
    } catch (error) {
      // Fail open: discovery must not break because caching fundamentals did.
      // Logged rather than swallowed -- this is the write that matters.
      console.warn(
        `[screener-fundamentals] cacheScreenerFundamentals threw after ${json.length} rows:`,
        error
      );
    }

    const symbols = json
      .map((item) => String((item as { symbol?: unknown })?.symbol ?? "").trim().toUpperCase())
      .filter((s) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s));

    // An empty window here is never legitimate: the screener either answers
    // with ~1000 large-cap US equities or it has failed. Same free-monitor
    // shape as warnIfImplausiblyEmpty in the IPO work -- an assertion that is
    // almost never truthfully zero costs one line and catches failures no error
    // path will (claude/traps/return-type-cannot-express-failure.md).
    if (cached === 0) {
      console.warn(`[screener-fundamentals] 0 cached from ${json.length} rows — industry backfill has no free source this cycle`);
    } else {
      console.log(`[screener-fundamentals] cached ${cached} of ${json.length} rows (${symbols.length} clean symbols)`);
    }

    // One FMP call per run, so flush the sample now rather than leaving it
    // buffered for whichever unrelated invocation flushes next. Cheap here,
    // unlike in warmFundamentals' ~477-call loop.
    await flushFmpUsage();

    return {
      ok: true,
      status: res.status,
      rows: json.length,
      cached,
      symbols,
      observedFloor: observedFloor(json),
    };
  } catch (error) {
    console.warn("[screener-fundamentals] company-screener threw:", error);
    return { ok: false, reason: "threw", ...empty };
  }
}
