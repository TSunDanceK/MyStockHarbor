// Fetches live market data for video pages.
// Uses the /api/quote route which pulls price, marketCap, name, pe, priceAvg50,
// priceAvg200 all in one FMP stable/quote call — no separate profile call needed.

// Ticker remapping for non-US tickers that FMP identifies differently.
const TICKER_REMAP: Record<string, string> = {
  IFX: "IFX.DE",
};

function getBaseUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/\/$/, "")}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;
  return "http://localhost:3000";
}

function formatMarketCap(value: number | null): string | null {
  if (!value || !Number.isFinite(value)) return null;
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${value.toLocaleString()}`;
}

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

export async function getVideoStockData(ticker: string): Promise<VideoStockData> {
  const upper = ticker.trim().toUpperCase();
  const fmpSymbol = TICKER_REMAP[upper] ?? upper;
  const baseUrl = getBaseUrl();

  let price: number | null = null;
  let marketCapRaw: number | null = null;
  let name: string | null = null;
  let pe: number | null = null;
  let ma50: number | null = null;
  let ma200: number | null = null;

  try {
    const res = await fetch(
      `${baseUrl}/api/quote?symbol=${encodeURIComponent(fmpSymbol)}`,
      { next: { revalidate: 60 } }
    );
    if (res.ok) {
      const q = await res.json() as Record<string, unknown>;
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      const str = (v: unknown) => (typeof v === "string" && (v as string).trim() ? (v as string).trim() : null);
      price = num(q.price);
      marketCapRaw = num(q.marketCap);
      name = str(q.name);
      pe = num(q.pe);
      ma50 = num(q.priceAvg50);
      ma200 = num(q.priceAvg200);
    }
  } catch { /* fall through */ }

  const ma50Pct = pctFromBase(price, ma50);
  const ma200Pct = pctFromBase(price, ma200);

  let trend: string | null = null;
  if (price !== null && ma50 !== null && ma200 !== null) {
    if (price > ma50 && ma50 > ma200) trend = "Uptrend";
    else if (price < ma50 && ma50 < ma200) trend = "Downtrend";
    else trend = "Mixed";
  }

  // Format market cap — use € for known European tickers
  const isEuro = fmpSymbol.endsWith(".DE") || fmpSymbol.endsWith(".PA") || fmpSymbol.endsWith(".AS");
  let marketCap: string | null = null;
  if (marketCapRaw && Number.isFinite(marketCapRaw)) {
    const sym = isEuro ? "€" : "$";
    if (marketCapRaw >= 1e12) marketCap = `${sym}${(marketCapRaw / 1e12).toFixed(2)}T`;
    else if (marketCapRaw >= 1e9) marketCap = `${sym}${(marketCapRaw / 1e9).toFixed(2)}B`;
    else if (marketCapRaw >= 1e6) marketCap = `${sym}${(marketCapRaw / 1e6).toFixed(0)}M`;
  }

  return {
    ticker: upper,
    companyName: name,
    price,
    marketCap,
    ma50,
    ma200,
    ma50Pct,
    ma200Pct,
    trend,
    peRatio: pe,
    sector: null, // quote endpoint doesn't return sector; omitted for simplicity
  };
}
