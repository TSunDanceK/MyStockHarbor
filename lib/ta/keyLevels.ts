// KEY LEVELS (#563 COWORK #64, on #552 CODE-A #137 §1 and COWORK #133): the
// day's, this week's and this month's open, high, low and close, from the daily
// bars the stock page already holds. Pure arithmetic: no fetch, no Redis, no
// new public JSON. Read-only over the history series (B's), never edited here.
//
// THE OWNER'S DEFINITIONS (3 Oct), all from the latest daily candle:
//
//   Day    the last candle's open / high / low / close
//   Week   the open of this week's first trading day (Monday, or the first
//          session after a Monday holiday); the highest high / lowest low
//          since then; the latest close
//   Month  the open of this month's first trading candle; the highest high /
//          lowest low since then; the latest close
//
// "Week" is the ISO week (Mon–Sun) and "month" the calendar month, both read
// off the bars' own dates, so a holiday is simply a missing bar and a weekend
// needs no special case. Sat 3 Oct 2026: the day is Fri 2 Oct, the week opens
// at Mon 28 Sep's open, the month at Thu 1 Oct's open.
//
// TODAY SO FAR, IN SESSION ONLY (owner ruling, #563 COWORK #75/#76; this
// replaces #64's "closed candles only"). With the page's render time, Tiingo's
// "today so far" bar (`partial: true`, from the hourly pool row) counts while
// the market is open and the bar is really today's: the Day column is today so
// far, and the week and month include it. Out of session (weekends, holidays,
// pre-market, after the close, or a stale partial from an earlier day) it is
// dropped and everything reads off the last completed session, "as of the
// close on …". Without a render time: completed sessions only. lib/ta/
// sessionBar.ts decides; nothing here invents a bar.
//
// NEVER A GUESSED LEVEL. A week or month whose first session may be missing
// from the series (no bar on file before the period starts) is withheld with
// its reason, as is a level whose bars lack the field it needs. The card shows
// what it can and says why for the rest; it is never blank.

import { liveBars } from "./sessionBar";

/** A daily bar as the stock page holds it: `open`/`high`/`low` can be absent. */
export type KeyBar = {
  date: string;
  /** The partial bar's own label, "today so far (IEX), hh:mm ET". */
  label?: string;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  partial?: boolean;
};

export type LevelField = "open" | "high" | "low" | "close";
export const LEVEL_FIELDS: readonly LevelField[] = ["open", "high", "low", "close"];

export type PeriodKey = "day" | "week" | "month";

/** One level: a value, or none and the reason why. */
export type Level = { value: number | null; reason: string | null };

export type PeriodLevels = {
  key: PeriodKey;
  /** The date of the period's first bar used ("2026-09-28"), or null when withheld. */
  from: string | null;
  levels: Record<LevelField, Level>;
  /** Why the whole period is withheld, or null. */
  reason: string | null;
  /**
   * The PREVIOUS period's close (#563 COWORK #78): the session before the day,
   * the final session of the prior week or month. A running period has an open
   * but no close, so these are the useful "close" levels. Null with prevReason.
   */
  prevClose: { value: number; date: string } | null;
  prevReason: string | null;
};

/** The previous period's close is not on file (a recent listing). */
export const PREV_MISSING: Record<PeriodKey, string> = {
  day: "The session before isn't in the prices on file.",
  week: "Last week's close isn't in the prices on file.",
  month: "Last month's close isn't in the prices on file.",
};
export const PREV_WORDS: Record<PeriodKey, string> = { day: "Previous session's close", week: "Last week's close", month: "Last month's close" };

export type KeyLevels = {
  /** The closed candle everything is built from ("2026-10-02"), or null with no bars. */
  asOf: string | null;
  /** That date in words: "Fri 2 Oct 2026". */
  asOfWords: string | null;
  /** That candle's close: the reference when the page has no last price. */
  lastClose: number | null;
  periods: PeriodLevels[];
  /** One line per withheld period or level, for under the grid. Empty when all shown. */
  reasons: string[];
  /** Set when the latest bar is today's in-session partial: its own "hh:mm" (ET), or null if its label has none. */
  live: { time: string | null; phase: "session" | "afterClose" } | null;
};

export const NO_BARS_REASON = "No daily prices are on file for this stock yet, so no levels can be shown.";
export const SHORT_REASON: Record<Exclude<PeriodKey, "day">, string> = {
  week: "This week's levels need the daily prices back to the week's first session, and the prices on file start later.",
  month: "This month's levels need the daily prices back to the month's first session, and the prices on file start later.",
};
export const PERIOD_WORDS: Record<PeriodKey, { title: string; possessive: string }> = {
  day: { title: "Day", possessive: "The latest session's" },
  week: { title: "Week", possessive: "This week's" },
  month: { title: "Month", possessive: "This month's" },
};
/** The level's field is absent from a bar the period needs. */
export const fieldMissingReason = (key: PeriodKey, field: LevelField) =>
  `${PERIOD_WORDS[key].possessive} ${field} isn't in the stored daily prices.`;

/** Below this distance (in %, after rounding to one decimal) a level is "at the last price". */
export const AT_PRICE_BELOW_PCT = 0.05;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const utc = (date: string) => new Date(`${date}T00:00:00Z`);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The Monday of `date`'s ISO week, as YYYY-MM-DD. */
export function isoWeekMonday(date: string): string {
  const d = utc(date);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

/** The first day of `date`'s calendar month, as YYYY-MM-DD. */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** "Fri 2 Oct 2026". */
export function dateWords(date: string): string {
  const d = utc(date);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "28 Sep": a column's short start date. */
export function shortDate(date: string): string {
  const d = utc(date);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Closed daily candles, oldest first: a dated, finite close, never the "today so far" bar. */
export function closedBars(bars: readonly KeyBar[] | null | undefined): KeyBar[] {
  return (bars ?? [])
    .filter((b) => b && !b.partial && typeof b.date === "string" && ISO_DATE.test(b.date) && finite(b.close))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * The bars a "now" reading uses: completed sessions, plus today's partial bar
 * when `nowMs` (the page's render time) is in session and the bar is today's.
 * Without `nowMs`, completed sessions only.
 */
export function sessionBars(bars: readonly KeyBar[] | null | undefined, nowMs?: number): { bars: KeyBar[]; time: string | null; live: boolean; phase: "session" | "afterClose" | null } {
  if (nowMs === undefined) return { bars: closedBars(bars), time: null, live: false, phase: null };
  const l = liveBars(bars ?? [], nowMs);
  const valid = l.bars.filter((b) => b && typeof b.date === "string" && ISO_DATE.test(b.date) && finite(b.close))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const live = !!l.live && valid[valid.length - 1] === l.live;
  return { bars: valid, time: l.time, live, phase: live ? l.phase : null };
}

const none = (reason: string): Level => ({ value: null, reason });

/** O/H/L/C over `span` (the period's bars, oldest first), each with its reason if absent. */
function levelsOver(key: PeriodKey, span: readonly KeyBar[]): Record<LevelField, Level> {
  const first = span[0], last = span[span.length - 1];
  const extreme = (field: "high" | "low"): Level => {
    const vals = span.map((b) => b[field]);
    if (!vals.every(finite)) return none(fieldMissingReason(key, field));
    return { value: field === "high" ? Math.max(...vals) : Math.min(...vals), reason: null };
  };
  return {
    open: finite(first.open) ? { value: first.open, reason: null } : none(fieldMissingReason(key, "open")),
    high: extreme("high"),
    low: extreme("low"),
    close: { value: last.close, reason: null },
  };
}

const withheld = (key: PeriodKey, reason: string): PeriodLevels => ({
  key,
  from: null,
  levels: { open: none(reason), high: none(reason), low: none(reason), close: none(reason) },
  reason,
  prevClose: null,
  prevReason: reason,
});

/** The close of the bar just before index `i`, or null. */
const prevOf = (bars: readonly KeyBar[], i: number) => (i > 0 ? { value: bars[i - 1].close, date: bars[i - 1].date } : null);

/** The period that starts on `start`: withheld unless a bar before it proves its first session is on file. */
function periodFrom(key: Exclude<PeriodKey, "day">, bars: readonly KeyBar[], start: string): PeriodLevels {
  const firstIn = bars.findIndex((b) => b.date >= start);
  if (firstIn <= 0) return withheld(key, SHORT_REASON[key]);
  const span = bars.slice(firstIn);
  // firstIn > 0 here, so the prior period's final session is on file.
  return { key, from: span[0].date, levels: levelsOver(key, span), reason: null, prevClose: prevOf(bars, firstIn), prevReason: null };
}

/** The day's, this week's and this month's levels from the latest closed candle. */
export function keyLevels(bars: readonly KeyBar[] | null | undefined, opts: { nowMs?: number } = {}): KeyLevels {
  const sess = sessionBars(bars, opts.nowMs);
  const closed = sess.bars;
  if (!closed.length) {
    return {
      asOf: null,
      asOfWords: null,
      lastClose: null,
      periods: (["day", "week", "month"] as const).map((k) => withheld(k, NO_BARS_REASON)),
      reasons: [NO_BARS_REASON],
      live: null,
    };
  }
  const last = closed[closed.length - 1];
  const periods: PeriodLevels[] = [
    { key: "day", from: last.date, levels: levelsOver("day", [last]), reason: null, prevClose: prevOf(closed, closed.length - 1), prevReason: closed.length > 1 ? null : PREV_MISSING.day },
    periodFrom("week", closed, isoWeekMonday(last.date)),
    periodFrom("month", closed, monthStart(last.date)),
  ];
  const reasons: string[] = [];
  for (const p of periods) {
    if (p.reason) { reasons.push(p.reason); continue; }
    for (const f of LEVEL_FIELDS) {
      const r = p.levels[f].reason;
      if (r && !reasons.includes(r)) reasons.push(r);
    }
  }
  return { asOf: last.date, asOfWords: dateWords(last.date), lastClose: last.close, periods, reasons, live: sess.live ? { time: sess.time, phase: sess.phase ?? "session" } : null };
}

/** "2.1% above", "0.4% below", or "at the last price". */
export function distanceWords(level: number, reference: number): string | null {
  if (!finite(level) || !finite(reference) || reference <= 0) return null;
  const pct = ((level - reference) / reference) * 100;
  const shown = Math.round(Math.abs(pct) * 10) / 10;
  if (shown < AT_PRICE_BELOW_PCT) return "at the last price";
  return `${shown.toFixed(1)}% ${pct > 0 ? "above" : "below"}`;
}

/** Prices from this up print whole dollars ("$24,240"), so a cell holds them at 320 px. */
export const WHOLE_DOLLARS_FROM = 10_000;

/** A price for the card: "$1,234.56"; under $1, four decimals; from $10,000, whole dollars. */
export function priceWords(v: number): string {
  const dp = Math.abs(v) < 1 ? 4 : Math.abs(v) >= WHOLE_DOLLARS_FROM ? 0 : 2;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}
