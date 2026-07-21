export type Quote = {
  symbol: string;
  price: number | null;
  marketCap: number | null;
  name: string | null;
  pe: number | null;
  priceAvg50: number | null;
  priceAvg200: number | null;
  exchange: string | null;
  date: string | null;
  time: string | null;
  source: string;
  // Added for the trader quote-snapshot header: day range, volume vs average,
  // previous close and change. All come from the same stable/quote call
  // already being made — no extra API cost.
  open: number | null;
  previousClose: number | null;
  change: number | null;
  changePercentage: number | null;
  dayLow: number | null;
  dayHigh: number | null;
  yearLow: number | null;
  yearHigh: number | null;
  volume: number | null;
  avgVolume: number | null;
};

export function emptyQuote(symbol: string): Quote {
  return {
    symbol,
    price: null,
    marketCap: null,
    name: null,
    pe: null,
    priceAvg50: null,
    priceAvg200: null,
    exchange: null,
    date: null,
    time: null,
    source: "financialmodelingprep.com",
    open: null,
    previousClose: null,
    change: null,
    changePercentage: null,
    dayLow: null,
    dayHigh: null,
    yearLow: null,
    yearHigh: null,
    volume: null,
    avgVolume: null,
  };
}

// Core FMP quote fetch + parse, extracted out of app/api/quote/route.ts so it
// can be called in-process (no HTTP self-fetch) by server-rendered callers
// that have no browser session -- e.g. lib/insightSnapshots.ts building a new
// Insight post's SEO snapshot. A server-to-server fetch to the public
// /api/quote route carries no browser BotID header and gets misclassified as
// bot traffic once that route is BotID-guarded (see
// claude/pickers-firewall-selfblock-2026-07-17.md for the same failure mode
// hitting /api/pickers, /api/plays, /api/bull-flags, /api/descending-triangles
// and /api/benchmarks previously -- this is that exact pattern applied here).
// app/api/quote/route.ts's GET handler calls this function too, so the public
// endpoint and any in-process caller always return identically-shaped data.
export async function fetchQuoteSnapshot(symbol: string): Promise<Quote> {
  const apiKey = process.env.FMP_API_KEY;

  if (!apiKey) return emptyQuote(symbol);

  try {
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });

    if (!res.ok) throw new Error(`FMP quote failed: ${res.status}`);

    const json = await res.json();
    const row = Array.isArray(json) ? json[0] : json;

    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

    const now = new Date();

    const payload: Quote = {
      symbol: str(row?.symbol) ?? symbol,
      price: num(row?.price),
      marketCap: num(row?.marketCap),
      name: str(row?.name),
      pe: num(row?.pe),
      priceAvg50: num(row?.priceAvg50),
      priceAvg200: num(row?.priceAvg200),
      exchange: str(row?.exchange),
      date: now.toISOString().slice(0, 10),
      time: now.toISOString().slice(11, 19),
      source: "financialmodelingprep.com",
      open: num(row?.open),
      previousClose: num(row?.previousClose),
      change: num(row?.change),
      changePercentage: num(row?.changePercentage),
      dayLow: num(row?.dayLow),
      dayHigh: num(row?.dayHigh),
      yearLow: num(row?.yearLow),
      yearHigh: num(row?.yearHigh),
      volume: num(row?.volume),
      avgVolume: num(row?.avgVolume),
    };

    return payload;
  } catch {
    return emptyQuote(symbol);
  }
}
