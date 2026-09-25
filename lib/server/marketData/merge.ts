// TODAY SO FAR: cached daily history + the hourly pool row (#553 COWORK #57 §2).
//
// Daily bars change once a day, so history is written only by the nightly job.
// "Up to date by the hour" is today's partial bar, built at READ time from the
// one pool row the hourly quote job already wrote -- no extra history read or
// write for hourly freshness.
//
// The partial bar is labelled, because an IEX price is one venue's last trade,
// not the consolidated price, and its high/low are IEX's too (COWORK #56,
// labels). Volume is left out: volume stays EOD-only (COWORK #53).
import type { EodBar } from "./types";

export type PoolQuote = { price: number; open: number | null; high: number | null; low: number | null; at: number };

export type TodayBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  partial: true;
  /** "today so far (IEX), hh:mm ET" */
  label: string;
};

function easternParts(ms: number) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hhmm: `${get("hour")}:${get("minute")}` };
}

/**
 * The partial bar for `quote`, or null when the quote is not newer than the
 * last stored bar (after the close the nightly consolidated bar replaces it).
 */
export function todaySoFar(bars: readonly EodBar[], quote: PoolQuote | null | undefined): TodayBar | null {
  if (!quote || !(quote.price > 0) || !Number.isFinite(quote.at)) return null;
  const { date, hhmm } = easternParts(quote.at);
  const last = bars.length ? bars[bars.length - 1][0] : "";
  if (date <= last) return null;
  const open = quote.open ?? quote.price;
  const high = Math.max(quote.high ?? quote.price, quote.price, open);
  const low = Math.min(quote.low ?? quote.price, quote.price, open);
  return { date, open, high, low, close: quote.price, partial: true, label: `today so far (IEX), ${hhmm} ET` };
}
