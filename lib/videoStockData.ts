// Fetches live market data for video pages.
// Uses fetchQuoteSnapshot() (lib/server/quoteData.ts) to pull price, marketCap,
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

import { fetchQuoteSnapshot } from "@/lib/server/quoteData";

// Ticker remapping for non-US tickers.
// Use US-listed ADR equivalents where available — all FMP endpoints work reliably for US symbols.
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
};

function formatMarketCap(value: number | null): string | null {
  if (!value || !Number.isFinite(value)) return null;
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${value.toLocaleString()}`;
}

export async function getVideoStockData(ticker: string): Promise<VideoStockData> {
  const upper = ticker.trim().toUpperCase();
  const fmpSymbol = TICKER_REMAP[upper] ?? upper;

  let price: number | null = null;
  let marketCapRaw: number | null = null;
  let name: string | null = null;
  let pe: number | null = null;
  let ma50: number | null = null;
  let ma200: number | null = null;

  try {
    const q = await fetchQuoteSnapshot(fmpSymbol);
    price = q.price;
    marketCapRaw = q.marketCap;
    name = q.name;
    pe = q.pe;
    ma50 = q.priceAvg50;
    ma200 = q.priceAvg200;
  } catch { /* fall through */ }

  const ma50Pct = pctFromBase(price, ma50);
  const ma200Pct = pctFromBase(price, ma200);

  let trend: string | null = null;
  if (price !== null && ma50 !== null && ma200 !== null) {
    if (price > ma50 && ma50 > ma200) trend = "Uptrend";
    else if (price < ma50 && ma50 < ma200) trend = "Downtrend";
    else trend = "Mixed";
  }

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
