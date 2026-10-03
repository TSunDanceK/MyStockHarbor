// PICKERS' HISTORY ON TIINGO (#553 step 2: CODE-B #42 §5 item 2, COWORK #57 §4).
//
// Where the Pickers build gets each symbol's daily bars when
// PRICE_PROVIDER_PICKERS=tiingo. Three tiers, each symbol taken from the first
// one that has it:
//
//   1. IN MEMORY: the bars the nightly EOD job has just fetched (its `onBars`
//      hook). The build it triggers reads no history at all (COWORK #57 §4).
//   2. THE DATA CACHE: readTiingoHistory, one entry per symbol tagged eod and
//      eod:<SYM>. Redis is read only on a miss, roughly once per symbol per
//      region per night after the job revalidates the tag (COWORK #57 §3). This
//      is what the hourly rebuilds (the payload's 1 h TTL) read.
//   3. FMP, for the symbols Tiingo has no stored history for (not in the price
//      pool yet, or withheld by PRICE_EXCLUDED). Only while FMP serves:
//      without FMP_API_KEY the fallback is skipped and those symbols count as
//      failed, which the builder's degraded-build guard already handles.
//
// A symbol's series always comes whole from ONE source; bars are never mixed
// across providers. The counts per tier go into the build's run record.
//
// NEVER A LIVE TIINGO CALL: this file reads Redis/the Data Cache only
// (scripts/check-tiingo-callers.mjs).
import pLimit from "p-limit";
import { readTiingoHistory } from "./read";
import type { EodBar, StoredEod } from "./types";
import { toDashed } from "../../symbolSpellings.mjs";

/** The builder's bar shape (historyCache's Point). */
export type HistoryPoint = {
  date: string;
  open?: number;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

export type PickerHistoryStats = {
  /** Symbols served from the EOD job's in-memory bars. */
  memory: number;
  /** Symbols served from the Data Cache (Redis on a miss). */
  cache: number;
  /** Symbols served from FMP because Tiingo had no stored history. */
  fmpFallback: number;
  /** Symbols with no history from any tier. */
  missing: number;
};

export type PickerHistoryResult = {
  bySymbol: Map<string, HistoryPoint[]>;
  stats: PickerHistoryStats;
  /** The symbols whose series came from Tiingo (memory or the Data Cache), not
   *  the FMP fallback. What the Performance tab is computed for (B6). */
  fromTiingo: Set<string>;
};

/** A Tiingo bar as the builder's point. Pure; exported for the checks. */
export function eodBarsToPoints(bars: readonly EodBar[]): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (const b of bars) {
    if (!Array.isArray(b) || typeof b[0] !== "string" || !Number.isFinite(b[4])) continue;
    out.push({ date: b[0], open: b[1], high: b[2], low: b[3], close: b[4], volume: b[5] });
  }
  return out;
}

export type PickerHistoryDeps = {
  /** One symbol's stored Tiingo history (defaults to the Data Cache reader). */
  readOne?: (symbol: string) => Promise<StoredEod | null>;
  /** FMP history for the residual symbols; null when FMP must not be called. */
  fmpBulk?: ((symbols: string[]) => Promise<Map<string, HistoryPoint[]>>) | null;
  concurrency?: number;
};

/**
 * Each universe symbol's bars, Tiingo first. Keys of the result are the
 * universe's own spellings (BRK.B stays BRK.B), whatever spelling Tiingo is
 * stored under.
 */
export async function tiingoPickerHistory(
  universe: readonly string[],
  inMemory: ReadonlyMap<string, readonly EodBar[]> | null | undefined,
  deps: PickerHistoryDeps = {}
): Promise<PickerHistoryResult> {
  const readOne = deps.readOne ?? readTiingoHistory;
  const bySymbol = new Map<string, HistoryPoint[]>();
  const stats: PickerHistoryStats = { memory: 0, cache: 0, fmpFallback: 0, missing: 0 };
  const fromTiingo = new Set<string>();
  const residual: string[] = [];
  const limit = pLimit(deps.concurrency ?? 16);

  await Promise.all(
    universe.map((symbol) =>
      limit(async () => {
        const dashed = toDashed(symbol);
        const mem = inMemory?.get(dashed) ?? inMemory?.get(symbol);
        if (mem && mem.length) {
          const pts = eodBarsToPoints(mem);
          if (pts.length) {
            bySymbol.set(symbol, pts);
            stats.memory++;
            fromTiingo.add(symbol);
            return;
          }
        }
        let stored: StoredEod | null = null;
        try {
          stored = await readOne(dashed);
        } catch {
          stored = null;
        }
        const pts = stored ? eodBarsToPoints(stored.bars) : [];
        if (pts.length) {
          bySymbol.set(symbol, pts);
          stats.cache++;
          fromTiingo.add(symbol);
        } else {
          residual.push(symbol);
        }
      })
    )
  );

  if (residual.length && deps.fmpBulk) {
    let fmp = new Map<string, HistoryPoint[]>();
    try {
      fmp = await deps.fmpBulk(residual);
    } catch {
      // A failed fallback leaves the residual as missing, never the build broken.
    }
    for (const symbol of residual) {
      const pts = fmp.get(symbol) ?? [];
      if (pts.length) {
        bySymbol.set(symbol, pts);
        stats.fmpFallback++;
      } else stats.missing++;
    }
  } else {
    stats.missing += residual.length;
  }
  return { bySymbol, stats, fromTiingo };
}
