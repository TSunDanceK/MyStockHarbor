// THE STOCK PAGE'S PERFORMANCE STRIP (#563 COWORK #69): the price change over
// 1M · 3M · YTD · 1Y · 3Y · 5Y, each beside the S&P 500's over the same dates.
// Pure arithmetic over daily closes the page already reads; plain data out, so
// the client component gets derived percentages only, never bars.
//
// THE DATES (COWORK #69):
//   rolling   the latest close against the close on the same calendar date
//             1 or 3 months, or 1, 3 or 5 years earlier (a 31st with no 31st
//             in that month takes its last day); a date that wasn't a trading
//             day takes the NEAREST TRADING DAY BEFORE IT
//   YTD       against the last close of the previous calendar year
// THE END IS THE LATEST PRICE (owner ruling, #563 COWORK #75/#76; replaces
// #69's "closed candles only"): in session, today's partial bar (Tiingo's
// "today so far (IEX), hh:mm ET", already on the page) is the end, labelled
// "to the last price, 14:32 ET"; otherwise the last completed session, "to the
// close on Fri 2 Oct 2026". lib/ta/sessionBar.ts decides from the page's render
// time; a stale partial, weekends and holidays read the last close. The START
// of every period is always a completed close. SPY must end on the same day.
//
// NEVER ESTIMATED. A period whose start is before the prices on file, or whose
// nearest earlier close is more than a week from the date (a gap in the
// series), shows "—" with its reason. The S&P 500 is SPY's closes on the SAME
// two dates; without them the second line says why instead.
//
// PRICE ONLY: the closes are split-adjusted, not dividend-adjusted, for the
// stock and for SPY alike. The note says so.
import { dateWords, type KeyBar } from "./keyLevels";
import { liveBars } from "./sessionBar";

export type PerfKey = "1M" | "3M" | "YTD" | "1Y" | "3Y" | "5Y";
export const PERF_PERIODS: readonly { key: PerfKey; months?: number; ytd?: true }[] = [
  { key: "1M", months: 1 },
  { key: "3M", months: 3 },
  { key: "YTD", ytd: true },
  { key: "1Y", months: 12 },
  { key: "3Y", months: 36 },
  { key: "5Y", months: 60 },
];
/** The nearest earlier close may be at most this many days before the date asked for. */
export const MAX_GAP_DAYS = 7;
/** Within ±this many percentage points, the stock is "level with" the S&P 500. */
export const LEVEL_WITH_PTS = 0.05;

export type PerfChip = {
  key: PerfKey;
  /** The % change, or null with `reason`. */
  pct: number | null;
  reason: string | null;
  from: { date: string; close: number } | null;
  /** The S&P 500 (SPY) over the same dates, or null with `spyReason`. */
  spyPct: number | null;
  spyReason: string | null;
  /** stock % − SPY %, in percentage points. */
  diffPts: number | null;
  /** The tap note. */
  note: string;
};
export type PerfStrip = {
  asOf: string | null;
  asOfWords: string | null;
  end: number | null;
  /** Set when the end is today's IEX bar: its own "hh:mm" (ET), and whether the session is still running (#77). */
  live: { time: string | null; phase: "session" | "afterClose" } | null;
  /** False on a page that is itself the S&P 500 (#563 COWORK #90): no second line against it. */
  benchmark: boolean;
  chips: PerfChip[];
};

/** Dated, finite, oldest first; today's partial bar kept only when in session (sessionBar.ts). */
function usable(bars: readonly KeyBar[] | null | undefined, nowMs: number | undefined): { bars: KeyBar[]; time: string | null; live: boolean; phase: "session" | "afterClose" | null } {
  const l = nowMs === undefined ? { bars: (bars ?? []).filter((b) => !b.partial), live: null, time: null, phase: null } : liveBars(bars ?? [], nowMs);
  const out = l.bars.filter((b) => b && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && typeof b.close === "number" && Number.isFinite(b.close))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const live = !!l.live && out[out.length - 1] === l.live;
  return { bars: out, time: l.time, live, phase: live ? l.phase : null };
}

const DAY = 86_400_000;
const atUtc = (d: string) => new Date(`${d}T00:00:00Z`);

/** `date` moved back `months` calendar months, clamped to the target month's last day. */
export function monthsBefore(date: string, months: number): string {
  const d = atUtc(date);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() - months, day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last))).toISOString().slice(0, 10);
}

/** The close on `date`, or the nearest trading day before it (within MAX_GAP_DAYS); null otherwise. */
export function closeOnOrBefore(bars: readonly KeyBar[], date: string): { date: string; close: number } | null {
  let hit: KeyBar | null = null;
  for (const b of bars) { if (b.date <= date) hit = b; else break; }
  if (!hit) return null;
  if ((atUtc(date).getTime() - atUtc(hit.date).getTime()) / DAY > MAX_GAP_DAYS) return null;
  return { date: hit.date, close: hit.close };
}

const pctChange = (from: number, to: number) => (from > 0 ? ((to - from) / from) * 100 : null);

/** "+12.3%", "−4.0%". */
export function pctWords(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
}
/** "8.2 pts ahead of the S&P 500", "behind", "level with". */
export function spyWords(diff: number): string {
  const d = Math.round(Math.abs(diff) * 10) / 10;
  if (d < LEVEL_WITH_PTS) return "level with the S&P 500";
  return `${d.toFixed(1)} pts ${diff > 0 ? "ahead of" : "behind"} the S&P 500`;
}
const money = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const PRICE_ONLY = "Price change only; dividends are not included. Past performance, not a forecast.";

/** The strip, from the stock's daily bars and SPY's. */
export function performanceStrip(bars: readonly KeyBar[] | null | undefined, spyBars: readonly KeyBar[] | null | undefined, nowMs?: number, opts: { benchmark?: boolean } = {}): PerfStrip {
  const benchmark = opts.benchmark !== false;
  const u = usable(bars, nowMs);
  const s = u.bars;
  const spy = usable(spyBars, nowMs).bars;
  if (!s.length) return { asOf: null, asOfWords: null, end: null, live: null, benchmark, chips: [] };
  const last = s[s.length - 1];
  // SPY ON THE SAME END DAY: a stock's today-so-far is never set against SPY's yesterday.
  const spyEndAny = closeOnOrBefore(spy, last.date);
  const spyEnd = spyEndAny && spyEndAny.date === last.date ? spyEndAny : null;
  // In session "last price, 14:32 ET"; after the close, before the nightly job, "close, 16:00 ET (IEX)" (#77).
  const endWords = u.live
    ? u.phase === "afterClose" ? `close, ${u.time ? `${u.time} ET` : "today"} (IEX)` : `last price, ${u.time ? `${u.time} ET` : "today"}`
    : `close, ${dateWords(last.date)}`;
  const first = s[0].date;
  const chips = PERF_PERIODS.map((p): PerfChip => {
    const target = p.ytd ? `${Number(last.date.slice(0, 4)) - 1}-12-31` : monthsBefore(last.date, p.months!);
    const from = closeOnOrBefore(s, target);
    const empty = (reason: string): PerfChip => ({ key: p.key, pct: null, reason, from: null, spyPct: null, spyReason: null, diffPts: null, note: reason });
    if (!from) {
      return empty(first > target
        ? `Prices on file start ${dateWords(first)}, after the start of this period (${dateWords(target)}).`
        : `No close on file within a week before ${dateWords(target)}.`);
    }
    const pct = pctChange(from.close, last.close);
    if (pct === null) return empty("The starting close isn't a usable price.");
    if (!benchmark) {
      const head = `From ${money(from.close)} (close, ${dateWords(from.date)}) to ${money(last.close)} (${endWords}): ${pctWords(pct)}.`;
      return { key: p.key, pct, reason: null, from, spyPct: null, spyReason: null, diffPts: null, note: `${head} ${PRICE_ONLY}` };
    }
    const spyFrom = closeOnOrBefore(spy, from.date);
    const spyPct = spyFrom && spyEnd ? pctChange(spyFrom.close, spyEnd.close) : null;
    const spyReason = spyPct === null ? (spyEndAny && !spyEnd ? "The S&P 500 (SPY) has no price for the same day on file yet." : "The S&P 500 (SPY) closes for these dates aren't on file.") : null;
    const diffPts = spyPct === null ? null : pct - spyPct;
    const head = `From ${money(from.close)} (close, ${dateWords(from.date)}) to ${money(last.close)} (${endWords}): ${pctWords(pct)}.`;
    const vs = spyPct !== null && diffPts !== null
      ? ` The S&P 500 (SPY) moved ${pctWords(spyPct)} over the same dates: ${spyWords(diffPts)}.`
      : ` ${spyReason}`;
    return { key: p.key, pct, reason: null, from, spyPct, spyReason, diffPts, note: `${head}${vs} ${PRICE_ONLY}` };
  });
  return { asOf: last.date, asOfWords: dateWords(last.date), end: last.close, live: u.live ? { time: u.time, phase: u.phase ?? "session" } : null, benchmark, chips };
}
