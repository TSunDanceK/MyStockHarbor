// THE CALENDAR'S NEXT TWO WEEK-WINDOWS, ONE SHARED ENTRY (#154 §2): the
// dashboard's earnings card and the insight page's "Earnings calendar" card
// read the same list, so neither pays for it twice.
//
//   getCalendarForwardSections   2 commands (the calendar's own forward read)
//   readPricePoolBulk            1 HMGET for the caps (the size order)
//
// Per refill, at most one per 15 minutes per Eastern day (the date is the key).
// A render reads the Data Cache: 0 commands. Null when the calendar has no
// listed rows, so each card shows its empty state.
import { unstable_cache } from "next/cache";
import { getCalendarForwardSections } from "@/lib/server/dueInputs";
import { readPricePoolBulk } from "@/lib/server/pricePool";
import { registrantFor } from "@/lib/server/stockProfile";
import { addDays, comingUpColumns, onePerCompany, type ComingUpColumn } from "@/lib/server/earningsWeek";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Tue 14 Oct" for a yyyy-mm-dd day. */
export const shortDay = (d: string) => { const t = new Date(`${d}T00:00:00Z`); return `${WEEKDAY[t.getUTCDay()]} ${t.getUTCDate()} ${MON[t.getUTCMonth()]}`; };

export type EarningsWeekItem = { symbol: string; estimatedOn: string; cap: number | null };

/** This week (when anything is estimated in it, else next week), then the one after; each largest first. */
async function loadComingUpWeeks(today: string): Promise<ComingUpColumn<EarningsWeekItem>[] | null> {
  const forward = await getCalendarForwardSections(today).catch(() => null);
  if (!forward || forward.expected.kind !== "listed") return null;
  const rows = forward.expected.rows;
  const pool = rows.length ? await readPricePoolBulk(rows.map((r) => r.symbol)).catch(() => new Map()) : new Map();
  const cikOf = (s: string) => registrantFor(s)?.cik ?? null;
  const list = onePerCompany(rows.map((r) => ({ symbol: r.symbol, estimatedOn: addDays(today, r.daysAway), cap: pool.get(r.symbol)?.marketCap ?? null })), cikOf);
  // TWO WINDOWS (#148 §5): this week (when anything is estimated in it, else
  // comingUpColumns starts at next week), then the one after.
  const windows = comingUpColumns(list, today).slice(0, 2);
  return windows.length ? windows : null;
}

/** Keyed by the Eastern date (yyyy-mm-dd), 15 minutes: the dashboard's own window. */
export const readComingUpWeeks = unstable_cache(loadComingUpWeeks, ["earnings-coming-up-weeks-v1"], { revalidate: 900, tags: ["earnings-coming-up-weeks"] });
