// THE PICKERS UNIVERSE'S LIQUIDITY SLICE: SLOTS 701-1,000 (#552 COWORK #233/#235, S1).
//
// WHY. The universe was full at 700 (preset, the size slice, popular searches,
// then the dynamic universe). Growing it by letting the dynamic universe
// backfill further would admit whatever FMP discovery last scored, which is
// frozen. These slots go instead to large, actively traded companies, ranked on
// two of the site's own stored figures:
//
//   market cap      SEC cover shares x the latest stored Tiingo close, through
//                   the same secCapAndPe the pool overlay and the size slice use
//   dollar volume   the 20-session mean of close x volume, written nightly with
//                   the newest-bar summary (eodLast.ts `dv`)
//
// Ranked by cap x dollar volume, with floors on each. A symbol needs a SEC cap
// row (written only for symbols the SEC seed gate admits: warm-pickers-sec
// filters with admittedForSec before any read, so ETFs, preferreds and other
// non-common listings never have one) and a Tiingo row (so it is
// Tiingo-supported and already has stored bars). Both are already maintained
// for ~2,600 symbols, so a new name needs no new job and no backfill.
//
// THE ROLLBACK IS THE CAP. The slice only fills slots above PRE_S1_UNIVERSE_CAP,
// so at ANALYSIS_UNIVERSE_CAP 700 it gets none and the build is exactly the
// pre-S1 build. Nothing is written for it: it is recomputed every build from
// the Data Cache blobs the size slice already reads. No Next imports, so the
// preview relay and the checks run the build's own ranking.
import type { EodLast } from "./marketData/eodLast";
import { secCapAndPe, type SecCapRow } from "./pickersSecFundamentals";
import { toDashed, toDotted } from "../symbolSpellings.mjs";

/** The universe size before S1. Slots above it are this slice's; at or below it, it adds none. */
export const PRE_S1_UNIVERSE_CAP = 700;
/** Floors (COWORK #233 §3). */
export const LIQUIDITY_MIN_CAP = 2_000_000_000;
export const LIQUIDITY_MIN_DOLLAR_VOLUME = 10_000_000;

export type LiquidityCandidate = { sym: string; cap: number; dv: number; score: number };

/**
 * Pure. Every symbol with both a SEC cap and a 20-session dollar volume, scored
 * cap x dollar volume, largest first (ties A-Z), dashed spelling. `passes` says
 * whether it clears both floors; the build takes only those, and the preview
 * relay prints the near misses.
 */
export function scoreByCapAndLiquidity(
  rows: Record<string, SecCapRow>,
  eod: Record<string, EodLast>,
  holdOut: ReadonlySet<string> = new Set()
): (LiquidityCandidate & { passes: boolean })[] {
  const out: (LiquidityCandidate & { passes: boolean })[] = [];
  const seen = new Set<string>();
  for (const [field, row] of Object.entries(rows)) {
    const sym = toDashed(field);
    if (seen.has(sym) || holdOut.has(sym)) continue;
    seen.add(sym);
    const last = eod[sym] ?? eod[field] ?? eod[toDotted(sym)];
    const close = last && Number.isFinite(last.c) && last.c > 0 ? last.c : null;
    const dv = last && typeof last.dv === "number" && Number.isFinite(last.dv) && last.dv > 0 ? last.dv : null;
    if (close === null || dv === null) continue;
    const cap = secCapAndPe(row, close).marketCap;
    if (typeof cap !== "number" || !Number.isFinite(cap) || cap <= 0) continue;
    out.push({ sym, cap, dv, score: cap * dv, passes: cap >= LIQUIDITY_MIN_CAP && dv >= LIQUIDITY_MIN_DOLLAR_VOLUME });
  }
  out.sort((a, b) => b.score - a.score || a.sym.localeCompare(b.sym));
  return out;
}

/** Pure. The ranked symbols that clear both floors. */
export function rankByCapAndLiquidity(
  rows: Record<string, SecCapRow>,
  eod: Record<string, EodLast>,
  holdOut: ReadonlySet<string> = new Set()
): string[] {
  return scoreByCapAndLiquidity(rows, eod, holdOut).filter((c) => c.passes).map((c) => c.sym);
}

/** How many slots the slice may fill at a given universe cap: none at or below the pre-S1 size. */
export function liquiditySlots(universeCap: number): number {
  return Math.max(0, universeCap - PRE_S1_UNIVERSE_CAP);
}
