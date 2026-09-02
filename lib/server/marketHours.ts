// Is the US market worth spending an FMP call on right now?
//
// WHY THIS IS A MODULE AND NOT AN `if`. warm-price-pool runs `*/5 * * * *`
// around the clock. Outside the session the last traded price IS the price, so
// roughly two thirds of its refreshes re-fetched a number that could not have
// moved. That waste is what pays for the 15-minute tier in priceTiers.ts: the
// same throughput concentrated into the hours when prices actually change.
//
// DERIVED, NOT TYPED OUT. The window is computed from the regular session in
// EASTERN LOCAL TIME plus explicit buffers, and the Eastern reading comes from
// Intl with timeZone: "America/New_York". It is deliberately never expressed as
// a UTC hour range, because the session is 13:30-20:00 UTC only while New York
// is on EDT; from November to March it is 14:30-21:00 UTC. A UTC constant is
// therefore wrong for about four months a year, and wrong in the direction that
// hurts most -- it would skip the first hour of trading, when prices move
// fastest, and keep refreshing for an hour after the close, when they cannot.
//
// This project has already paid for exactly that mistake once:
// getNextMondayOpenUtcMsFromEastern hardcoded `-05:00`, so for the ~8 months a
// year New York is on EDT it computed a "Monday open" an hour late and history
// stayed stale through the first hour of Monday's session (historyCache.ts:68,
// asserted in both seasons by scripts/check-history-ttl.mjs). Swapping one
// hardcoded offset for the other is not the fix; not having one is.
//
// THE BUFFERS ARE THE POINT OF THE SPLIT. Open and close are the facts about
// the exchange; the buffers are our choice about how far either side is worth
// paying for. Keeping them separate means the next person to widen the window
// changes a buffer rather than editing a number that is supposed to mean
// "09:30".

/**
 * Weekday and wall-clock time in New York, whatever offset it is currently on.
 *
 * Intl does the DST arithmetic. Nothing here may reintroduce a fixed offset.
 */
export function getEasternParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  // "24" is a real value here: en-US with hour12:false renders midnight as 24
  // rather than 00 on some ICU versions, which would put midnight AFTER the
  // close rather than before the open.
  const rawHour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");

  return { weekday, hour, minute, minutesOfDay: hour * 60 + minute };
}

export function isWeekendEastern(weekday: string) {
  return weekday === "Sat" || weekday === "Sun";
}

// The US regular session, in Eastern local minutes-of-day. Facts about the
// exchange, not tuning knobs.
export const REGULAR_OPEN_MINUTES_ET = 9 * 60 + 30; // 09:30 ET
export const REGULAR_CLOSE_MINUTES_ET = 16 * 60; // 16:00 ET

// How far either side of the session a refresh is still worth paying for. Our
// choice, not the exchange's.
//
// THE PRE-OPEN BUFFER IS SIZED BY THE ROLLOVER, NOT BY TASTE. Prices freeze
// overnight, so at the first run of the day EVERY symbol is past its TTL at
// once and the buffer's runs have to carry the entire universe. Whatever they
// do not reach opens the session still showing yesterday's percentage change --
// computed against the wrong previous close, plausible-looking, and wrong for
// the rest of the day. So the buffer has to satisfy:
//
//   (buffer / cron period) x PRICE_MAX_PER_RUN  >=  universe
//
// At the */5 cron and PRICE_MAX_PER_RUN of 220 that is 18 runs x 220 = 3,960
// against the 3,000 symbols this design was costed at. 60 minutes gave 2,640
// and would have left ~360 symbols mid-rollover at the bell; that was found by
// scripts/check-price-tiers.mjs, not by reasoning, which is the reason the
// assertion is arithmetic over the real constants rather than prose.
//
// 08:00 ET is also a real market: pre-market trading opens at 04:00, so these
// are quotes that move rather than a repeat of the close. The extra runs are
// not waste even in the years the universe is small enough not to need them.
//
// The post-close buffer has no such constraint -- nothing has to be ready by a
// deadline after the close -- so an hour to cover the settle, and to let a run
// that started at 15:59 finish, is enough.
export const PRE_OPEN_BUFFER_MINUTES = 90;
export const POST_CLOSE_BUFFER_MINUTES = 60;

export const ACTIVE_WINDOW_START_MINUTES_ET =
  REGULAR_OPEN_MINUTES_ET - PRE_OPEN_BUFFER_MINUTES;
export const ACTIVE_WINDOW_END_MINUTES_ET =
  REGULAR_CLOSE_MINUTES_ET + POST_CLOSE_BUFFER_MINUTES;

/**
 * Is `date` inside the buffered US trading window on a weekday?
 *
 * MARKET HOLIDAYS ARE NOT EXCLUDED, and that is a deliberate limitation rather
 * than an oversight. This codebase has no holiday calendar -- historyCache
 * absorbs holidays with a slack threshold instead of enumerating them
 * (historyCache.ts:467) -- and inventing one here would mean maintaining a list
 * that goes wrong silently the year it is not updated. The cost of the omission
 * is one wasted day of refreshes per holiday, roughly nine days a year against
 * the ~250 this gates. The cost of a wrong holiday list is skipping a real
 * trading session, which is strictly worse.
 */
export function isActiveMarketWindow(date = new Date()): boolean {
  const { weekday, minutesOfDay } = getEasternParts(date);
  if (isWeekendEastern(weekday)) return false;
  return (
    minutesOfDay >= ACTIVE_WINDOW_START_MINUTES_ET &&
    minutesOfDay <= ACTIVE_WINDOW_END_MINUTES_ET
  );
}

/**
 * Is the regular session itself running (no buffers)?
 *
 * Separate from isActiveMarketWindow because they answer different questions.
 * The buffered window asks "is a refresh worth paying for"; this asks "is the
 * number on screen a live quote or a close" -- which is what a reader needs to
 * be told, and the buffers would make that claim wrong for an hour either side.
 */
export function isRegularSessionOpen(date = new Date()): boolean {
  const { weekday, minutesOfDay } = getEasternParts(date);
  if (isWeekendEastern(weekday)) return false;
  return (
    minutesOfDay >= REGULAR_OPEN_MINUTES_ET &&
    minutesOfDay < REGULAR_CLOSE_MINUTES_ET
  );
}
