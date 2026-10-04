// TODAY'S PARTIAL BAR, ONLY WHEN IT IS REALLY TODAY'S SESSION (#563 COWORK
// #75/#76). On /stock/[symbol] a reading of "now" (the Key levels card, the
// performance strip, MACD) uses today's labelled partial bar during market
// hours, so it doesn't look a day behind. Out of session (weekends, market
// holidays, pre-market, after the close) everything reads off the last
// completed session.
//
// NEVER AN INVENTED BAR. The partial bar is the one already on the page:
// Tiingo's "today so far (IEX), hh:mm ET" from tiingoHistory.ts. This only
// decides whether to keep it, from three facts:
//   - it is the series' last bar and marked partial;
//   - its date is today's date in New York, at the page's render time;
//   - that render time is inside the regular session (Mon–Fri 09:30–16:00 ET).
// Anything else (a stale partial left from an earlier day, a weekend, a
// holiday with no new bar) is dropped, never patched.
//
// THE PAGE PASSES ITS OWN RENDER TIME, not the browser's clock, so the server
// HTML and the hydrated page always agree (the page is ISR-cached; its data is
// as old as its render anyway).

export const SESSION_OPEN = "09:30";
export const SESSION_CLOSE = "16:00";

type MaybePartial = { date: string; partial?: boolean; label?: string };

/** New York's date, hh:mm and weekday (0 = Sunday) at `ms`. */
export function easternNow(ms: number): { date: string; hhmm: string; weekday: number } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(new Date(ms));
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hhmm: `${get("hour")}:${get("minute")}`, weekday };
}

/** Inside the regular session at `ms`: a weekday between 09:30 and 16:00 New York time. */
export function inSession(ms: number): boolean {
  const { hhmm, weekday } = easternNow(ms);
  return weekday >= 1 && weekday <= 5 && hhmm >= SESSION_OPEN && hhmm < SESSION_CLOSE;
}

/**
 * The bars to read "now" from: every completed bar, plus the last bar when it
 * is today's in-session partial. `live` is that bar (or null), `time` its own
 * "hh:mm" from its label.
 */
export function liveBars<T extends MaybePartial>(bars: readonly T[] | null | undefined, nowMs: number): { bars: T[]; live: T | null; time: string | null } {
  const all = bars ?? [];
  const last = all[all.length - 1];
  const keep = !!last?.partial && Number.isFinite(nowMs) && inSession(nowMs) && last.date === easternNow(nowMs).date;
  const done = all.filter((b) => !b.partial);
  if (!keep) return { bars: done, live: null, time: null };
  const time = (/(\d{1,2}:\d{2}) ET/.exec(last.label ?? "") ?? [])[1] ?? null;
  return { bars: [...done, last], live: last, time };
}
