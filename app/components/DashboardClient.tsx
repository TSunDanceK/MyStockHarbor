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
  if (diff <= -0.05) return { label: "Undervalued-ish 🟢", detail: `Price is ${Math.abs(diff * 100).toFixed(1)}% below MA200.` };
  if (diff < 0.05) return { label: "Fair-ish 🟡", detail: `Price is ${Math.abs(diff * 100).toFixed(1)}% from MA200.` };
  return { label: "Overextended 🔴", detail: `Price is ${(diff * 100).toFixed(1)}% above MA200.` };
}

const PRESET_TICKERS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "TSLA"] as const;

const TIMEFRAMES: { label: string; days: number }[] = [
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "3Y", days: 365 * 3 },
  { label: "5Y", days: 365 * 5 },
  { label: "MAX", days: 4000 },
];

export default function DashboardClient({ defaultSymbol = "AAPL" }: { defaultSymbol?: string }) {
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [tfDays, setTfDays] = useState(365);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [history, setHistory] = useState<Point[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // simple input for custom ticker too
  const [custom, setCustom] = useState(defaultSymbol);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      try {
        const [qRes, hRes] = await Promise.all([
          fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" }),
          fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&days=${tfDays}`, { cache: "no-store" }),
        ]);

        const q = (await qRes.json()) as Quote;
        const h = (await hRes.json()) as { symbol: string; points: Point[] };

        if (cancelled) return;

        setQuote(q);
        setHistory(Array.isArray(h.points) ? h.points : []);
      } catch (e: any) {
        if (cancelled) return;
        setErr("Failed to load data (try another ticker).");
        setQuote(null);
        setHistory([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [symbol, tfDays]);

  const closes = useMemo(() => history.map((p) => p.close), [history]);
  const ma50 = useMemo(() => movingAverage(closes, 50), [closes]);
  const ma200 = useMemo(() => movingAverage(closes, 200), [closes]);

  const lastClose = history.length ? history[history.length - 1].close : null;
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
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <span style={{ opacity: 0.6 }}>or</span>

        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Type ticker (e.g. META)"
          style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #3333", width: 200 }}
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

      <div style={{ marginTop: 16, maxWidth: 900, display: "grid", gap: 16 }}>
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
          <PriceChart data={history} ma50={ma50} ma200={ma200} />
        </div>
      </div>
    </main>
  );
}
