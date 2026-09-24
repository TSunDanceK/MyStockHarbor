// "Sector today" outside market hours: the last session's move, labelled as
// such (Relay B, #553 COWORK #12). Pure time logic, separate from sectorPanels
// so it loads in bare Node for scripts/check-sector-last-session.mjs.
import { getEasternParts, isRegularSessionOpen, isWeekendEastern, REGULAR_CLOSE_MINUTES_ET } from "./marketHours";

export type DayBasis = "live" | "last-session";

// --- "Last session" (#553 COWORK #12) --------------------------------------
//
// THE BUG: outside the regular session no quote is under the 30-minute age gate,
// so every sector's `day` was null and all 11 cards read "--" / "Ranking
// unavailable" from the close until the next open -- most of the day.
//
// THE FIX, NO PROVIDER CODE: outside the session, a quote counts if it was
// taken in the last session's final maxAgeMs or any time since. Its %
// change is then that session's move (the pool is refreshed through the close;
// pre-market re-fetches still carry the prior session's change), and the page
// says "Last session" with the date instead of "today". Friday's provider
// split decides the lasting answer (Tiingo EOD vs IEX intraday).
//
// HOLIDAYS ARE NOT KNOWN, as in marketHours.ts: on a market holiday the label
// names the holiday's date while the move is the prior session's. Roughly nine
// days a year; a hand-kept calendar that goes wrong silently is worse.

/** Eastern calendar date (yyyy-mm-dd) of an instant. */
export function easternDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/** The weekday session whose close most recently passed, as an Eastern date. */
export function lastSessionDate(nowMs: number): string {
  const { weekday, minutesOfDay } = getEasternParts(new Date(nowMs));
  let date = easternDate(nowMs);
  if (!isWeekendEastern(weekday) && minutesOfDay >= REGULAR_CLOSE_MINUTES_ET) return date;
  for (let i = 0; i < 7; i++) {
    const [y, m, d] = date.split("-").map(Number);
    const prev = new Date(Date.UTC(y, m - 1, d) - 86_400_000);
    date = prev.toISOString().slice(0, 10);
    const dow = prev.getUTCDay();
    if (dow !== 0 && dow !== 6) return date;
  }
  return date;
}

/** Epoch ms of 16:00 New York time on an Eastern date, in either season. */
export function easternCloseMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  // 20:00 UTC is 16:00 EDT or 15:00 EST; correct by what New York reads.
  const guess = Date.UTC(y, m - 1, d, 20, 0);
  const { minutesOfDay } = getEasternParts(new Date(guess));
  return guess + (REGULAR_CLOSE_MINUTES_ET - minutesOfDay) * 60_000;
}

/** Which quotes may speak for `day` at `nowMs`, and what the page must call it. */
export function dayWindow(nowMs: number, maxAgeMs: number): { basis: DayBasis; sessionDate: string | null; counts: (quoteTs: number) => boolean } {
  if (isRegularSessionOpen(new Date(nowMs))) {
    return { basis: "live", sessionDate: null, counts: (ts) => nowMs - ts <= maxAgeMs };
  }
  const sessionDate = lastSessionDate(nowMs);
  const from = easternCloseMs(sessionDate) - maxAgeMs;
  return { basis: "last-session", sessionDate, counts: (ts) => ts >= from && ts <= nowMs };
}

/** "Wed 23 Sep" for a yyyy-mm-dd Eastern date. */
export function sessionDateLabel(date: string | null | undefined): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  // Built from parts: en-GB writes "Sept", and ICU versions differ on commas.
  const when = new Date(Date.UTC(y, m - 1, d));
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${WEEKDAYS[when.getUTCDay()]} ${when.getUTCDate()} ${MONTHS[when.getUTCMonth()]}`;
}
