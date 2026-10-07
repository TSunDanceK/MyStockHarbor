// THE DAY SLIDER'S NUMBERS (#552 COWORK #189): for each report, the move from
// the pre-report close to the close on trading day 1…30, and SPY's move over
// the same days. Pure, so a check can run it on a fixture.
//
// ── PERCENTAGES ONLY, NEVER PRICES (the Tiingo contract) ───────────────────
// The rows built here are what reach the client component. They carry derived
// percentages rounded to 0.01, short date labels and the report's own label and
// timing -- no close, no bar, no volume. check-reaction-days holds the shape to
// an allow-list and fails if a price leaks.
//
// ── THE SAME ANCHOR AS THE CHARTS ABOVE IT ─────────────────────────────────
// Day 1 is the reaction session and the base is the pre-report close, both
// exactly as computeEarningsReactionDetail chose them (its `anchor`): an
// after-close filing is measured from that day's close to the next. Day 5 and
// day 20 therefore equal the card's existing +5 / +20 figures.

export const REACTION_SLIDER_DAYS = 30;

/** Each row opens at a different horizon, cycling down the rows (the owner's "auto set to different dates"). */
export const REACTION_SLIDER_PRESETS = [1, 5, 20] as const;

export type ReactionAnchor = { baseIdx: number; reactIdx: number };
type Bar = { date: string; close: number | null | undefined };

export type ReactionDayRow = {
  /** "Q2 FY2026". */
  label: string;
  /** The report's date as filed, ISO (shown as "22 Jul 2026"). */
  reportDate: string;
  timing: "after close" | "before open" | null;
  /** Day N's move is pct[N-1]; shorter than 30 while the latest report is young. */
  pct: (number | null)[];
  /** SPY over the same days, against SPY's close on the same base date. */
  spy: (number | null)[];
  /** Day N's date, short ("7 Aug"), for the readout. */
  dayDates: string[];
  /** True when the series ends before day 30 (the slider stops at "Day N (latest)"). */
  truncated: boolean;
};

const round2 = (v: number) => Math.round(v * 100) / 100;
const DAY_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${DAY_MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""}`;

/** The move from the base close to each day's close, as %, up to `days` or the series end. */
export function dayPath(points: Bar[], anchor: ReactionAnchor, days = REACTION_SLIDER_DAYS): { pct: (number | null)[]; dates: string[] } {
  const base = points[anchor.baseIdx]?.close;
  const pct: (number | null)[] = [];
  const dates: string[] = [];
  if (typeof base !== "number" || !Number.isFinite(base) || base === 0) return { pct, dates };
  for (let n = 1; n <= days; n++) {
    const p = points[anchor.reactIdx + n - 1];
    if (!p) break;
    const c = p.close;
    pct.push(typeof c === "number" && Number.isFinite(c) ? round2(((c - base) / Math.abs(base)) * 100) : null);
    dates.push(p.date);
  }
  return { pct, dates };
}

/** SPY's move over the same dates, from its close on the same base date. Null where SPY has no bar that day. */
export function marketPath(spyByDate: Map<string, number>, baseDate: string | undefined, dates: string[]): (number | null)[] {
  const base = baseDate ? spyByDate.get(baseDate) : undefined;
  if (typeof base !== "number" || !Number.isFinite(base) || base === 0) return dates.map(() => null);
  return dates.map((d) => {
    const c = spyByDate.get(d);
    return typeof c === "number" && Number.isFinite(c) ? round2(((c - base) / Math.abs(base)) * 100) : null;
  });
}

/** The rows the slider renders. Reports with no anchor (not covered by the series) are left out. */
export function reactionDayRows(
  reports: { label: string; date: string; time: string | null | undefined; anchor: ReactionAnchor | null }[],
  points: Bar[],
  spy: Bar[],
): ReactionDayRow[] {
  const spyByDate = new Map<string, number>();
  for (const b of spy) if (typeof b.close === "number" && Number.isFinite(b.close)) spyByDate.set(b.date, b.close);
  const rows: ReactionDayRow[] = [];
  for (const r of reports) {
    if (!r.anchor) continue;
    const { pct, dates } = dayPath(points, r.anchor);
    if (!pct.some((v) => v !== null)) continue;
    const t = (r.time ?? "").toLowerCase();
    rows.push({
      label: r.label,
      reportDate: r.date,
      timing: t === "amc" ? "after close" : t === "bmo" ? "before open" : null,
      pct,
      spy: marketPath(spyByDate, points[r.anchor.baseIdx]?.date, dates),
      dayDates: dates.map(shortDate),
      truncated: pct.length < REACTION_SLIDER_DAYS,
    });
  }
  // NEWEST REPORT FIRST (#552 COWORK #192): a reader looks for the latest
  // report first, whatever order the reports arrive in.
  return rows.sort((a, b) => (a.reportDate < b.reportDate ? 1 : a.reportDate > b.reportDate ? -1 : 0));
}
