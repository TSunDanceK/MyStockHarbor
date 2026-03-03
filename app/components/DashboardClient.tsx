"use client";

import React, { useEffect, useMemo, useState } from "react";
import PriceChart from "./PriceChart";

type Quote = {
  symbol: string;
  price: number | null;
  date: string | null;
  time: string | null;
  source: string;
};

type Point = { date: string; close: number };

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

  const diff = (lastPrice - ma200Last) / ma200Last;

  if (diff <= -0.05) {
    return {
      label: "Undervalued-ish 🟢",
      detail: `Price is ${Math.abs(diff * 100).toFixed(1)}% below MA200.`,
    };
  }
  if (diff < 0.05) {
    return {
      label: "Fair-ish 🟡",
      detail: `Price is ${Math.abs(diff * 100).toFixed(1)}% from MA200.`,
    };
  }
  return {
    label: "Overextended 🔴",
    detail: `Price is ${(diff * 100).toFixed(1)}% above MA200.`,
  };
}

const PRESET_TICKERS: { symbol: string; name: string }[] = [
  { symbol: "AAPL", name: "Apple Inc." },
  { symbol: "ABBV", name: "AbbVie Inc." },
  { symbol: "ABT", name: "Abbott Laboratories" },
  { symbol: "ADBE", name: "Adobe Inc." },
  { symbol: "AMZN", name: "Amazon.com Inc." },
  { symbol: "AVGO", name: "Broadcom Inc." },
  { symbol: "BAC", name: "Bank of America" },
  { symbol: "BRK.B", name: "Berkshire Hathaway B" },
  { symbol: "COST", name: "Costco Wholesale" },
  { symbol: "CRM", name: "Salesforce Inc." },
  { symbol: "CSCO", name: "Cisco Systems" },
  { symbol: "CVX", name: "Chevron Corp." },
  { symbol: "DIS", name: "Walt Disney Co." },
  { symbol: "GOOGL", name: "Alphabet Inc. Class A" },
  { symbol: "HD", name: "Home Depot" },
  { symbol: "INTC", name: "Intel Corp." },
  { symbol: "JNJ", name: "Johnson & Johnson" },
  { symbol: "JPM", name: "JPMorgan Chase" },
  { symbol: "KO", name: "Coca-Cola Co." },
  { symbol: "LLY", name: "Eli Lilly & Co." },
  { symbol: "MA", name: "Mastercard Inc." },
  { symbol: "MCD", name: "McDonald's Corp." },
  { symbol: "META", name: "Meta Platforms" },
  { symbol: "MRK", name: "Merck & Co." },
  { symbol: "MSFT", name: "Microsoft Corp." },
  { symbol: "NFLX", name: "Netflix Inc." },
  { symbol: "NVDA", name: "NVIDIA Corp." },
  { symbol: "ORCL", name: "Oracle Corp." },
  { symbol: "PEP", name: "PepsiCo Inc." },
  { symbol: "PG", name: "Procter & Gamble" },
  { symbol: "PYPL", name: "PayPal Holdings" },
  { symbol: "QCOM", name: "Qualcomm Inc." },
  { symbol: "SBUX", name: "Starbucks Corp." },
  { symbol: "T", name: "AT&T Inc." },
  { symbol: "TGT", name: "Target Corp." },
  { symbol: "TSLA", name: "Tesla Inc." },
  { symbol: "TXN", name: "Texas Instruments" },
  { symbol: "UNH", name: "UnitedHealth Group" },
  { symbol: "V", name: "Visa Inc." },
  { symbol: "VZ", name: "Verizon Communications" },
  { symbol: "WFC", name: "Wells Fargo" },
  { symbol: "WMT", name: "Walmart Inc." },
  { symbol: "XOM", name: "Exxon Mobil Corp." }
].sort((a, b) => a.symbol.localeCompare(b.symbol));

export default function DashboardClient({ defaultSymbol = "AAPL" }: { defaultSymbol?: string }) {
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [tfDays, setTfDays] = useState(365);

  const [quote, setQuote] = useState<Quote | null>(null);
  const [historyAll, setHistoryAll] = useState<Point[]>([]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // custom ticker input
  const [custom, setCustom] = useState(defaultSymbol);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      try {
        // IMPORTANT:
        // Always fetch a long history so MA50/MA200 are computed correctly,
        // then we slice the display by timeframe.
        const historyDays = Math.max(tfDays, 2600); // ~10y of trading days-ish; enough context for MA200

        const [qRes, hRes] = await Promise.all([
          fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" }),
          fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&days=${historyDays}`, { cache: "no-store" }),
        ]);

        if (!qRes.ok) throw new Error("Quote fetch failed");
        if (!hRes.ok) throw new Error("History fetch failed");

        const q = (await qRes.json()) as Quote;
        const h = (await hRes.json()) as { symbol: string; points: Point[] };

        if (cancelled) return;

        const pts = Array.isArray(h.points) ? h.points : [];
        setQuote(q);
        setHistoryAll(pts);
      } catch {
        if (cancelled) return;
        setErr("Failed to load data (try another ticker).");
        setQuote(null);
        setHistoryAll([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [symbol, tfDays]);

  // Slice the *displayed* series for the timeframe
  const displayedHistory = useMemo(() => {
    if (!historyAll.length) return [];
    return historyAll.slice(-tfDays);
  }, [historyAll, tfDays]);

  // Compute MAs on full history for correctness
  const closesAll = useMemo(() => historyAll.map((p) => p.close), [historyAll]);
  const ma50Full = useMemo(() => movingAverage(closesAll, 50), [closesAll]);
  const ma200Full = useMemo(() => movingAverage(closesAll, 200), [closesAll]);

  // Slice MA arrays to match displayed series length
  const ma50 = useMemo(() => ma50Full.slice(-tfDays), [ma50Full, tfDays]);
  const ma200 = useMemo(() => ma200Full.slice(-tfDays), [ma200Full, tfDays]);

  // Use displayed last close so the “signal” matches what you're viewing
  const lastClose = displayedHistory.length ? displayedHistory[displayedHistory.length - 1].close : null;
  const lastMA50 = ma50.length ? ma50[ma50.length - 1] : null;
  const lastMA200 = ma200.length ? ma200[ma200.length - 1] : null;

  const signal = useMemo(() => valuationSignal(lastClose, lastMA200), [lastClose, lastMA200]);

  function applyCustomTicker() {
    const cleaned = custom.trim().toUpperCase();
    if (cleaned) setSymbol(cleaned);
  }

  return (
    <main style={{ padding: 40, fontFamily: "system-ui, Arial" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>My Stock Dashboard</h1>
      <p style={{ marginTop: 0, opacity: 0.7 }}>Version 1 – Learning Build (free data)</p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 16 }}>
        <label style={{ fontWeight: 600 }}>Ticker</label>

       <select
  value={symbol}
  onChange={(e) => {
    setSymbol(e.target.value);
    setCustom(e.target.value);
  }}
  style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #3333" }}
>
  {PRESET_TICKERS.map((t) => (
    <option key={t.symbol} value={t.symbol}>
      {t.symbol} – {t.name}
    </option>
  ))}
</select>

<span style={{ opacity: 0.6 }}>or</span>

        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Type ticker (e.g. META)"
          style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #3333", width: 220 }}
        />
        <button
          onClick={applyCustomTicker}
          style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #3333", cursor: "pointer" }}
        >
          Load
        </button>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {TIMEFRAMES.map((t) => (
            <button
              key={t.label}
              onClick={() => setTfDays(t.days)}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #3333",
                cursor: "pointer",
                opacity: tfDays === t.days ? 1 : 0.7,
                fontWeight: tfDays === t.days ? 700 : 500,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 16, maxWidth: 920, display: "grid", gap: 16 }}>
        <div style={{ padding: 16, border: "1px solid #3333", borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>{symbol}</h2>

          {loading ? (
            <p style={{ margin: "8px 0" }}>Loading…</p>
          ) : err ? (
            <p style={{ margin: "8px 0" }}>{err}</p>
          ) : (
            <>
              <p style={{ fontSize: 20, margin: "8px 0" }}>
                <strong>Last price:</strong>{" "}
                {quote?.price == null ? "Unavailable" : `$${quote.price.toFixed(2)}`}
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
                {quote?.date && quote?.time ? `As of ${quote.date} ${quote.time}` : "Timestamp unavailable"} • Source:{" "}
                {quote?.source ?? "stooq.com"}
              </p>
            </>
          )}
        </div>

        <div style={{ padding: 16, border: "1px solid #3333", borderRadius: 12 }}>
          <PriceChart data={displayedHistory} ma50={ma50} ma200={ma200} />
        </div>
      </div>
    </main>
  );
}
