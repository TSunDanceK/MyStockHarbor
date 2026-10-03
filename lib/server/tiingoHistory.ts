// THE STOCK-PAGE CHARTS AND /api/history ON TIINGO (step 3, #553 COWORK #71
// row 3; CODE-B #42 §5.3), behind PRICE_PROVIDER_HISTORY (/api/history and the
// dashboard's SSR seed) and PRICE_PROVIDER_CHARTS (the /stock/[symbol] SSR
// history: the chart, the indicator seed, the 52-week range).
//
// SWITCHED AT THE STEP-3 CALL SITES, NOT INSIDE getDailyHistory. That function
// also feeds the earnings page (A), the news page (C), the builders and the
// insight snapshots; moving it would move their surfaces too. Each step-3 caller
// hands its own FMP read in as `fmp`, so the unswitched path is the exact call
// it made before, caller tag and all (scripts/check-history-readers.mjs).
//
// WHAT A SERIES IS, on Tiingo:
//   the stored bars    readTiingoHistory: the nightly EOD job's split-adjusted
//                      bars (price basis B, COWORK #60), volume adjusted with
//                      the split (COWORK #30), ~1,400 bars. The Data Cache
//                      entry per symbol (tags eod, eod:<SYM>, 24 h), so Redis
//                      is read on a miss, not per visitor (COWORK #57 §3).
//   today so far       todaySoFar(): the hourly pool row as a partial bar, only
//                      when its IEX date is newer than the last stored bar,
//                      labelled "today so far (IEX), hh:mm ET", NO volume
//                      (IEX volume is one venue's, COWORK #53 §3, #56).
//
// ONE PROVIDER PER SERIES. A symbol's points are all Tiingo or all FMP, never
// spliced (step 2's rule, pickerHistory.ts). A Tiingo miss (no stored bars:
// notes, preferreds, a symbol not in the pool yet) returns the caller's FMP
// read whole, and only while FMP serves: with FMP_API_KEY unset that residual
// drops out as an empty series rather than failing (CODE-B #69).
//
// NEVER A LIVE TIINGO CALL: reads go through C's readSurfaceInputs, i.e. the
// step-1 Data Cache readers (scripts/check-tiingo-callers.mjs).
import type { Point } from "./historyCache";
import type { EodBar, StoredQuote } from "./marketData/types";
import { eodBarsToPoints } from "./marketData/pickerHistory";
import { todaySoFar } from "./marketData/merge";
import { priceProviderFor, type PriceSurface } from "./marketData/provider";
import { readSurfaceInputs } from "./tiingoSurfacePrice";
import { QUOTE_TOKEN_HEADER, verifyQuoteToken } from "./quoteToken";

export type HistorySurface = Extract<PriceSurface, "HISTORY" | "CHARTS">;

/** A history point, plus the partial bar's marker and label on Tiingo's newest point. */
export type SurfaceHistoryPoint = Point & { partial?: true; label?: string };

export type SurfaceHistory = {
  points: SurfaceHistoryPoint[];
  /** Whose bars these are: the credit is shown only for "tiingo". */
  provider: "tiingo" | "fmp" | "none";
};

type Inputs = { row: StoredQuote | null; bars: EodBar[] | null };

export function historyOnTiingo(surface: HistorySurface, env: Record<string, string | undefined> = process.env): boolean {
  return priceProviderFor(surface, env) === "tiingo";
}

/**
 * Pure: the stored bars as points, with today's partial bar appended when the
 * pool row is newer than the last bar. Null when there are no usable bars, so
 * the caller keeps its FMP series (a pool row alone is not a history).
 */
export function buildTiingoHistoryPoints(bars: readonly EodBar[] | null | undefined, row: StoredQuote | null | undefined): SurfaceHistoryPoint[] | null {
  const points: SurfaceHistoryPoint[] = eodBarsToPoints(bars ?? []);
  if (!points.length) return null;
  const today = row ? todaySoFar(bars ?? [], { price: row.price, open: row.open, high: row.high, low: row.low, at: row.at }) : null;
  if (today) {
    // No `volume` key at all: an IEX venue volume must never reach a volume
    // indicator or a weekly sum.
    points.push({ date: today.date, open: today.open, high: today.high, low: today.low, close: today.close, partial: true, label: today.label });
  }
  return points;
}

/**
 * After a weekly/monthly roll-up, the period holding today's partial bar is
 * itself partial: carry the marker and label onto it. Pure; the roll-up itself
 * is untouched.
 */
export function carryPartialLabel<T extends Point>(daily: readonly SurfaceHistoryPoint[], rolled: T[]): (T & { partial?: true; label?: string })[] {
  const tail = daily[daily.length - 1];
  if (!tail?.partial || !rolled.length) return rolled;
  const out: (T & { partial?: true; label?: string })[] = rolled.slice();
  out[out.length - 1] = { ...out[out.length - 1], partial: true, label: tail.label };
  return out;
}

/** One symbol's Tiingo series from the Data Cache, or null on a miss. Never throws. */
export async function readTiingoHistoryPoints(
  symbol: string,
  readInputs: (symbol: string) => Promise<Inputs> = readSurfaceInputs
): Promise<SurfaceHistoryPoint[] | null> {
  try {
    const { row, bars } = await readInputs(symbol);
    return buildTiingoHistoryPoints(bars, row);
  } catch {
    return null;
  }
}

export type HistoryForSurfaceDeps = {
  env?: Record<string, string | undefined>;
  readInputs?: (symbol: string) => Promise<Inputs>;
};

/**
 * The step-3 switch, one shape for every call site:
 *
 *   gate unset / typo  -> `fmp()` exactly as before (its throw propagates, so
 *                         the stock page still tells "unreachable" from "none")
 *   tiingo, a hit      -> the Tiingo series, provider "tiingo"
 *   tiingo, a miss     -> `fmp()` whole while FMP_API_KEY is set, else empty
 */
export async function historyForSurface(
  surface: HistorySurface,
  symbol: string,
  fmp: () => Promise<Point[]>,
  deps: HistoryForSurfaceDeps = {}
): Promise<SurfaceHistory> {
  const env = deps.env ?? process.env;
  if (!historyOnTiingo(surface, env)) return { points: await fmp(), provider: "fmp" };
  const tiingo = await readTiingoHistoryPoints(symbol, deps.readInputs);
  if (tiingo) return { points: tiingo, provider: "tiingo" };
  if (!env.FMP_API_KEY) return { points: [], provider: "none" };
  return { points: await fmp(), provider: "fmp" };
}

// ── /api/history ON THE TIINGO PATH (#553 COWORK #103) ──────────────────────
// The contract ruling: Tiingo-derived bars do not go out through public JSON;
// pages read them in-process. /api/history stays only as the same-origin feed
// for the charts' own client refetches, so on the Tiingo path it is:
//
//   never shared-cached   `private, no-store`, so no CDN hit can skip BotID and
//                         hand a warmed URL's bars to a plain curl;
//   capped                at the most any of our charts asks for;
//   same-origin only      the browser's `Sec-Fetch-Site: same-origin`, or a
//                         valid page token (lib/server/quoteToken.ts, the
//                         header /api/quote already takes) for a browser that
//                         sends no Fetch Metadata. Anything else: 403, no bars.
//
// The FMP path (gate unset) keeps its public s-maxage headers and 5000 clamp.

/**
 * The most bars a chart requests: the dashboard's D and W timeframes
 * (DashboardClient TIMEFRAMES fetchBars 2600). The others are below it: the
 * dashboard's M (360), its interactive chart (days=2000) and the stock page's
 * client fallback (days=900). scripts/check-tiingo-step3.mjs holds this equal
 * to the largest of them, so a new, larger caller has to raise it on purpose.
 */
export const TIINGO_HISTORY_MAX_DAYS = 2600;
const TIINGO_HISTORY_DEFAULT_DAYS = 365;
const TIINGO_HISTORY_MIN_DAYS = 30;

/** `Cache-Control` for every /api/history answer on the Tiingo path, 403s included. */
export const TIINGO_HISTORY_CACHE_CONTROL = "private, no-store";

/** The `days` query parameter on the Tiingo path: clamped, and a junk value is the default, never "all". */
export function tiingoHistoryDays(raw: string | null | undefined): number {
  const n = Number(raw || TIINGO_HISTORY_DEFAULT_DAYS);
  if (!Number.isFinite(n)) return TIINGO_HISTORY_DEFAULT_DAYS;
  return Math.max(TIINGO_HISTORY_MIN_DAYS, Math.min(TIINGO_HISTORY_MAX_DAYS, Math.floor(n)));
}

export type HistoryOriginCheck = { ok: boolean; via: "sec-fetch-site" | "page-token" | null };

/**
 * Is this request one of our own pages fetching its chart? The browser sets
 * `Sec-Fetch-Site` itself (a page script cannot), so a cross-site page or a
 * typed-in URL never reads "same-origin". A non-browser client can forge the
 * header; what stops it is BotID on every request, which no-store guarantees.
 * A page token counts only when it verifies ("valid"): an unconfigured secret
 * ("not_configured") proves nothing here.
 */
export function historyRequestSameOrigin(headers: Pick<Headers, "get">): HistoryOriginCheck {
  if (headers.get("sec-fetch-site") === "same-origin") return { ok: true, via: "sec-fetch-site" };
  if (verifyQuoteToken(headers.get(QUOTE_TOKEN_HEADER)).reason === "valid") return { ok: true, via: "page-token" };
  return { ok: false, via: null };
}
