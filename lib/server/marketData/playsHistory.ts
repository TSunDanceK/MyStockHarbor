// THE /plays SCANS ON STORED TIINGO BARS (#553 CODE-B #94 B4).
//
// /plays, /plays/bull-flags and /plays/descending-triangles scan ~700 symbols'
// daily history. They read FMP's history cache, which nothing refreshes once
// PRICE_PROVIDER_PICKERS=tiingo stops the Pickers build writing it, so all
// three emptied about two days after the FMP cutover (14 Oct).
//
// The plays are Pickers-family (same universe, same build-time scan, the same
// bars the Pickers build reads), so they follow PRICE_PROVIDER_PICKERS:
//
//   tiingo  step 2's tiers (pickerHistory.ts): the Data Cache entry per
//           symbol (Redis only on a miss, ~once per symbol per region per day,
//           and the Pickers build already warms the same entries), then the
//           builder's own FMP path for the residual ONLY while FMP_API_KEY is
//           set. Each symbol's series comes whole from one source: never
//           spliced across providers.
//   fmp     null: the builder's existing FMP path, unchanged.
//
// NEVER A LIVE TIINGO CALL: read.ts only (scripts/check-tiingo-callers.mjs).
// Checked by scripts/check-fmpoff-plays-perf.mjs.
import pLimit from "p-limit";
import { priceProviderFor } from "./provider";
import { tiingoPickerHistory, type HistoryPoint, type PickerHistoryDeps, type PickerHistoryResult } from "./pickerHistory";

export type PlaysHistoryOpts = {
  env?: Record<string, string | undefined>;
  readOne?: PickerHistoryDeps["readOne"];
  concurrency?: number;
};

/**
 * The scan universe's bars from Tiingo when the Pickers surface is on Tiingo,
 * else null (the caller keeps its FMP path). `fmpOne` is the builder's FMP
 * read for one symbol; it is used only for symbols Tiingo has no stored
 * history for, and only while FMP_API_KEY is set.
 */
export async function playsTiingoHistory(
  universe: readonly string[],
  fmpOne: (symbol: string) => Promise<HistoryPoint[]>,
  opts: PlaysHistoryOpts = {}
): Promise<PickerHistoryResult | null> {
  const env = opts.env ?? process.env;
  if (priceProviderFor("PICKERS", env) !== "tiingo") return null;
  const fmpLimit = pLimit(10);
  const fmpBulk = env.FMP_API_KEY
    ? async (symbols: string[]) => {
        const out = new Map<string, HistoryPoint[]>();
        await Promise.all(
          symbols.map((symbol) =>
            fmpLimit(async () => {
              try {
                const pts = await fmpOne(symbol);
                if (pts.length) out.set(symbol, pts);
              } catch {
                // a failed fallback is a missing symbol, never a failed scan
              }
            })
          )
        );
        return out;
      }
    : null;
  return tiingoPickerHistory(universe, null, { readOne: opts.readOne, concurrency: opts.concurrency, fmpBulk });
}
