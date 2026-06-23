// Fetches live market data (price, market cap, MA50, MA200) for a video page ticker.
// Uses FMP for market cap / profile, and the existing internal /api/history + /api/quote
// routes (same pattern as insightSnapshots.ts) for price and moving averages.

function getBaseUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/\/$/, "")}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;
  return "http://localhost:3000";
}

function movingAverage(values: number[], window: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

function lastNum(arr: (number | null)[]) {
  return arr.length ? arr[arr.length - 1] : null;
}

function pctFromBase(last: number | null, base: number | null): number | null {
  if (typeof last !== "number" || typeof base !== "number" || !Number.isFinite(last) || !Number.isFinite(base) || base === 0) return null;
  return ((last - base) / base) * 100;
}

function formatMarketCap(value: number | null): string | null {
  if (!value || !Number.isFinite(value)) return null;
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${value.toLocaleString()}`;
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

async function fetchFmpProfile(ticker: string): Promise<{ marketCap: number | null; pe: number | null; sector: string | null; name: string | null }> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return { marketCap: null, pe: null, sector: null, name: null };

  try {
    const res = await fetch(
      `https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(apiKey)}`,
      { next: { revalidate: 60 * 60 * 6 } } // 6h cache — market cap doesn't change minute to minute
    );
    if (!res.ok) return { marketCap: null, pe: null, sector: null, name: null };

    const data = await res.json() as unknown;
    const item = Array.isArray(data) ? data[0] : (typeof data === "object" && data !== null ? data : null);
    if (!item) return { marketCap: null, pe: null, sector: null, name: null };

    const record = item as Record<string, unknown>;
    const marketCap = typeof record.mktCap === "number" && Number.isFinite(record.mktCap) ? record.mktCap : null;
    const pe = typeof record.pe === "number" && Number.isFinite(record.pe) ? record.pe : null;
    const sector = typeof record.sector === "string" && record.sector.trim() ? record.sector.trim() : null;
    const name = typeof record.companyName === "string" && record.companyName.trim() ? record.companyName.trim() : null;

    return { marketCap, pe, sector, name };
  } catch {
    return { marketCap: null, pe: null, sector: null, name: null };
  }
}

export async function getVideoStockData(ticker: string): Promise<VideoStockData> {
  const upper = ticker.trim().toUpperCase();
  const baseUrl = getBaseUrl();

  const [quoteRes, historyRes, profile] = await Promise.allSettled([
    fetch(`${baseUrl}/api/quote?symbol=${encodeURIComponent(upper)}`, { next: { revalidate: 60 } }),
    fetch(`${baseUrl}/api/history?symbol=${encodeURIComponent(upper)}&days=600`, { next: { revalidate: 3600 } }),
    fetchFmpProfile(upper),
  ]);

  let price: number | null = null;
  let companyNameFromQuote: string | null = null;

  if (quoteRes.status === "fulfilled" && quoteRes.value.ok) {
    try {
      const q = await quoteRes.value.json() as Record<string, unknown>;
      price = typeof q.price === "number" && Number.isFinite(q.price) ? q.price : null;
      companyNameFromQuote = typeof q.name === "string" && q.name.trim() ? q.name.trim() : null;
    } catch { /* fall through */ }
  }

  let ma50: number | null = null;
  let ma200: number | null = null;

  if (historyRes.status === "fulfilled" && historyRes.value.ok) {
    try {
      const h = await historyRes.value.json() as { points?: Array<{ close?: unknown }> };
      const pts = Array.isArray(h.points) ? h.points : [];
      const closes = pts.map((p) => Number(p.close)).filter((n) => Number.isFinite(n));
      if (closes.length >= 50) ma50 = lastNum(movingAverage(closes, 50));
      if (closes.length >= 200) ma200 = lastNum(movingAverage(closes, 200));
    } catch { /* fall through */ }
  }

  const profileData = profile.status === "fulfilled" ? profile.value : { marketCap: null, pe: null, sector: null, name: null };

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
    companyName: profileData.name ?? companyNameFromQuote,
    price,
    marketCap: formatMarketCap(profileData.marketCap),
    ma50,
    ma200,
    ma50Pct,
    ma200Pct,
    trend,
    peRatio: profileData.pe,
    sector: profileData.sector,
  };
}
