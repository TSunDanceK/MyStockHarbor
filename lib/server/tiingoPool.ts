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
//   marketCap, pe       SEC x THIS ROW'S PRICE (#553 CODE-B #94 B8, #683 Q1):
//                       the pickers SEC hash's cover-page shares and twelve-
//                       month EPS through A's marketCap()/peRatio()
//                       (pickersSecFundamentals.secCapAndPe). A refusal, or a
//                       symbol the hash does not hold, is null ("—" on every
//                       reader). NEVER the FMP row's: that figure froze when FMP
//                       ended and sat unlabelled beside a Tiingo price.
//   peTs, failStreak,   the FMP row's own bookkeeping, carried, so the warm
//   failAt              jobs' rotation and eviction rules read what they did.
//
// COST: no per-symbol read. The three blobs are ONE Data Cache entry each (1
// HGETALL per miss: hourly for the pool, nightly for the bars, six-hourly for
// the SEC cap inputs), shared by every reader and region. The FMP HMGET
// readPricePoolBulk already did stays.
//
// NEVER WRITTEN BACK. These rows exist only in the reader's memory; the pool
// hash's own writers read raw (contract §7: raw Tiingo data stays under
// msh:tiingo:, where the purge finds it). So does the fundamentals warm: a SEC
// x Tiingo cap or P/E is Tiingo-derived (the close is cap / shares), so it is
// never persisted outside msh:tiingo: either -- the fundamentals rows get it at
// read time (overlaySecTiingoFundamentals; #553 COWORK #103, #690 Q2).
import type { PricePoolRow } from "./pricePool";
import type { EodBar, StoredQuote } from "./marketData/types";
import type { EodLast } from "./marketData/eodLast";
import { pickSurfacePrice } from "./tiingoSurfacePrice";
import { readTiingoEodLast, readTiingoPool } from "./marketData/read";
import { easternCloseMs } from "./lastSession";
import { VOLUME_LABEL } from "./tiingoQuote";
import { toDashed, toDotted } from "../symbolSpellings.mjs";
import { unstable_cache } from "next/cache";
import { loadSecCapRows, pickersSecKey, secCapAndPe, type SecCapRow } from "./pickersSecFundamentals";

/** The SEC inputs change once a day (warm-pickers-sec, 05:35 UTC); six hours bounds the lag. */
export const SEC_CAP_CACHE_SECONDS = 6 * 60 * 60;

/**
 * The pickers SEC hash, projected to cap/P/E inputs, from the Data Cache: 1
 * HGETALL per miss. Keyed by the hash name so a preview never serves
 * production's entry or the reverse.
 */
export const readSecCapRows = unstable_cache(loadSecCapRows, ["pool-sec-cap-v1", pickersSecKey()], {
  revalidate: SEC_CAP_CACHE_SECONDS,
});

/** A symbol's SEC row under the caller's spelling, the pool field, or the dotted form. */
function secRowFor(rows: Record<string, SecCapRow> | null, asked: string, field: string): SecCapRow | null {
  if (!rows) return null;
  return rows[asked] ?? rows[field] ?? rows[toDotted(field)] ?? null;
}

const pos = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * Pure. One symbol's row, or null when Tiingo has no usable price (the caller
 * then keeps the FMP row, COWORK #56).
 */
export function mapTiingoPoolRow(
  fmp: PricePoolRow | null | undefined,
  iex: StoredQuote | null | undefined,
  last: EodLast | null | undefined,
  nowMs: number,
  sec: SecCapRow | null = null
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
  const valuation = secCapAndPe(sec, surface.price);

  return {
    price: surface.price,
    changePct: base != null ? ((surface.price - base) / base) * 100 : null,
    volume,
    marketCap: valuation.marketCap,
    open: num(isIex ? iex?.open : last?.o),
    dayHigh: num(isIex ? iex?.high : last?.h),
    dayLow: num(isIex ? iex?.low : last?.l),
    pe: valuation.pe,
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
  nowMs: number,
  secRows: Record<string, SecCapRow> | null = null
): Map<string, PricePoolRow> {
  const out = new Map(fmpRows);
  if (!pool && !eodLast) return out;
  const mapped = new Map<string, PricePoolRow | null>();
  for (const raw of symbols) {
    const asked = String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
    if (!asked) continue;
    const field = toDashed(asked);
    if (!mapped.has(field)) {
      mapped.set(field, mapTiingoPoolRow(fmpRows.get(field), pool?.[field], eodLast?.[field], nowMs, secRowFor(secRows, asked, field)));
    }
    const row = mapped.get(field);
    if (!row) continue;
    out.set(field, row);
    out.set(asked, row);
  }
  return out;
}

/** The three Data Cache reads + overlayRows. Never throws; on a read failure the FMP rows stand. */
export async function overlayTiingoPool(
  fmpRows: Map<string, PricePoolRow>,
  symbols: string[],
  nowMs: number
): Promise<Map<string, PricePoolRow>> {
  const [pool, eodLast, secRows] = await Promise.all([
    readTiingoPool().catch(() => null),
    readTiingoEodLast().catch(() => null),
    readSecCapRows().catch(() => null),
  ]);
  return overlayRows(fmpRows, symbols, pool?.rows ?? null, eodLast, nowMs, secRows);
}

/**
 * Pure. Each Tiingo-priced symbol's SEC x Tiingo market cap and P/E, from the
 * overlay's own row with NO FMP row under it. A symbol Tiingo has no price for
 * is ABSENT (its reader keeps what it had, as the pool overlay keeps the FMP
 * row); a refused or missing SEC input is null.
 */
export function secTiingoValuations(
  symbols: string[],
  pool: Record<string, StoredQuote> | null,
  eodLast: Record<string, EodLast> | null,
  secRows: Record<string, SecCapRow> | null,
  nowMs: number
): Map<string, { marketCap: number | null; pe: number | null }> {
  const out = new Map<string, { marketCap: number | null; pe: number | null }>();
  for (const s of symbols) {
    const field = toDashed(s);
    const row = mapTiingoPoolRow(null, pool?.[field], eodLast?.[field], nowMs, secRowFor(secRows, s, field));
    if (row) out.set(s, { marketCap: row.marketCap, pe: row.pe });
  }
  return out;
}

/**
 * Pure. Each symbol's SEC x Tiingo market cap: null where Tiingo has no price
 * or the SEC inputs refuse. The sector ranking (B7) and the sector weights use
 * this, so they rank and weigh on exactly the cap the pool readers show.
 */
export function secTiingoCaps(
  symbols: string[],
  pool: Record<string, StoredQuote> | null,
  eodLast: Record<string, EodLast> | null,
  secRows: Record<string, SecCapRow> | null,
  nowMs: number
): Map<string, number | null> {
  const vals = secTiingoValuations(symbols, pool, eodLast, secRows, nowMs);
  const out = new Map<string, number | null>();
  for (const s of symbols) out.set(s, vals.get(s)?.marketCap ?? null);
  return out;
}

/** The three Data Cache reads (1 HGETALL per miss each, shared with the overlay). Never throws: a failed read is null. */
async function readValuationBlobs() {
  const [pool, eodLast, secRows] = await Promise.all([
    readTiingoPool().catch(() => null),
    readTiingoEodLast().catch(() => null),
    readSecCapRows().catch(() => null),
  ]);
  return { pool: pool?.rows ?? null, eodLast, secRows };
}

/** The same three Data Cache reads, for secTiingoCaps. Never throws: a failed read is an empty map. */
export async function readSecTiingoCaps(symbols: string[], nowMs: number): Promise<Map<string, number | null>> {
  const b = await readValuationBlobs();
  return secTiingoCaps(symbols, b.pool, b.eodLast, b.secRows, nowMs);
}

/**
 * THE FUNDAMENTALS ROWS' CAP AND P/E, AT READ TIME (#553 COWORK #103, #690 Q2).
 *
 * The warm writes msh:pickers:fundamentals:v1:* from the RAW (FMP) pool rows
 * only: a SEC x Tiingo cap stored there would let the Tiingo close be backed
 * out (cap / shares) of an FMP-named key the msh:tiingo: purge never reaches.
 * Readers on the POOL gate get the overlay's figures here instead, from the
 * same three Data Cache blobs -- no Redis read of its own on a hit. A symbol
 * Tiingo cannot price keeps its stored row unchanged. Never throws.
 */
export async function overlaySecTiingoFundamentals<T extends { marketCap: number | null; peRatio: number | null }>(
  rows: Map<string, T>,
  nowMs: number
): Promise<Map<string, T>> {
  if (!rows.size) return rows;
  const b = await readValuationBlobs();
  const vals = secTiingoValuations([...rows.keys()], b.pool, b.eodLast, b.secRows, nowMs);
  const out = new Map(rows);
  for (const [s, v] of vals) {
    const row = rows.get(s);
    if (row) out.set(s, { ...row, marketCap: v.marketCap, peRatio: v.pe });
  }
  return out;
}
