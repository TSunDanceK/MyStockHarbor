// ONE PRICE, WITH WHAT IT IS, FOR THE STEP 6 SURFACES (#563 COWORK #30/#31).
//
// The video pages' stat boxes and the news page's Last Price tile (plus the
// price in that page's title) each show a single "current" price. On Tiingo
// that is one of two different things, and the label says which (#553 COWORK
// #56):
//
//   the last IEX trade   the pool row, while the day's EOD bar has not landed:
//                        "last IEX trade, 14:05 ET". IEX is one venue, so it
//                        can differ slightly from the consolidated price.
//   the EOD close        the stored history's newest bar, once it is at least
//                        as new as the IEX trade: "close, 29 Sep 2026".
//
// NOT A SESSION-CLOCK RULE, deliberately. "Market open -> IEX, closed -> EOD"
// would, between the 16:00 ET close and the nightly EOD job (~00:45 UTC), show
// yesterday's close under today's IEX trade. Comparing the two dates instead
// always shows the newer of the two, and names it.
//
// READS ONLY, THROUGH B'S ADAPTER (read.ts). No Tiingo call from here: the pool
// is one cached blob shared with every other surface, the history one cached
// entry per symbol (#553 COWORK #56 §3).
import { readTiingoHistory, readTiingoPool } from "./marketData/read";
import type { EodBar, StoredQuote } from "./marketData/types";
import { toDashed } from "../symbolSpellings.mjs";

/** The contract's credit, linked on each switched figure (#563 COWORK #31 §5). */
export const TIINGO_CREDIT = "Market data from Tiingo.com";
export const TIINGO_URL = "https://www.tiingo.com/";

export type SurfacePrice = {
  price: number;
  /** "last IEX trade, 14:05 ET" | "last IEX trade, 15:59 ET, 29 Sep" | "close, 29 Sep 2026" */
  label: string;
  kind: "iex" | "close";
  /** The ET trading date the price belongs to, YYYY-MM-DD. */
  date: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** YYYY-MM-DD and HH:MM for an instant, in New York time. */
export function easternDateTime(ms: number): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(ms)).map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function dayMonth(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

/**
 * Pure: the newer of the pool row and the newest EOD bar, labelled. Null when
 * neither is usable -- the caller then keeps its FMP path, never a zero.
 */
export function pickSurfacePrice(
  row: StoredQuote | null | undefined,
  bars: EodBar[] | null | undefined,
  nowMs: number
): SurfacePrice | null {
  const last = bars?.length ? bars[bars.length - 1] : null;
  const close = last && Number.isFinite(last[4]) && last[4] > 0 ? { date: last[0], price: last[4] } : null;
  const iex =
    row && Number.isFinite(row.price) && row.price > 0 && Number.isFinite(row.at) && row.at > 0
      ? { ...easternDateTime(row.at), price: row.price }
      : null;

  // The close wins a tie: same trading day, and it is the consolidated figure.
  if (close && (!iex || close.date >= iex.date)) {
    return { price: close.price, kind: "close", date: close.date, label: `close, ${dayMonth(close.date)} ${close.date.slice(0, 4)}` };
  }
  if (iex) {
    const today = easternDateTime(nowMs).date;
    return {
      price: iex.price,
      kind: "iex",
      date: iex.date,
      label: `last IEX trade, ${iex.time} ET${iex.date === today ? "" : `, ${dayMonth(iex.date)}`}`,
    };
  }
  return null;
}

/** The pool row and the history for one symbol, from the Data Cache. Never throws. */
export async function readSurfaceInputs(symbol: string): Promise<{ row: StoredQuote | null; bars: EodBar[] | null }> {
  const sym = toDashed(symbol.trim().toUpperCase());
  const [pool, eod] = await Promise.all([
    readTiingoPool().catch(() => null),
    readTiingoHistory(sym).catch(() => null),
  ]);
  return { row: pool?.rows[sym] ?? null, bars: eod?.bars ?? null };
}

/** readSurfaceInputs + pickSurfacePrice. */
export async function readSurfacePrice(symbol: string, nowMs = Date.now()): Promise<SurfacePrice | null> {
  const { row, bars } = await readSurfaceInputs(symbol);
  return pickSurfacePrice(row, bars, nowMs);
}
