// US EQUITY MARKET TRADING DAYS (#552 COWORK #199/#200), pure and rule-based.
//
// NYSE's full-day closures, computed from their rules rather than listed, so
// the calendar never runs out: New Year's Day, Martin Luther King Jr. Day,
// Washington's Birthday, Good Friday, Memorial Day, Juneteenth (from 2022),
// Independence Day, Labor Day, Thanksgiving and Christmas. A holiday on a
// Saturday is observed the Friday before, on a Sunday the Monday after --
// EXCEPT New Year's Day on a Saturday, which NYSE does not move into the old
// year (2022: open on Fri 31 Dec 2021).
//
// NOT HERE, deliberately: unscheduled closures (a national day of mourning,
// 2018-12-05; Hurricane Sandy) cannot be computed in advance, and early
// closes are still trading days.
//
// marketHours.ts and lastSession.ts note "this codebase has no holiday
// calendar"; this one is used only to keep an estimated REPORT DAY off a day
// the market is shut. Those modules are left as they are.

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The n-th (1-based) given weekday (0 = Sunday) of a month; n = -1 is the last. */
function nthWeekday(y: number, m: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    return iso(y, m, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = new Date(Date.UTC(y, m - 1, lastDay)).getUTCDay();
  return iso(y, m, lastDay - ((last - weekday + 7) % 7));
}

/** Easter Sunday (Gregorian; anonymous algorithm). */
function easter(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

/** A fixed-date holiday moved to its observed weekday. */
function observed(d: string, newYears = false): string | null {
  const w = weekdayOf(d);
  if (w === 6) return newYears ? null : addDays(d, -1);
  if (w === 0) return addDays(d, 1);
  return d;
}

const cache = new Map<number, ReadonlySet<string>>();

/** NYSE full-day holidays observed in calendar year `y`. */
export function usMarketHolidays(y: number): ReadonlySet<string> {
  const hit = cache.get(y);
  if (hit) return hit;
  const days = [
    observed(iso(y, 1, 1), true),
    nthWeekday(y, 1, 1, 3),          // MLK Day: third Monday of January
    nthWeekday(y, 2, 1, 3),          // Washington's Birthday: third Monday of February
    addDays(easter(y), -2),          // Good Friday
    nthWeekday(y, 5, 1, -1),         // Memorial Day: last Monday of May
    y >= 2022 ? observed(iso(y, 6, 19)) : null,
    observed(iso(y, 7, 4)),
    nthWeekday(y, 9, 1, 1),          // Labor Day: first Monday of September
    nthWeekday(y, 11, 4, 4),         // Thanksgiving: fourth Thursday of November
    observed(iso(y, 12, 25)),
  ].filter((d): d is string => Boolean(d));
  const set = new Set(days);
  cache.set(y, set);
  return set;
}

export function isUsMarketHoliday(d: string): boolean {
  return usMarketHolidays(Number(d.slice(0, 4))).has(d);
}

/** Monday to Friday and not an NYSE holiday. */
export function isUsTradingDay(d: string): boolean {
  const w = weekdayOf(d);
  return w !== 0 && w !== 6 && !isUsMarketHoliday(d);
}

/** The first trading day strictly after (step 1) or before (step -1) `d`. */
export function nextUsTradingDay(d: string, step: 1 | -1 = 1): string {
  let x = addDays(d, step);
  while (!isUsTradingDay(x)) x = addDays(x, step);
  return x;
}

export { addDays as addCalendarDays, weekdayOf };
