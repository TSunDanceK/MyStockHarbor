// THE EARNINGS SNAPSHOT TILES AGAINST THE SAME PERIOD A YEAR EARLIER
// (#563 COWORK #123): the comparison the card already states ("Growth is
// measured against Q2 FY2025"), now carried by each tile's colour.
//
//   EPS (diluted)   green when higher than a year earlier, red when lower;
//                   both losses: green when the loss narrowed, red when it
//                   widened, and the sub-line says so ("loss narrowed from
//                   -$0.12")
//   margins         green when up by at least MARGIN_STEP_PT points, red when
//                   down by as much, uncoloured in between; the sub-line
//                   "▲ 2.1 pt vs Q2 FY2025"
//   no year-ago     uncoloured, "no year-ago figure"
//
// PURE and import-free: the card (a client module) and the check both run it.
// The figures are the snapshot's own (lib/server/secEarningsSnapshot.ts,
// `yearAgo`); nothing here reads or recomputes them. Colour is a direction
// against a filed figure, never a call on the stock.

/** Points a margin must move before it is coloured: the earnings page's MARGIN_BAND_PP. */
export const MARGIN_STEP_PT = 0.5;

/**
 * The faint tile tint, the earnings page snapshot's (secPresentation.toneTint,
 * which a client module cannot import): the same rgb at 0.08.
 */
export const VS_TINT = { good: "rgba(34,197,94,0.08)", weak: "rgba(239,68,68,0.08)" } as const;

export type VsTone = "good" | "weak" | null;
export type Vs = { tone: VsTone; words: string | null };

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** "no year-ago figure": the tile stays uncoloured and says why. */
export const NO_YEAR_AGO = "no year-ago figure";

/**
 * EPS against the year-ago quarter. `money` formats a per-share figure the way
 * the tile prints it. Words only where they add something: a both-loss change,
 * or a missing year-ago figure; otherwise null (the tile keeps its growth line).
 */
export function epsVsYearAgo(now: number | null | undefined, then: number | null | undefined, money: (v: number) => string): Vs {
  if (!fin(now)) return { tone: null, words: null };
  if (!fin(then)) return { tone: null, words: NO_YEAR_AGO };
  const same = Math.round(now * 100) === Math.round(then * 100);
  if (now < 0 && then < 0) {
    if (same) return { tone: null, words: `loss unchanged from ${money(then)}` };
    return now > then ? { tone: "good", words: `loss narrowed from ${money(then)}` } : { tone: "weak", words: `loss widened from ${money(then)}` };
  }
  if (same) return { tone: null, words: null };
  return { tone: now > then ? "good" : "weak", words: null };
}

/** A margin (a level, in %) against the year-ago quarter's: "▲ 2.1 pt vs Q2 FY2025". */
export function marginVsYearAgo(now: number | null | undefined, then: number | null | undefined, label: string | null | undefined): Vs {
  if (!fin(now)) return { tone: null, words: null };
  if (!fin(then) || !label) return { tone: null, words: NO_YEAR_AGO };
  const d = Math.round((now - then) * 10) / 10;
  const words = d === 0 ? `level with ${label}` : `${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)} pt vs ${label}`;
  return { tone: d >= MARGIN_STEP_PT ? "good" : d <= -MARGIN_STEP_PT ? "weak" : null, words };
}

/**
 * "Partial · 4 of 5 measured" → "1 input not measured: tap for why", the one
 * muted line that stands in for the partial-score paragraph (now behind it).
 */
export function partialLine(toneLabel: string): string {
  const m = /(\d+) of (\d+) measured/i.exec(toneLabel);
  const missing = m ? Number(m[2]) - Number(m[1]) : 0;
  return missing > 0 ? `${missing} input${missing === 1 ? "" : "s"} not measured: tap for why` : "Not every input was measured: tap for why";
}
