// THE ANALYSIS UNIVERSE'S SIZE SLICE: THE LARGEST COMPANIES BY MARKET CAP
// (#553 COWORK #182, ruled in #186).
//
// WHY. The universe was the curated preset, popular searches and the dynamic
// universe, which is refreshed from msh:market:state -- FMP-derived and frozen
// since the Tiingo gate. Nothing in it referred to size, so 44 of the top 300
// by cap (TSM, JNJ, WFC, VZ, DIS, T ...) were in no slice at all (CODE-B #155).
//
// WHAT. Every SEC picker row with a cover share count, times the latest stored
// Tiingo close, through the same secCapAndPe the pool overlay uses (A's
// marketCap(): a refused share basis -- ADS ratio, multi-class -- has no cap and
// is not ranked). The top TOP_BY_CAP, largest first, in the store's dashed
// spelling. A symbol needs both inputs; a gap is simply not ranked.
//
// COST. No new Redis command: readSecCapRows and readTiingoEodLast are the Data
// Cache blobs the price pool and the P/E medians already read (one HGETALL each
// on a miss, shared). No new Tiingo request: every stock-page symbol is already
// in the Tiingo universe, so these all have stored nightly bars.
import { readSecCapRows } from "./tiingoPool";
import { readTiingoEodLast } from "./marketData/read";
import { secCapAndPe, type SecCapRow } from "./pickersSecFundamentals";
import type { EodLast } from "./marketData/eodLast";
import { toDashed, toDotted } from "../symbolSpellings.mjs";

export const TOP_BY_CAP = 300;

/**
 * HELD OUT OF THE SIZE RANKING, DATED, until the reason is resolved.
 *   SPCX  2026-10-06 (#553 COWORK #186): ranks #8 on cover shares x close,
 *         which looks like a share-count or listing mix-up; A verifies its
 *         cover shares first. Held out here only: it can still enter through
 *         the other slices.
 */
export const CAP_RANK_HOLD_OUT: ReadonlySet<string> = new Set(["SPCX"]);

/** Pure: the `n` largest by cap, dashed spelling, ties A-Z. */
export function rankByCap(
  rows: Record<string, SecCapRow>,
  eod: Record<string, EodLast>,
  n = TOP_BY_CAP
): string[] {
  const capped: { sym: string; cap: number }[] = [];
  const seen = new Set<string>();
  for (const [field, row] of Object.entries(rows)) {
    const sym = toDashed(field);
    if (seen.has(sym) || CAP_RANK_HOLD_OUT.has(sym)) continue;
    seen.add(sym);
    const last = eod[sym] ?? eod[field] ?? eod[toDotted(sym)];
    const close = last && Number.isFinite(last.c) && last.c > 0 ? last.c : null;
    if (close === null) continue;
    const cap = secCapAndPe(row, close).marketCap;
    if (typeof cap === "number" && Number.isFinite(cap) && cap > 0) capped.push({ sym, cap });
  }
  capped.sort((a, b) => b.cap - a.cap || a.sym.localeCompare(b.sym));
  return capped.slice(0, n).map((c) => c.sym);
}

/** The build's read. Never throws: no inputs means no size slice, never a failed build. */
export async function readTopByCap(n = TOP_BY_CAP): Promise<string[]> {
  const [rows, eod] = await Promise.all([readSecCapRows().catch(() => null), readTiingoEodLast().catch(() => null)]);
  if (!rows || !eod) return [];
  return rankByCap(rows, eod, n);
}
