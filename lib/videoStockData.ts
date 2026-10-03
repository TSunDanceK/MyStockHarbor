// Fetches live market data for video pages.
//
// TWO PATHS since step 6 of the Tiingo switch (#563 COWORK #30): Tiingo via
// getVideoStockDataTiingo when PRICE_PROVIDER_VIDEOS=tiingo, else (and on any
// Tiingo miss) the FMP path below, unchanged.
//
// The FMP path uses fetchQuoteSnapshot() (lib/server/quoteData.ts) to pull price, marketCap,
// name, pe, priceAvg50, priceAvg200 all in one FMP stable/quote call — no
// separate profile call needed.
//
// Fixed 2026-07-21: this used to self-fetch the public /api/quote route over
// HTTP (`fetch(`${baseUrl}/api/quote?...`)`). /api/quote is BotID-guarded
// (see instrumentation-client.ts), and a server-to-server self-fetch carries
// no browser BotID header, so it read as bot traffic and got rejected --
// the same self-fetch-gets-blocked failure mode documented in
// claude/pickers-firewall-selfblock-2026-07-17.md and already fixed the same
// way on the dashboard and stock pages (see
// claude/stock-page-earnings-selfblock-2026-07-21.md). This call site was
// missed in that earlier pass, so video pages kept silently rendering empty
// price/market-cap/MA stat boxes. Now calls fetchQuoteSnapshot() in-process
// instead -- the same function app/api/quote/route.ts's GET handler calls
// internally, so this always returns identically-shaped data to the public
// endpoint, with no HTTP round-trip and nothing for BotID to reject.

import { fetchQuoteSnapshotForRender } from "@/lib/server/quoteData";
import { priceProviderFor } from "@/lib/server/marketData/provider";
import { pickSurfacePrice, readSurfaceInputs } from "@/lib/server/tiingoSurfacePrice";
import { getStockPageSecFacts } from "@/lib/server/secEarningsSnapshot";
import { marketCap, peRatio } from "@/lib/server/secValuation";
import { snapshotCompanyName } from "@/lib/server/companyNameSnapshot";
import { resolveProfile } from "@/lib/server/staticProfile";

// Ticker remapping for non-US tickers, on BOTH paths (Tiingo since #563 COWORK #34).
// Use US-listed ADR equivalents where available: Tiingo's US feed and our price
// pool carry the ADR, not the home listing, and so do the FMP endpoints.
// IFX (Xetra) → IFNNY (US OTC ADR for Infineon Technologies)
const TICKER_REMAP: Record<string, string> = {
  IFX: "IFNNY",
};

function pctFromBase(last: number | null, base: number | null): number | null {
  if (typeof last !== "number" || typeof base !== "number" || !Number.isFinite(last) || !Number.isFinite(base) || base === 0) return null;
  return ((last - base) / base) * 100;
}

export type VideoStockData = {
  ticker: string;
  companyName: string | null;
  price: number | null;
  marketCap: string | null;
  ma50: number | null;
  ma200: number | null;
  ma50Pct: number | null;
  ma200Pct: number | null;
  trend: string | null;
  peRatio: number | null;
  sector: string | null;
  /**
   * Set on the Tiingo path only (#563 COWORK #30): what the price is ("last IEX
   * trade, 14:05 ET" / "close, 29 Sep 2026"). Its presence is also what tells
   * the page to show the linked "Market data from Tiingo.com" credit.
   */
  priceLabel?: string;
  /**
   * Tiingo path only (#553 COWORK #88): why an MA tile is empty when there IS a
   * price -- fewer than 50 / 200 stored daily closes. Shown as the tile's hover
   * note; null when the average computed.
   */
  ma50Note?: string | null;
  ma200Note?: string | null;
};

export const SHORT_HISTORY_NOTE = "Not enough price history stored yet";

function formatMarketCap(value: number | null): string | null {
  if (!value || !Number.isFinite(value)) return null;
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${value.toLocaleString()}`;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Uptrend / Downtrend / Mixed, the rule the FMP path has always used. */
function trendOf(price: number | null, ma50: number | null, ma200: number | null): string | null {
  if (price === null || ma50 === null || ma200 === null) return null;
  if (price > ma50 && ma50 > ma200) return "Uptrend";
  if (price < ma50 && ma50 < ma200) return "Downtrend";
  return "Mixed";
}

/**
 * THE TIINGO PATH (#563 COWORK #30/#31), behind PRICE_PROVIDER_VIDEOS.
 *
 *   price       the pool row or the newest EOD close, whichever is newer, labelled
 *   MA50/MA200  simple averages of the last 50/200 stored EOD closes
 *   market cap  the SEC cover-page share count x that price -- A's marketCap(),
 *               the stock page's own rule (import, not copy: COWORK #31 §2)
 *   P/E         A's peRatio(), with its named refusals; a refusal shows no tile
 *
 * Null when Tiingo has no price for the symbol, so the caller keeps the FMP
 * path: FMP stays this surface's fallback until the owner flips it.
 *
 *   sector      A's sector resolver, SEC-only (no cached vendor value is passed)
 *
 * THE REMAP APPLIES HERE TOO (#563 COWORK #34): IFX reads IFNNY's pool row,
 * history and SEC facts. An ADR filer meets A's ADS-ratio refusal, so IFX shows
 * no market-cap or P/E tile -- correct, not a gap. The page keeps showing IFX.
 */
async function getVideoStockDataTiingo(upper: string): Promise<VideoStockData | null> {
  const symbol = TICKER_REMAP[upper] ?? upper;
  const [{ row, bars }, secFacts] = await Promise.all([
    readSurfaceInputs(symbol),
    getStockPageSecFacts(symbol).catch(() => null),
  ]);
  const surface = pickSurfacePrice(row, bars, Date.now());
  if (!surface) return null;

  const closes = (bars ?? []).map((b) => b[4]).filter((c) => Number.isFinite(c) && c > 0);
  const ma50 = closes.length >= 50 ? average(closes.slice(-50)) : null;
  const ma200 = closes.length >= 200 ? average(closes.slice(-200)) : null;

  const valuation = secFacts?.profileFacts.valuation ?? null;
  const cap = valuation ? marketCap(valuation, surface.price) : null;
  const pe = valuation ? peRatio(valuation, surface.price) : null;

  return {
    ticker: upper,
    companyName: secFacts?.profileFacts.entityName ?? (snapshotCompanyName(symbol) || snapshotCompanyName(upper) || null),
    price: surface.price,
    marketCap: formatMarketCap(cap && cap.ok ? cap.val : null),
    ma50,
    ma200,
    ma50Pct: pctFromBase(surface.price, ma50),
    ma200Pct: pctFromBase(surface.price, ma200),
    trend: trendOf(surface.price, ma50, ma200),
    peRatio: pe && pe.ok ? pe.val : null,
    sector: resolveProfile(symbol, null).sector,
    priceLabel: surface.label,
    ma50Note: ma50 === null ? SHORT_HISTORY_NOTE : null,
    ma200Note: ma200 === null ? SHORT_HISTORY_NOTE : null,
  };
}

export async function getVideoStockData(ticker: string): Promise<VideoStockData> {
  const upper = ticker.trim().toUpperCase();
  if (priceProviderFor("VIDEOS") === "tiingo") {
    const tiingo = await getVideoStockDataTiingo(upper).catch(() => null);
    if (tiingo) return tiingo;
  }
  const fmpSymbol = TICKER_REMAP[upper] ?? upper;

  let price: number | null = null;
  let marketCapRaw: number | null = null;
  let name: string | null = null;
  let pe: number | null = null;
  let ma50: number | null = null;
  let ma200: number | null = null;

  try {
    const q = await fetchQuoteSnapshotForRender(fmpSymbol);
    price = q.price;
    marketCapRaw = q.marketCap;
    name = q.name;
    pe = q.pe;
    ma50 = q.priceAvg50;
    ma200 = q.priceAvg200;
  } catch { /* fall through */ }

  const ma50Pct = pctFromBase(price, ma50);
  const ma200Pct = pctFromBase(price, ma200);

  const trend = trendOf(price, ma50, ma200);

  return {
    ticker: upper,
    companyName: name,
    price,
    marketCap: formatMarketCap(marketCapRaw),
    ma50,
    ma200,
    ma50Pct,
    ma200Pct,
    trend,
    peRatio: pe,
    sector: null,
  };
}
