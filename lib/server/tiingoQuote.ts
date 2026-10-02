// THE STOCK PAGE AND DASHBOARD QUOTE, AND THE BENCHMARK TILES, ON TIINGO
// (step 4, #553 COWORK #71 row 4; HANDOVER §2), behind PRICE_PROVIDER_STOCK_PAGE.
//
// READS ONLY, through the step-1 adapter (read.ts) via C's readSurfaceInputs:
// the pool is one cached blob shared with every surface, the history one cached
// entry per symbol. No Tiingo call on a visitor's request (COWORK #56 rule 1).
//
// WHAT EACH FIELD IS, and the label that says so (COWORK #56):
//   price            the newer of the IEX trade and the EOD close, named by
//                    pickSurfacePrice ("last IEX trade, 14:05 ET" / "close, 1 Oct 2026")
//   previous close   the stored close before the price's trading day: the
//                    consolidated figure, not IEX's own
//   open, day range  the IEX row while the price is IEX, the bar once it is the close
//   52-week range    the stored bars over the last 252 sessions, one source (COWORK #80)
//   volume           the last EOD bar's consolidated volume ONLY, labelled
//                    "as of last close". IEX volume is one venue and is never
//                    shown as day volume (COWORK #53 §3, #56).
//   avg volume       the mean of the last 50 sessions' EOD volume
//   MA50 / MA200     simple means of the last 50 / 200 stored closes
//
// NOT FILLED HERE: market cap, P/E and exchange. No reader of /api/quote or the
// dashboard seed shows them, and filling them would put an SEC read on every
// live quote request. The stock page takes those from A's SEC valuation.
//
// NEVER PERSISTED OUTSIDE msh:tiingo: (contract §7, the purge). The callers
// skip their own Redis layers (msh:quote:v1, msh:benchmarks:*) on this path.
import type { EodBar, StoredQuote } from "./marketData/types";
import { pickSurfacePrice, readSurfaceInputs } from "./tiingoSurfacePrice";
import { priceProviderFor } from "./marketData/provider";
import { snapshotCompanyName } from "./companyNameSnapshot";
import type { Quote } from "./quoteData";
import { fiftyTwoWeekRange } from "./fiftyTwoWeek";

export const VOLUME_LABEL = "as of last close";
const AVG_VOLUME_SESSIONS = 50;

export function stockPageOnTiingo(env: Record<string, string | undefined> = process.env): boolean {
  return priceProviderFor("STOCK_PAGE", env) === "tiingo";
}

const pos = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The stored close before `date`, i.e. the previous session's consolidated close. */
export function closeBefore(bars: EodBar[], date: string): number | null {
  for (let i = bars.length - 1; i >= 0; i--) if (bars[i][0] < date && pos(bars[i][4])) return bars[i][4];
  return null;
}

/**
 * The points the 52-week range is taken over: every stored bar, plus the IEX
 * row as today's partial bar when it is newer than the last bar. The stock page
 * hands the SAME points to its profile row (step 5, #553 COWORK #80 §1).
 */
export function rangePoints(bars: EodBar[], row: StoredQuote | null, rowIsNewer: boolean): { close: number; high?: number; low?: number }[] {
  const pts: { close: number; high?: number; low?: number }[] = bars
    .filter((b) => pos(b[4]))
    .map((b) => ({ close: b[4], high: pos(b[2]) ? b[2] : undefined, low: pos(b[3]) ? b[3] : undefined }));
  if (rowIsNewer && row && pos(row.price)) {
    pts.push({
      close: row.price,
      high: Math.max(row.price, pos(row.high) ? row.high : row.price),
      low: Math.min(row.price, pos(row.low) ? row.low : row.price),
    });
  }
  return pts;
}

/**
 * The 52-week range, by THE helper the profile row uses (fiftyTwoWeek.ts):
 * the last 252 points, at least 20 of them, so the header and the profile row
 * cannot disagree (KO, COWORK #80 §1).
 */
export function yearRange(bars: EodBar[], row: StoredQuote | null, rowIsNewer: boolean): { low: number | null; high: number | null } {
  const r = fiftyTwoWeekRange(rangePoints(bars, row, rowIsNewer));
  return { low: r?.low ?? null, high: r?.high ?? null };
}

/**
 * Pure. Null when Tiingo has no usable price, so the caller keeps its FMP path
 * (the fallback stays until the surface is verified, COWORK #56).
 */
export function buildTiingoQuote(
  symbol: string,
  row: StoredQuote | null,
  bars: EodBar[] | null,
  nowMs: number,
  name: string | null = null
): Quote | null {
  const all = bars ?? [];
  const surface = pickSurfacePrice(row, all, nowMs);
  if (!surface) return null;

  const isIex = surface.kind === "iex";
  const last = all.length ? all[all.length - 1] : null;
  const prev = closeBefore(all, surface.date) ?? (isIex && pos(row?.prevClose) ? row!.prevClose : null);
  const change = prev != null ? surface.price - prev : null;

  const open = isIex ? row?.open : last?.[1];
  const low = isIex ? row?.low : last?.[3];
  const high = isIex ? row?.high : last?.[2];
  const year = yearRange(all, row, isIex);

  const closes = all.map((b) => b[4]).filter(pos);
  const vols = all.map((b) => b[5]).filter(pos);
  const iexTime = isIex && /\d\d:\d\d/.exec(surface.label)?.[0];

  return {
    symbol,
    price: surface.price,
    marketCap: null,
    name,
    pe: null,
    priceAvg50: closes.length >= 50 ? mean(closes.slice(-50)) : null,
    priceAvg200: closes.length >= 200 ? mean(closes.slice(-200)) : null,
    exchange: null,
    date: surface.date,
    time: iexTime || null,
    source: null,
    open: pos(open) ? open : null,
    previousClose: prev,
    change: change != null ? round2(change) : null,
    changePercentage: change != null && prev ? (change / prev) * 100 : null,
    dayLow: pos(low) ? low : null,
    dayHigh: pos(high) ? high : null,
    yearLow: year.low,
    yearHigh: year.high,
    volume: last && pos(last[5]) ? last[5] : null,
    avgVolume: vols.length >= AVG_VOLUME_SESSIONS ? mean(vols.slice(-AVG_VOLUME_SESSIONS)) : null,
    priceLabel: surface.label,
    volumeLabel: last && pos(last[5]) ? VOLUME_LABEL : null,
  };
}

/** The pool row and history from the Data Cache, built. Never throws. */
export async function readTiingoQuote(symbolInput: string, nowMs = Date.now()): Promise<Quote | null> {
  const symbol = String(symbolInput ?? "").trim().toUpperCase();
  if (!symbol) return null;
  try {
    const { row, bars } = await readSurfaceInputs(symbol);
    return buildTiingoQuote(symbol, row, bars, nowMs, snapshotCompanyName(symbol) || null);
  } catch {
    return null;
  }
}
