// ONE MARKET-CAP BASIS PER SECTOR RANKING (#553 CODE-B #94 B7, FMP-off).
//
// The sector index ranks each sector's constituents by market cap and keeps the
// top MAX_CONSTITUENTS_PER_SECTOR. It used to read FMP's caps only (the
// fundamentals and screener caches); once FMP stops refilling them every cap is
// 0 and "largest first" quietly becomes input order.
//
// THE BASES, chosen ONCE per build, never per symbol:
//   "sec-tiingo"  SEC cover-page shares x the Tiingo price, the pool overlay's
//                 own cap (tiingoPool.secTiingoCaps -> A's marketCap()). Used
//                 whenever the POOL gate is on Tiingo and at least one candidate
//                 has such a cap.
//   "fmp"         the FMP caches, ONLY while FMP_API_KEY is set and they still
//                 hold at least one cap (the pre-flip ranking, or the fallback
//                 when the SEC/Tiingo inputs are empty).
//   "none"        neither: every cap is 0 and the order is the candidate order
//                 (the preset mega-caps first), said in the index's capBasis.
//
// NEVER MIXED. A symbol with no cap on the chosen basis ranks as 0 -- it does
// NOT borrow its FMP cap, which would put a frozen FMP figure and a SEC x
// Tiingo figure in the same sort. Pure; scripts/check-fmpoff-sec-cap.mjs runs it.

export type CapBasis = "sec-tiingo" | "fmp" | "none";

const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** How many values in a cap map are usable. */
export function countCaps(caps: Map<string, number | null>): number {
  let n = 0;
  for (const v of caps.values()) if (positive(v)) n++;
  return n;
}

/** Which basis this build ranks on. */
export function chooseCapBasis(o: {
  poolOnTiingo: boolean;
  secTiingoCaps: number;
  fmpKeySet: boolean;
  fmpCaps: number;
}): CapBasis {
  if (o.poolOnTiingo && o.secTiingoCaps > 0) return "sec-tiingo";
  if (o.fmpKeySet && o.fmpCaps > 0) return "fmp";
  return "none";
}

/** One cap per symbol, all from `basis` (0 where that basis has none). */
export function capsOnBasis(
  basis: CapBasis,
  symbols: string[],
  secTiingo: Map<string, number | null>,
  fmp: Map<string, number | null>
): Map<string, number> {
  const source = basis === "sec-tiingo" ? secTiingo : basis === "fmp" ? fmp : null;
  const out = new Map<string, number>();
  for (const s of symbols) {
    const v = source?.get(s);
    out.set(s, positive(v) ? v : 0);
  }
  return out;
}

/**
 * Largest first, top `limit`. A stable sort, so equal caps (all 0 on "none")
 * keep the candidate order.
 */
export function rankByCap(symbols: string[], caps: Map<string, number>, limit: number): string[] {
  return symbols
    .map((symbol, i) => ({ symbol, cap: caps.get(symbol) ?? 0, i }))
    .sort((a, b) => b.cap - a.cap || a.i - b.i)
    .slice(0, Math.max(0, limit))
    .map((r) => r.symbol);
}
