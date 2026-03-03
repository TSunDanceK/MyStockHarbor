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

async function getDailyHistory(symbol: string, days = 320): Promise<Point[]> {
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

    return points.slice(-days);
  } catch {
    return [];
  }
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

function valuationSignal(lastPrice: number | null, ma200Last: number | null) {
  if (lastPrice === null || ma200Last === null) {
    return { label: "Signal unavailable", detail: "Need enough data for MA200." };
  }

  const diff = (lastPrice - ma200Last) / ma200Last; // + if above MA200

  if (diff <= -0.05) {
    return { label: "Undervalued-ish 🟢", detail: `Price is ${Math.abs(diff * 100).toFixed(1)}% below MA200.` };
  }
  if (diff < 0.05) {
    return { label: "Fair-ish 🟡", detail: `Price is ${Math.abs(diff * 100).toFixed(1)}% from MA200.` };
  }
  return { label: "Overextended 🔴", detail: `Price is ${(diff * 100).toFixed(1)}% above MA200.` };
}

export default async function Home() {
  const symbol = "AAPL";

  const [quote, history] = await Promise.all([getQuote(symbol), getDailyHistory(symbol, 320)]);

  const closes = history.map((p) => p.close);
  const ma50 = movingAverage(closes, 50);
  const ma200 = movingAverage(closes, 200);

  const lastClose = history.length ? history[history.length - 1].close : null;
  const lastMA50 = ma50.length ? ma50[ma50.length - 1] : null;
  const lastMA200 = ma200.length ? ma200[ma200.length - 1] : null;

  const signal = valuationSignal(lastClose, lastMA200);

  return (
    <main style={{ padding: 40, fontFamily: "system-ui, Arial" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>My Stock Dashboard</h1>
      <p style={{ marginTop: 0, opacity: 0.7 }}>Version 1 – Learning Build (free data)</p>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr", maxWidth: 820 }}>
        <div style={{ padding: 16, border: "1px solid #3333", borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>{symbol}</h2>

          <p style={{ fontSize: 20, margin: "8px 0" }}>
            <strong>Last price:</strong> {quote.price === null ? "Unavailable" : `$${quote.price.toFixed(2)}`}
          </p>

          <p style={{ margin: "8px 0 0", opacity: 0.85 }}>
            <strong>Signal:</strong> {signal.label}
          </p>
          <p style={{ margin: "6px 0 0", opacity: 0.7 }}>{signal.detail}</p>

          <div style={{ marginTop: 12, fontSize: 13, opacity: 0.75 }}>
            <div>MA50: {typeof lastMA50 === "number" ? `$${lastMA50.toFixed(2)}` : "—"}</div>
            <div>MA200: {typeof lastMA200 === "number" ? `$${lastMA200.toFixed(2)}` : "—"}</div>
          </div>

          <p style={{ marginTop: 12, opacity: 0.7 }}>
            {quote.date && quote.time ? `As of ${quote.date} ${quote.time}` : "Timestamp unavailable"} • Source:{" "}
            {quote.source}
          </p>
        </div>

        <div style={{ padding: 16, border: "1px solid #3333", borderRadius: 12 }}>
          <PriceChart data={history} ma50={ma50} ma200={ma200} />
        </div>

        <div style={{ padding: 14, border: "1px solid #3333", borderRadius: 12, opacity: 0.8 }}>
          <strong>Note:</strong> This “valuation” is a simple technical proxy (price vs MA200), not true intrinsic value.
        </div>
      </div>
    </main>
  );
}
