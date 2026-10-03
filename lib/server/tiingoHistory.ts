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
