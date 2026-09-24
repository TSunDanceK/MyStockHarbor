// Dates on the Interactive chart (Relay B, #553 COWORK #42).
//
// Every bar on the chart is a day, a week or a month, stamped at UTC midnight.
// klinecharts formats times in the viewer's time zone and with a clock time by
// default, which showed "2026-08-13 01:00" in UK summer time -- and west of UTC
// would show the PREVIOUS day's date. So the chart formats every date itself:
// in UTC, and with no clock time anywhere (tooltip, crosshair label, axis).
//
// Pure: scripts/check-chart-date.mjs runs it.

/** klinecharts' FormatDateType: 0 tooltip, 1 crosshair label, 2 x-axis tick. */
export const DATE_TYPE = { tooltip: 0, crosshair: 1, xAxis: 2 } as const;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A bar's date for the chart. The tooltip and the crosshair label always show
 * the full date; an axis tick keeps its own granularity (YYYY, YYYY-MM, MM-DD)
 * but never a time -- a tick format asking for hours shows the date instead.
 */
export function formatBarDate(timestamp: number, format: string, type: number): string {
  const d = new Date(timestamp);
  const YYYY = String(d.getUTCFullYear());
  const MM = pad(d.getUTCMonth() + 1);
  const DD = pad(d.getUTCDate());
  if (type !== DATE_TYPE.xAxis) return `${YYYY}-${MM}-${DD}`;
  const f = /H|m{2}|s{2}/.test(format.replace(/MM/g, "")) ? (format.includes("YYYY") ? "YYYY-MM-DD" : "MM-DD") : format;
  return f.replace("YYYY", YYYY).replace("MM", MM).replace("DD", DD);
}
