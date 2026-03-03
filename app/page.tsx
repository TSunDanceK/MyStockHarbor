import PriceChart from "./components/PriceChart";

type Quote = {
  symbol: string;
  price: number | null;
  date: string | null;
  time: string | null;
  source: string;
};

type Point = { date: string; close: number };

async function getQuote(symbol: string): Promise<Quote> {
  const stooqSymbol = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/l/?s=${stooqSymbol}&f=sd2t2l&h&e=csv`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    const lines = text.trim().split("\n");
    const row = lines[1].split(",");

    const sym = row[0] ?? symbol.toUpperCase();
    const date = row[1] ?? null;
    const time = row[2] ?? null;
    const lastStr = row[3] ?? "";
    const price = lastStr && lastStr !== "N/D" ? Number(lastStr) : null;

    return { symbol: sym, price: Number.isFinite(price) ? price : null, date, time, source: "stooq.com" };
  } catch {
    return { symbol: symbol.toUpperCase(), price: null, date: null, time: null, source: "stooq.com" };
  }
}

async function getDailyHistory(symbol: string, days = 120): Promise<Point[]> {
  // Stooq daily CSV endpoint
  const stooqSymbol = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${stooqSymbol}&i=d`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();

    // CSV headers: Date,Open,High,Low,Close,Volume
    const lines = text.trim().split("\n");
    if (lines.length < 3) return [];

    const points: Point[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const date = cols[0];
      const close = Number(cols[4]);
      if (date && Number.isFinite(close)) points.push({ date, close });
    }

    // keep most recent N
    return points.slice(-days);
  } catch {
    return [];
  }
}

export default async function Home() {
  const [quote, history] = await Promise.all([getQuote("AAPL"), getDailyHistory("AAPL", 180)]);

  return (
    <main style={{ padding: 40, fontFamily: "system-ui, Arial" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>My Stock Dashboard</h1>
      <p style={{ marginTop: 0, opacity: 0.7 }}>Version 1 – Learning Build</p>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr", maxWidth: 780 }}>
        <div style={{ padding: 16, border: "1px solid #3333", borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>AAPL</h2>

          <p style={{ fontSize: 20, margin: "8px 0" }}>
            <strong>Last price:</strong>{" "}
            {quote.price === null ? "Unavailable" : `$${quote.price.toFixed(2)}`}
          </p>

          <p style={{ margin: 0, opacity: 0.7 }}>
            {quote.date && quote.time ? `As of ${quote.date} ${quote.time}` : "Timestamp unavailable"} • Source: {quote.source}
          </p>
        </div>

        <div style={{ padding: 16, border: "1px solid #3333", borderRadius: 12 }}>
          <PriceChart data={history} />
        </div>
      </div>

      <p style={{ marginTop: 24, opacity: 0.7 }}>
        Next: fundamentals (revenue/EPS) + overlay + “undervalued” score.
      </p>
    </main>
  );
}
