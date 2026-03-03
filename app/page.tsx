type Quote = {
  symbol: string;
  price: number | null;
  date: string | null;
  time: string | null;
  source: string;
};

async function getQuote(symbol: string): Promise<Quote> {
  // Stooq uses symbols like aapl.us
  const stooqSymbol = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/l/?s=${stooqSymbol}&f=sd2t2l&h&e=csv`;

  try {
    const res = await fetch(url, { cache: "no-store" }); // always fresh on reload
    const text = await res.text();

    // CSV format: Symbol,Date,Time,Last
    // Example:
    // Symbol,Date,Time,Last
    // AAPL.US,2026-03-01,22:00:06,182.34
    const lines = text.trim().split("\n");
    if (lines.length < 2) throw new Error("No data");
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

export default async function Home() {
  const quote = await getQuote("AAPL");

  return (
    <main style={{ padding: 40, fontFamily: "system-ui, Arial" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>My Stock Dashboard</h1>
      <p style={{ marginTop: 0, opacity: 0.7 }}>Version 1 – Learning Build</p>

      <div style={{ marginTop: 24, padding: 16, border: "1px solid #3333", borderRadius: 12, maxWidth: 520 }}>
        <h2 style={{ marginTop: 0 }}>AAPL</h2>

        <p style={{ fontSize: 20, margin: "8px 0" }}>
          <strong>Last price:</strong>{" "}
          {quote.price === null ? "Unavailable" : `$${quote.price.toFixed(2)}`}
        </p>

        <p style={{ margin: 0, opacity: 0.7 }}>
          {quote.date && quote.time ? `As of ${quote.date} ${quote.time}` : "Timestamp unavailable"} • Source: {quote.source}
        </p>
      </div>

      <p style={{ marginTop: 24, opacity: 0.7 }}>
        Next: add a simple price chart + revenue overlay.
      </p>
    </main>
  );
}
