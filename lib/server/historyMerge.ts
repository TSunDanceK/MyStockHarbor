// Pure helpers for the incremental history fetch in historyCache.ts.
//
// SEPARATED FROM historyCache.ts DELIBERATELY, and the reason is testability
// rather than tidiness. This is the logic that decides whether a freshly
// fetched window can be appended to a stored series or whether the series has
// been restated by a corporate action. Getting it wrong does not throw and does
// not fail a build -- it silently stitches pre-split bars onto post-split bars
// and fabricates a gap that every chart and every pattern builder then treats
// as real price action. historyCache.ts cannot be imported without Redis and
// Next in scope; this file can, so scripts/check-history-merge.mjs exercises it
// directly.
//
// Nothing here does I/O, reads env, or touches time except through arguments.

export type MergePoint = {
  date: string;
  open?: number;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

// Relative tolerance on a close when comparing overlapping bars. Generous
// enough that float and rounding noise never trips it, far tighter than any
// real corporate action: the smallest ordinary split is 2:1, a 50% move.
export const HISTORY_RESTATEMENT_TOLERANCE = 0.005;

export function toIsoUtcDate(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function shiftIsoDate(iso: string, deltaDays: number) {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return toIsoUtcDate(ms + deltaDays * 86_400_000);
}

export type OverlapVerdict = "agrees" | "restated" | "unverifiable";

/**
 * Compare the bars present in BOTH the stored series and a freshly fetched
 * window.
 *
 * "unverifiable" (no shared dates) is deliberately NOT treated as agreement.
 * That is the case where the stored series is older than the overlap window --
 * precisely when a restatement is most likely to have happened unseen. The
 * caller must treat it like "restated" and refetch in full.
 */
export function overlapVerdict(
  stored: readonly MergePoint[],
  fetched: readonly MergePoint[],
  tolerance = HISTORY_RESTATEMENT_TOLERANCE
): OverlapVerdict {
  const storedByDate = new Map(stored.map((point) => [point.date, point]));
  let compared = 0;

  for (const point of fetched) {
    const prior = storedByDate.get(point.date);
    if (!prior) continue;

    const base = Math.abs(prior.close);
    if (base === 0) continue;

    compared += 1;

    if (Math.abs(point.close - prior.close) / base > tolerance) {
      return "restated";
    }
  }

  return compared > 0 ? "agrees" : "unverifiable";
}

/**
 * Freshly fetched bars win on a shared date -- they are the more recent read of
 * the same session. Result is ascending by date and capped to `maxDays` from
 * the newest end, matching what the caller stores.
 */
export function mergeDailyPoints(
  stored: readonly MergePoint[],
  fetched: readonly MergePoint[],
  maxDays: number
) {
  const byDate = new Map<string, MergePoint>();
  for (const point of stored) byDate.set(point.date, point);
  for (const point of fetched) byDate.set(point.date, point);

  const merged = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));

  return merged.length > maxDays ? merged.slice(-maxDays) : merged;
}
