// CLOSE-OVER-CLOSE RETURNS FOR THE STOCK PAGE'S PRICE ACTION CARD
// (#552 COWORK #89 Daily | Weekly; #553 COWORK #115 Monthly).
//
// PURE: daily bars in, ReturnBar[] out. The page already holds the bars (the
// same stored series the chart draws), so nothing here fetches or caches, and
// no new public JSON exists for it.
//
// THE LABELS NAME THE END OF EACH PERIOD (#553 COWORK #114/#115). The weekly
// axis used to read "Jul 13 ... Sep 28": the MONDAY of each week, which reads
// as the week's start date while the bar is its last close. Now:
//   daily    "2 Oct"           the session's date
//   weekly   "week to 2 Oct"   the week's last session
//   monthly  "Sep 2026"        the calendar month; its bar is the month's last close
//
// THE CURRENT MONTH IS INCOMPLETE. monthlyReturnBars returns the complete months
// and, separately, the month in progress ("Oct so far"), so the card can leave
// it out (with a line saying so) or show it marked, never as a full month.
import type { ReturnBar } from "@/app/components/ReturnsBarChart";

export type ClosePoint = { date: string; close: number };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const validIso = (s: string) => /^\d{4}-\d{2}-\d{2}/.test(s);

/** "2026-10-02" -> "2 Oct". */
export function dayLabel(iso: string): string {
  if (!validIso(iso)) return iso;
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
}

/** "2026-09" -> "Sep 2026". */
export function monthLabel(ym: string): string {
  return `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}

/** "2026-10" -> "October". */
export function monthName(ym: string): string {
  return MONTHS_LONG[Number(ym.slice(5, 7)) - 1] ?? ym;
}

/** The ISO date of the last weekday (Mon-Fri) of a "YYYY-MM" month. Holidays are not known here. */
export function lastWeekdayOf(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const d = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day of this one
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the ISO week holding `iso` (the week key). */
function mondayOf(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

type Period = { key: string; end: string; close: number };

/** Ascending points -> one entry per period: its key, its last session's date and close. */
export function periodCloses(points: readonly ClosePoint[], keyOf: (iso: string) => string): Period[] {
  const out: Period[] = [];
  for (const p of points) {
    if (!p || !validIso(p.date) || !(Number.isFinite(p.close) && p.close > 0)) continue;
    const key = keyOf(p.date);
    const last = out[out.length - 1];
    if (last && last.key === key) { last.end = p.date.slice(0, 10); last.close = p.close; }
    else out.push({ key, end: p.date.slice(0, 10), close: p.close });
  }
  return out;
}

/** The last `count` close-over-close changes of a period series, labelled. */
function returnsOf(periods: readonly Period[], count: number, label: (p: Period) => string): ReturnBar[] {
  const bars: ReturnBar[] = [];
  for (let i = Math.max(1, periods.length - count); i < periods.length; i++) {
    const prev = periods[i - 1].close;
    bars.push({ date: periods[i].end, label: label(periods[i]), changePercent: ((periods[i].close - prev) / prev) * 100 });
  }
  return bars;
}

/** Each session's close vs the previous session's: the last `count`. */
export function dailyReturnBars(points: readonly ClosePoint[], count: number): ReturnBar[] {
  return returnsOf(periodCloses(points, (d) => d.slice(0, 10)), count, (p) => dayLabel(p.end));
}

/** Each week's last close vs the previous week's: the last `count`, labelled "week to <last session>". */
export function weeklyReturnBars(points: readonly ClosePoint[], count: number): ReturnBar[] {
  return returnsOf(periodCloses(points, mondayOf), count, (p) => `week to ${dayLabel(p.end)}`);
}

export type MonthlyReturns = {
  /** Complete calendar months, the last `count`. */
  complete: ReturnBar[];
  /** The month in progress vs the last complete month's close, or null when the latest month is complete. */
  partial: ReturnBar | null;
  /** "October" for the month in progress, else null. */
  partialMonth: string | null;
};

/**
 * Each calendar month's last close vs the previous month's. The latest month is
 * IN PROGRESS when its last session falls before the month's last weekday (a
 * month-end holiday can make a complete month look in progress for that day;
 * it then reads "so far", which errs toward not overstating).
 */
export function monthlyReturnBars(points: readonly ClosePoint[], count: number): MonthlyReturns {
  const months = periodCloses(points, (d) => d.slice(0, 7));
  const last = months[months.length - 1];
  const inProgress = !!last && last.end < lastWeekdayOf(last.key);
  const complete = inProgress ? months.slice(0, -1) : months;
  const bars = returnsOf(complete, count, (p) => monthLabel(p.key));
  if (!inProgress || complete.length < 1) return { complete: bars, partial: null, partialMonth: null };
  const prev = complete[complete.length - 1].close;
  return {
    complete: bars,
    partial: {
      date: last.end,
      label: `${MONTHS[Number(last.key.slice(5, 7)) - 1]} so far`,
      changePercent: ((last.close - prev) / prev) * 100,
      partial: true,
    },
    partialMonth: monthName(last.key),
  };
}
