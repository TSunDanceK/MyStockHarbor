// Dates rendered on the server AND the client (Relay B, #553 COWORK #45).
//
// React error #418 on /dashboard: the server renders in UTC with its own
// locale, the browser re-renders in the viewer's zone and locale, and any date
// text that differs fails hydration. Worse, a date-only string such as
// "2026-06-08" parses as UTC midnight, so reading it back with getDate() in a
// zone west of UTC gives the PREVIOUS day (the Basic chart's axis said 06/07).
//
// Everything here reads UTC fields and formats by hand, never through
// toLocale*(), so the server and every browser produce the same text.
//
// Pure: scripts/check-utc-date.mjs runs it.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function parse(input: string | number | Date): Date | null {
  const d = input instanceof Date ? input : new Date(input);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** "06/08": a bar's month/day, as the Basic chart's axis shows it. */
export function utcMonthDay(input: string | number | Date): string | null {
  const d = parse(input);
  return d ? `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}` : null;
}

/** "8 Jun 2026": a calendar date. */
export function utcDay(input: string | number | Date): string | null {
  const d = parse(input);
  return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : null;
}

/** "8 Jun 2026, 14:05 UTC": a moment, labelled as UTC so no reader mistakes it for local time. */
export function utcStamp(input: string | number | Date): string | null {
  const d = parse(input);
  return d ? `${utcDay(d)}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC` : null;
}
