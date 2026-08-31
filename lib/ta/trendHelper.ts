// lib/ta/trendHelper.ts
//
// SINGLE SOURCE OF TRUTH for the Noise Cutter "Trend Helper" (ported from the
// owner's Pine v6). Before this file the math existed twice -- app/components/
// PriceChart.tsx (`wmaNullable`/`hmaSeries`/`computeTrendHelper`) and
// app/components/InteractiveChart.tsx (`wmaSeries`/`hmaSeries`, inline in
// `makeTrendHelper`). The two were verified byte-equivalent in behaviour on
// 2026-08-25, but only by inspection, not by construction -- exactly the shape
// of the `getSellSignalCount` divergence already logged in
// claude/OPEN-ENGINEERING-ITEMS.md. Both chart components MUST import from here
// rather than keep private copies, and nothing server-side may add a third.
//
// ── The indicator ────────────────────────────────────────────────────────────
// HMA(n) = WMA(2·WMA(n/2) − WMA(n), √n), matching Pine's `ta.hma` exactly,
// including Pine's integer division on n/2 and `math.round` on √n.
//
// The line is coloured by a CONFIRMED trend state: `confirmBars` consecutive
// bars closing the correct side of a rising (or falling) HMA before the state
// flips. Once confirmed, the state is HELD through pullbacks until the opposite
// direction confirms -- a deliberate improvement on the source Pine, which
// resets to neutral on any single counter-bar and flickers.
//
// TWO CONSEQUENCES OF THAT HOLD, both load-bearing for the picker pages:
//   1. `state` is "last confirmed direction", NOT "current condition". A symbol
//      can read +1 while price sits below a falling HMA, right up until the
//      down side confirms.
//   2. State 0 is ONLY the pre-first-confirmation warm-up. Once the state
//      leaves 0 it can never return, so a 0 -> ±1 transition happens exactly
//      once per symbol per timeframe and is NOT a trend change -- it is the HMA
//      becoming computable. `isFirstConfirmation` exists to let callers exclude
//      it; the picker pages MUST.
//
// ── Performance ──────────────────────────────────────────────────────────────
// `wmaSeries` is a rolling-sum O(n) implementation, not the O(n·len) nested
// loop the two chart copies use. Irrelevant for one chart; not irrelevant for
// ~700 symbols across two timeframes inside a warm run that already has a
// documented timeout cliff (see app/api/jobs/warm-picker-universe/route.ts).

// ── Presets ──────────────────────────────────────────────────────────────────
// SLOW is the preset the trend-flip picker pages are built on. FAST is left at
// confirmBars 1 to preserve the existing dashboard chart exactly; note that
// confirm=1 means `bull >= 1` fires on the first qualifying bar, i.e. the noise
// filter is effectively OFF on that preset. Deliberate, and out of scope here.
export const TREND_HELPER_SLOW = { trendLen: 55, confirmBars: 2 } as const;
export const TREND_HELPER_FAST = { trendLen: 21, confirmBars: 1 } as const;

// Shared with both chart components so the colours cannot drift either.
export const TREND_HELPER_COLORS = {
  bull: "#3b82f6", // blue   (confirmed up)
  bear: "#eab308", // yellow (confirmed down)
  neutral: "#94a3b8", // grey (unconfirmed / pre-trend)
  ma200: "#a855f7", // purple
} as const;

function isFin(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Weighted moving average over a possibly-null series. Most recent bar carries
 * weight `len`, oldest carries 1, denominator len(len+1)/2.
 *
 * Rolling-sum implementation, O(n). Nulls split the input into contiguous
 * valid segments and the recurrence restarts inside each one, so a null can
 * never leak a stale window sum across the gap. Output is null wherever the
 * trailing `len` inputs are not all finite -- identical null semantics to the
 * nested-loop version this replaces.
 */
export function wmaSeries(values: Array<number | null>, len: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (len < 1) return out;
  const denom = (len * (len + 1)) / 2;

  let i = 0;
  while (i < values.length) {
    if (!isFin(values[i])) {
      i++;
      continue;
    }
    let end = i;
    while (end < values.length && isFin(values[end])) end++;

    if (end - i >= len) {
      // Seed the first window directly: values[i] is the OLDEST bar in it, so
      // it takes weight 1 and values[i + len - 1] takes weight len.
      let num = 0;
      let sum = 0;
      for (let k = 0; k < len; k++) {
        const v = values[i + k] as number;
        num += v * (k + 1);
        sum += v;
      }
      out[i + len - 1] = num / denom;

      // num_j = num_{j-1} + len·v[j] − S_{j-1}, where S_{j-1} is the plain sum
      // of the previous window. Shifting every weight down by one and adding
      // the new bar at full weight is exactly that subtraction.
      for (let j = i + len; j < end; j++) {
        const incoming = values[j] as number;
        const dropped = values[j - len] as number;
        num = num + len * incoming - sum;
        sum = sum + incoming - dropped;
        out[j] = num / denom;
      }
    }
    i = end;
  }
  return out;
}

/** Hull moving average. Pine-equivalent: floor(len/2) and round(sqrt(len)). */
export function hmaSeries(values: Array<number | null>, len: number): Array<number | null> {
  const half = Math.max(1, Math.floor(len / 2));
  const sq = Math.max(1, Math.round(Math.sqrt(len)));
  const wHalf = wmaSeries(values, half);
  const wFull = wmaSeries(values, len);
  const diff: Array<number | null> = values.map((_v, i) => {
    const a = wHalf[i];
    const b = wFull[i];
    return isFin(a) && isFin(b) ? 2 * a - b : null;
  });
  return wmaSeries(diff, sq);
}

/** Simple moving average. Kept here so the charts' MA200 comes from one place too. */
export function smaSeries(values: Array<number | null>, len: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (len < 1) return out;
  let sum = 0;
  let run = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isFin(v)) {
      sum = 0;
      run = 0;
      continue;
    }
    sum += v;
    run++;
    if (run > len) sum -= values[i - len] as number;
    if (run >= len) out[i] = sum / len;
  }
  return out;
}

export type TrendDirection = 1 | -1 | 0;

export type TrendHelperSeries = {
  /** The HMA itself. Null through warm-up. */
  line: Array<number | null>;
  /** Last CONFIRMED direction at each bar. 0 only before the first confirmation. */
  state: TrendDirection[];
  /** Index of the bar on which the state at i was established. -1 before any. */
  flipIndex: number[];
  /** i − flipIndex[i]. 0 means "the state was established on this very bar". */
  barsSinceFlip: Array<number | null>;
  /**
   * True while the state at i still traces back to the FIRST confirmation in
   * this symbol's history (the 0 -> ±1 transition). That is HMA warm-up
   * finishing, not a trend change. Callers screening for flips must exclude it.
   */
  isFirstConfirmation: boolean[];
};

export function computeTrendHelper(
  closes: Array<number | null>,
  trendLen: number,
  confirmBars: number
): TrendHelperSeries {
  const n = closes.length;
  const line = hmaSeries(closes, trendLen);
  const state: TrendDirection[] = new Array(n).fill(0);
  const flipIndex: number[] = new Array(n).fill(-1);
  const barsSinceFlip: Array<number | null> = new Array(n).fill(null);
  const isFirstConfirmation: boolean[] = new Array(n).fill(false);

  let bull = 0;
  let bear = 0;
  let last: TrendDirection = 0;
  let lastFlipIdx = -1;
  let confirmations = 0;

  for (let i = 0; i < n; i++) {
    const c = closes[i];
    const t = line[i];
    const tp = i > 0 ? line[i - 1] : null;

    // Both conditions required: price on the correct side AND the HMA sloping
    // that way. A flat HMA (t === tp) qualifies as neither, by design.
    const up = isFin(c) && isFin(t) && isFin(tp) && c > t && t > tp;
    const dn = isFin(c) && isFin(t) && isFin(tp) && c < t && t < tp;

    bull = up ? bull + 1 : 0;
    bear = dn ? bear + 1 : 0;

    let next: TrendDirection = last;
    if (bull >= confirmBars) next = 1;
    else if (bear >= confirmBars) next = -1;

    if (next !== last) {
      lastFlipIdx = i;
      confirmations++;
    }
    last = next;

    state[i] = last;
    flipIndex[i] = lastFlipIdx;
    barsSinceFlip[i] = lastFlipIdx >= 0 ? i - lastFlipIdx : null;
    isFirstConfirmation[i] = confirmations <= 1;
  }

  return { line, state, flipIndex, barsSinceFlip, isFirstConfirmation };
}

export type TrendFlip = {
  direction: TrendDirection;
  /** 0 = flipped on the most recent bar supplied. */
  barsSinceFlip: number;
  /** Index into the input series of the bar the flip confirmed on. */
  flipIndex: number;
  /** True if this is the symbol's first-ever confirmation (HMA warm-up). */
  isFirstConfirmation: boolean;
};

/**
 * The state of the LAST bar supplied, as a flip record. Returns null when the
 * series never confirmed a direction at all (too short for the HMA).
 *
 * Callers screening for trend changes should reject `isFirstConfirmation`
 * outright and then apply their own `barsSinceFlip` window.
 *
 * IMPORTANT: pass CLOSED bars only. Feeding a live, unclosed bar makes the
 * result repaint -- a flip can appear intraday and be gone by the close.
 */
export function latestTrendFlip(
  closes: Array<number | null>,
  trendLen: number,
  confirmBars: number
): TrendFlip | null {
  if (!closes.length) return null;
  const r = computeTrendHelper(closes, trendLen, confirmBars);
  const i = closes.length - 1;
  const bars = r.barsSinceFlip[i];
  if (r.state[i] === 0 || r.flipIndex[i] < 0 || bars === null) return null;
  return {
    direction: r.state[i],
    barsSinceFlip: bars,
    flipIndex: r.flipIndex[i],
    isFirstConfirmation: r.isFirstConfirmation[i],
  };
}

export type DatedClose = { date: string; close: number | null };

/**
 * Collapse daily bars into weekly bars (last close of each ISO week).
 *
 * THE FINAL GROUP IS ALWAYS DROPPED. A week is treated as closed only when a
 * bar exists in a LATER week, which is the one rule that needs no weekday
 * heuristic and no holiday calendar: it cannot mistake a half-finished week for
 * a complete one, and Good Friday cannot fool it either. The cost is a
 * one-trading-day lag -- the week ending Friday becomes available once Monday's
 * bar lands, which for a 07:00 warm means Monday morning.
 *
 * Returns bars in ascending date order. `date` is the date of the last daily
 * bar in that week, so it can be shown as the week-ending date verbatim.
 */
export function resampleWeeklyClosed(daily: DatedClose[]): DatedClose[] {
  const groups: Array<{ key: string; date: string; close: number | null }> = [];
  let currentKey = "";

  for (const bar of daily) {
    const key = isoWeekKey(bar.date);
    if (!key) continue;
    if (key !== currentKey) {
      groups.push({ key, date: bar.date, close: bar.close });
      currentKey = key;
    } else {
      const g = groups[groups.length - 1];
      g.date = bar.date;
      g.close = bar.close;
    }
  }

  // Drop the trailing (possibly partial) week. See the note above.
  if (groups.length) groups.pop();
  return groups.map((g) => ({ date: g.date, close: g.close }));
}

/** "YYYY-Www" ISO week key. Returns "" for an unparseable date. */
export function isoWeekKey(dateStr: string): string {
  const ms = Date.parse(dateStr.includes("T") ? dateStr : `${dateStr}T00:00:00Z`);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  // ISO: Thursday of the current week decides the year and week number.
  const day = (d.getUTCDay() + 6) % 7; // Mon = 0 ... Sun = 6
  d.setUTCDate(d.getUTCDate() - day + 3);
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** The fields the date-join needs. Structurally satisfied by PickerChartPoint. */
export type DatedPoint = { date: string };

/**
 * Copy a precomputed Trend Helper series onto chart points, JOINED BY DATE.
 *
 * ALIGNMENT IS THE ONE THING HERE THAT CAN SILENTLY PRODUCE A WRONG CHART. The
 * caller's two arrays do not share indices: picker chartPoints come from points
 * filtered for a finite close and sliced to the last 72, while the trend series
 * comes from the closed daily series (all points, minus a live unclosed bar).
 * Index-joining them draws a line whose colour changes a bar or two away from
 * the flip date printed in the same row -- a chart that looks plausible and
 * contradicts the text beside it, which is worse than drawing nothing. The date
 * string is the only thing both sides agree on.
 *
 * LIVES HERE, not beside its caller, because this file imports nothing and so
 * scripts/check-trend-helper-attach.mjs can exercise the real function against
 * the real computeTrendHelper. In lib/server/pickersBuilder.ts -- Redis, Next
 * and some forty modules deep -- the only testable option would have been a
 * copy of the logic, which is the divergence this file's header exists to
 * forbid.
 *
 * Only the last `bars` points get the fields: the mini chart's visible window is
 * 64 bars (MiniPickerCandleChart's visibleLimit), so anything earlier is bytes
 * nobody renders.
 */
export function attachTrendHelper<T extends DatedPoint>(
  chartPoints: T[],
  trend: { dates: string[]; line: Array<number | null>; state: number[] },
  bars = 64
): T[] {
  const byDate = new Map<string, { line: number | null; state: number }>();
  for (let i = 0; i < trend.dates.length; i++) {
    byDate.set(trend.dates[i], { line: trend.line[i], state: trend.state[i] ?? 0 });
  }

  const from = Math.max(0, chartPoints.length - bars);
  return chartPoints.map((point, index) => {
    if (index < from) return point;
    const hit = byDate.get(point.date.slice(0, 10));
    if (!hit || typeof hit.line !== "number" || !Number.isFinite(hit.line)) return point;
    return {
      ...point,
      trendLine: Number(hit.line.toFixed(2)),
      trendState: (hit.state > 0 ? 1 : hit.state < 0 ? -1 : 0) as -1 | 0 | 1,
    };
  });
}
