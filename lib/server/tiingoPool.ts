// THE PRICE POOL ON TIINGO, MAPPED AT READ TIME (step 5, #553 COWORK #98 ruling 1).
//
// Behind PRICE_PROVIDER_POOL=tiingo, readPricePoolBulk hands every reader
// (Pickers, the sector pages, the earnings calendar, the warm jobs) a
// PricePoolRow built here from two Data Cache blobs:
//
//   readTiingoPool()      the IEX rows the quote job writes every 15 minutes
//   readTiingoEodLast()   each symbol's newest stored EOD bar and the close
//                         before it (marketData/eodLast.ts), written nightly
//
// WHAT EACH FIELD IS (COWORK #56 labels):
//   price, ts           the newer of the IEX trade and the stored close
//                       (pickSurfacePrice, so an IFNNY-shaped symbol whose IEX
//                       trade is a day old shows "close, <date>"); ts is the
//                       IEX sale time, or 16:00 ET of the close's day
//   open/dayHigh/dayLow the IEX row's while the price is IEX, the bar's once it
//                       is the close
//   changePct           from the stored consolidated close before the price's
//                       day; IEX's own prevClose only when no bar is stored
//   volume              the newest EOD bar's consolidated volume ONLY, labelled
//                       "as of last close". IEX volume is never day volume.
//   marketCap, pe       NOT COMPUTED HERE. Carried unchanged from the FMP row
//                       when one exists (null otherwise); each reader keeps its
//                       own SEC path (Pickers' cover-shares cap wins already).
//   peTs, failStreak,   the FMP row's own bookkeeping, carried, so the warm
//   failAt              jobs' rotation and eviction rules read what they did.
//
// COST: no per-symbol read. Both blobs are ONE Data Cache entry each (1
// HGETALL per miss: hourly for the pool, nightly for the bars), shared by
// every reader and region. The FMP HMGET readPricePoolBulk already did stays.
//
// NEVER WRITTEN BACK. These rows exist only in the reader's memory; the pool
// hash's own writers read raw (contract §7: raw Tiingo data stays under
// msh:tiingo:, where the purge finds it).
import type { PricePoolRow } from "./pricePool";
import type { EodBar, StoredQuote } from "./marketData/types";
import type { EodLast } from "./marketData/eodLast";
import { pickSurfacePrice } from "./tiingoSurfacePrice";
import { readTiingoEodLast, readTiingoPool } from "./marketData/read";
import { easternCloseMs } from "./lastSession";
import { VOLUME_LABEL } from "./tiingoQuote";
import { toDashed } from "../symbolSpellings.mjs";

const pos = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * Pure. One symbol's row, or null when Tiingo has no usable price (the caller
 * then keeps the FMP row, COWORK #56).
 */
export function mapTiingoPoolRow(
  fmp: PricePoolRow | null | undefined,
  iex: StoredQuote | null | undefined,
  last: EodLast | null | undefined,
  nowMs: number
): PricePoolRow | null {
  const bars: EodBar[] = last ? [[last.d, last.o, last.h, last.l, last.c, last.v]] : [];
  const surface = pickSurfacePrice(iex ?? null, bars, nowMs);
  if (!surface) return null;
  const isIex = surface.kind === "iex";

  // The consolidated close the move is measured from: the stored close BEFORE
  // the price's own trading day.
  const base = isIex
    ? last && last.d < surface.date && pos(last.c)
      ? last.c
      : pos(iex?.prevClose)
        ? iex!.prevClose
        : null
    : pos(last?.pc)
      ? last!.pc
      : null;
  const volume = last && pos(last.v) ? last.v : null;
  const num = (n: number | null | undefined) => (pos(n) ? n : null);

  return {
    price: surface.price,
    changePct: base != null ? ((surface.price - base) / base) * 100 : null,
    volume,
    marketCap: fmp?.marketCap ?? null,
    open: num(isIex ? iex?.open : last?.o),
    dayHigh: num(isIex ? iex?.high : last?.h),
    dayLow: num(isIex ? iex?.low : last?.l),
    pe: fmp?.pe ?? null,
    ts: isIex ? iex!.at : easternCloseMs(surface.date),
    peTs: fmp?.peTs ?? 0,
    failStreak: fmp?.failStreak ?? 0,
    failAt: fmp?.failAt ?? 0,
    priceLabel: surface.label,
    volumeLabel: volume != null ? VOLUME_LABEL : null,
    source: "tiingo",
  };
}

/**
 * Pure. `fmpRows` as readPricePoolBulk built it (under the pool field and each
 * caller spelling); every requested symbol Tiingo can price is replaced, the
 * rest left as they were.
 */
export function overlayRows(
  fmpRows: Map<string, PricePoolRow>,
  symbols: string[],
  pool: Record<string, StoredQuote> | null,
  eodLast: Record<string, EodLast> | null,
  nowMs: number
): Map<string, PricePoolRow> {
  const out = new Map(fmpRows);
  if (!pool && !eodLast) return out;
  const mapped = new Map<string, PricePoolRow | null>();
  for (const raw of symbols) {
    const asked = String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
    if (!asked) continue;
    const field = toDashed(asked);
    if (!mapped.has(field)) {
      mapped.set(field, mapTiingoPoolRow(fmpRows.get(field), pool?.[field], eodLast?.[field], nowMs));
    }
    const row = mapped.get(field);
    if (!row) continue;
    out.set(field, row);
    out.set(asked, row);
  }
  return out;
}

/** The two Data Cache reads + overlayRows. Never throws; on a read failure the FMP rows stand. */
export async function overlayTiingoPool(
  fmpRows: Map<string, PricePoolRow>,
  symbols: string[],
  nowMs: number
): Promise<Map<string, PricePoolRow>> {
  const [pool, eodLast] = await Promise.all([
    readTiingoPool().catch(() => null),
    readTiingoEodLast().catch(() => null),
  ]);
  return overlayRows(fmpRows, symbols, pool?.rows ?? null, eodLast, nowMs);
}
