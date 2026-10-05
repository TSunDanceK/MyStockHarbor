// STRETCH: HOW FAR A CLOSE SITS FROM ITS 20-DAY AVERAGE (#553 COWORK #141/#144).
//
// The owner's ruling on the study (CODE-B #135): overlap only. So no new page;
// a z20 column on the oversold/overbought picker pages and, on the stock page,
// one line of this stock's own past behaviour. PURE: closes (and highs/lows)
// in, numbers and words out. No fetch: the bars the page or row already holds.
//
//   z20 = (close - SMA20) / stdev(last 20 closes)   (population stdev)
//
// THE HISTORY LINE. When today's z20 is at or beyond +/-2 (the study's zone),
// count the past times this stock ENTERED the same zone (the first day of each
// run; the current run excluded) with 10 sessions after it, and how many of
// those reached the 20-day average again within 10 sessions (a session's range
// touching that day's SMA20). Fewer than 5 cases: "Too few past cases to say",
// never a ratio of tiny numbers. Past behaviour only; no "will".
//
// scripts/check-stretch.mjs holds the rules and mutants.

export type StretchBar = { close: number; high?: number; low?: number };

export const STRETCH_N = 20;
export const STRETCH_ZONE = 2;
export const STRETCH_WITHIN = 10;
export const MIN_CASES = 5;
export const TOO_FEW = "Too few past cases to say";

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** SMA20 and z20 at every index (null until 20 closes, or when the 20 closes are all equal). */
export function stretchSeries(closes: readonly number[], n = STRETCH_N): { sma: (number | null)[]; z: (number | null)[] } {
  const sma: (number | null)[] = closes.map(() => null);
  const z: (number | null)[] = closes.map(() => null);
  for (let i = n - 1; i < closes.length; i++) {
    const w = closes.slice(i - n + 1, i + 1);
    if (!w.every(fin)) continue;
    const m = w.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) * (b - m), 0) / n);
    sma[i] = m;
    z[i] = sd > 0 ? (closes[i] - m) / sd : null;
  }
  return { sma, z };
}

/** Today's z20, or null. */
export function latestStretch(closes: readonly number[]): number | null {
  if (closes.length < STRETCH_N) return null;
  const { z } = stretchSeries(closes.slice(-STRETCH_N));
  return z[z.length - 1];
}

export type StretchHistory = {
  z: number | null;
  side: "below" | "above" | null;
  /** Past entries into today's zone with a full 10 sessions after them. */
  cases: number;
  /** Of those, how many reached the 20-day average again within 10 sessions. */
  back: number;
};

export function stretchHistory(bars: readonly StretchBar[]): StretchHistory {
  const closes = bars.map((b) => b.close);
  const { sma, z } = stretchSeries(closes);
  const last = z.length - 1;
  const zNow = last >= 0 ? z[last] : null;
  if (zNow === null) return { z: null, side: null, cases: 0, back: 0 };
  const side = zNow <= -STRETCH_ZONE ? "below" : zNow >= STRETCH_ZONE ? "above" : null;
  if (!side) return { z: zNow, side: null, cases: 0, back: 0 };
  const inZone = (i: number) => z[i] !== null && (side === "below" ? (z[i] as number) <= -STRETCH_ZONE : (z[i] as number) >= STRETCH_ZONE);
  // The current run started here; it is today's case, not a past one.
  let runStart = last;
  while (runStart > 0 && inZone(runStart - 1)) runStart--;
  let cases = 0, back = 0;
  for (let t = 1; t < runStart; t++) {
    if (!inZone(t) || inZone(t - 1) || t + STRETCH_WITHIN >= bars.length) continue;
    cases++;
    for (let k = t + 1; k <= t + STRETCH_WITHIN; k++) {
      const s = sma[k];
      if (s === null) continue;
      const reach = side === "below" ? (fin(bars[k].high) ? bars[k].high! : bars[k].close) >= s : (fin(bars[k].low) ? bars[k].low! : bars[k].close) <= s;
      if (reach) { back++; break; }
    }
  }
  return { z: zNow, side, cases, back };
}

/** "2.3" for the column and the line: one decimal, a true minus sign never needed (the words say the side). */
export const fmtZ = (z: number) => Math.abs(z).toFixed(1);

/** The stock page's line: the reading, then (in the zone) the history or "Too few past cases to say". */
export function stretchLine(symbol: string, h: StretchHistory): string | null {
  if (h.z === null) return null;
  const dir = h.z < 0 ? "below" : "above";
  const reading = `${symbol} closed ${fmtZ(h.z)} standard deviations ${dir} its 20-day average.`;
  if (!h.side) return reading;
  if (h.cases < MIN_CASES) return `${reading} ${TOO_FEW}.`;
  return `${reading} The last ${h.cases} times ${symbol} was this far ${h.side} its 20-day average, it was back to it within ${STRETCH_WITHIN} sessions ${h.back} times.`;
}

/** The tap note (survivorship stated here, not on the page). */
export const STRETCH_NOTE =
  "Stretch counts standard deviations between the last close and the 20-day average of closes. The history counts this stock's own stored daily bars (up to about five years): each time it first moved 2 or more standard deviations from that average, and whether a later session within 10 reached the average again. It describes the past, not what comes next. Our study across all stocks covered only companies still listed today, which can make returns to the average look more common than they were, most of all for smaller companies.";
