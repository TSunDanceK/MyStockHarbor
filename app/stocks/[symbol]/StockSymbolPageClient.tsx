"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Quote = {
  symbol: string;
  price: number | null;
  date: string | null;
  time: string | null;
  source: string;
};

type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

type SymbolResult = {
  symbol: string;
  name: string;
  exchange: string;
};

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

function buildTrendScore(args: {
  lastClose: number | null;
  ma50: number | null;
  ma200: number | null;
}) {
  const { lastClose, ma50, ma200 } = args;

  const checks = [
    typeof lastClose === "number" && typeof ma200 === "number" ? lastClose > ma200 : null,
    typeof lastClose === "number" && typeof ma50 === "number" ? lastClose > ma50 : null,
    typeof ma50 === "number" && typeof ma200 === "number" ? ma50 > ma200 : null,
  ];

  const passed = checks.reduce((acc, v) => acc + (v === true ? 1 : 0), 0);
  return { passed, total: 3 };
}

function trendLabel(args: {
  lastClose: number | null;
  ma50: number | null;
  ma200: number | null;
}) {
  const { lastClose, ma50, ma200 } = args;

  if (
    typeof lastClose === "number" &&
    typeof ma50 === "number" &&
    typeof ma200 === "number"
  ) {
    if (lastClose > ma50 && ma50 > ma200) return "Uptrend";
    if (lastClose < ma50 && ma50 < ma200) return "Downtrend";
  }

  return "Range / Mixed";
}

function toneColor(tone: "green" | "yellow" | "red") {
  if (tone === "green") return "#22c55e";
  if (tone === "yellow") return "#eab308";
  return "#ef4444";
}

export default function StockSymbolPageClient({ symbol }: { symbol: string }) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [history, setHistory] = useState<Point[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      try {
        const [quoteRes, historyRes, symbolsRes] = await Promise.all([
          fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" }),
          fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&days=400`, { cache: "no-store" }),
          fetch(`/api/symbols?q=${encodeURIComponent(symbol)}`, { cache: "no-store" }),
        ]);

        if (!quoteRes.ok) throw new Error("Quote fetch failed");
        if (!historyRes.ok) throw new Error("History fetch failed");

        const quoteData = (await quoteRes.json()) as Quote;
        const historyData = (await historyRes.json()) as { symbol: string; points: any[] };

        let name = "";
        if (symbolsRes.ok) {
          const symbolsData = (await symbolsRes.json()) as { results?: SymbolResult[] };
          const exact = (symbolsData.results ?? []).find(
            (r) => (r.symbol ?? "").toUpperCase() === symbol.toUpperCase()
          );
          name = exact?.name ?? "";
        }

        if (cancelled) return;

        const ptsRaw = Array.isArray(historyData.points) ? historyData.points : [];
        const pts: Point[] = ptsRaw
          .map((p: any) => ({
            date: String(p?.date ?? ""),
            close: Number(p?.close),
            high: p?.high == null ? undefined : Number(p.high),
            low: p?.low == null ? undefined : Number(p.low),
            volume: p?.volume == null ? undefined : Number(p.volume),
          }))
          .filter((p) => p.date && Number.isFinite(p.close));

        setQuote(quoteData);
        setHistory(pts);
        setCompanyName(name);
      } catch {
        if (cancelled) return;
        setErr("Failed to load stock page.");
        setQuote(null);
        setHistory([]);
        setCompanyName("");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const closes = useMemo(() => history.map((p) => p.close), [history]);
  const ma50 = useMemo(() => movingAverage(closes, 50), [closes]);
  const ma200 = useMemo(() => movingAverage(closes, 200), [closes]);

  const lastClose = history.length ? history[history.length - 1].close : null;
  const lastMA50 = lastNum(ma50);
  const lastMA200 = lastNum(ma200);

  const trendScore = useMemo(
    () =>
      buildTrendScore({
        lastClose,
        ma50: typeof lastMA50 === "number" ? lastMA50 : null,
        ma200: typeof lastMA200 === "number" ? lastMA200 : null,
      }),
    [lastClose, lastMA50, lastMA200]
  );

  const trend = useMemo(
    () =>
      trendLabel({
        lastClose,
        ma50: typeof lastMA50 === "number" ? lastMA50 : null,
        ma200: typeof lastMA200 === "number" ? lastMA200 : null,
      }),
    [lastClose, lastMA50, lastMA200]
  );

  const trendTone: "green" | "yellow" | "red" =
    trendScore.passed >= 3 ? "green" : trendScore.passed === 2 ? "yellow" : "red";

  const summary = useMemo(() => {
    const priceText =
      typeof quote?.price === "number" ? `$${quote.price.toFixed(2)}` : "an unavailable latest price";

    return `${symbol} is currently showing a ${trend} structure with a Trend Score of ${trendScore.passed}/${trendScore.total}. The latest price is ${priceText}. This page provides a simple technical snapshot and a direct link into the full MyStockHarbor dashboard.`;
  }, [quote?.price, symbol, trend, trendScore.passed, trendScore.total]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#06080d",
        color: "#f1f5f9",
        fontFamily: "system-ui, Arial",
        padding: "40px 20px",
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ marginBottom: 20, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <Link
            href="/"
            style={{
              color: "#93c5fd",
              textDecoration: "none",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            ← Back to Dashboard
          </Link>

          <Link
            href={`/?symbol=${encodeURIComponent(symbol)}`}
            style={{
              color: "#93c5fd",
              textDecoration: "none",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            Open Full Interactive Chart →
          </Link>
        </div>

        <section
          style={{
            background: "#0b1220",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 16,
            padding: 24,
            boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
          }}
        >
          <h1
            style={{
              marginTop: 0,
              marginBottom: 10,
              fontSize: 36,
              lineHeight: 1.1,
              fontWeight: 950,
            }}
          >
            {symbol} Stock Analysis
          </h1>

          <div style={{ fontSize: 16, opacity: 0.8, marginBottom: 20 }}>
            {companyName || "Stock technical overview"} {companyName ? `(${symbol})` : ""}
          </div>

          {loading ? (
            <p style={{ margin: 0, opacity: 0.8 }}>Loading stock page…</p>
          ) : err ? (
            <p style={{ margin: 0, opacity: 0.8 }}>{err}</p>
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 14,
                }}
              >
                <div
                  style={{
                    border: "1px solid rgba(255,255,255,0.10)",
                    borderRadius: 14,
                    padding: 16,
                    background: "rgba(255,255,255,0.03)",
                  }}
                >
                  <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 8 }}>Last price</div>
                  <div style={{ fontSize: 28, fontWeight: 900 }}>
                    {typeof quote?.price === "number" ? `$${quote.price.toFixed(2)}` : "—"}
                  </div>
                </div>

                <div
                  style={{
                    border: "1px solid rgba(255,255,255,0.10)",
                    borderRadius: 14,
                    padding: 16,
                    background: "rgba(255,255,255,0.03)",
                  }}
                >
                  <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 8 }}>Trend Score</div>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 900,
                      color: toneColor(trendTone),
                    }}
                  >
                    {trendScore.passed}/{trendScore.total}
                  </div>
                </div>

                <div
                  style={{
                    border: "1px solid rgba(255,255,255,0.10)",
                    borderRadius: 14,
                    padding: 16,
                    background: "rgba(255,255,255,0.03)",
                  }}
                >
                  <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 8 }}>Regime</div>
                  <div style={{ fontSize: 28, fontWeight: 900 }}>{trend}</div>
                </div>
              </div>

              <div
                style={{
                  marginTop: 18,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 14,
                }}
              >
                <div
                  style={{
                    border: "1px solid rgba(255,255,255,0.10)",
                    borderRadius: 14,
                    padding: 16,
                    background: "rgba(255,255,255,0.03)",
                  }}
                >
                  <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 8 }}>MA50</div>
                  <div style={{ fontSize: 22, fontWeight: 850 }}>
                    {typeof lastMA50 === "number" ? `$${lastMA50.toFixed(2)}` : "—"}
                  </div>
                </div>

                <div
                  style={{
                    border: "1px solid rgba(255,255,255,0.10)",
                    borderRadius: 14,
                    padding: 16,
                    background: "rgba(255,255,255,0.03)",
                  }}
                >
                  <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 8 }}>MA200</div>
                  <div style={{ fontSize: 22, fontWeight: 850 }}>
                    {typeof lastMA200 === "number" ? `$${lastMA200.toFixed(2)}` : "—"}
                  </div>
                </div>

                <div
                  style={{
                    border: "1px solid rgba(255,255,255,0.10)",
                    borderRadius: 14,
                    padding: 16,
                    background: "rgba(255,255,255,0.03)",
                  }}
                >
                  <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 8 }}>Timestamp</div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>
                    {quote?.date && quote?.time ? `${quote.date} ${quote.time}` : "Unavailable"}
                  </div>
                </div>
              </div>

              <h2 style={{ marginTop: 28, fontSize: 24, fontWeight: 850 }}>
                Technical Summary
              </h2>

              <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
                {summary}
              </p>

              <h2 style={{ marginTop: 28, fontSize: 24, fontWeight: 850 }}>
                Use the Full Dashboard
              </h2>

              <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
                For a deeper view of {symbol}, open the full dashboard to explore
                technical indicators, timeframe controls, benchmarks, and related market news.
              </p>

              <div style={{ marginTop: 18 }}>
                <Link
                  href={`/?symbol=${encodeURIComponent(symbol)}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "12px 16px",
                    borderRadius: 14,
                    background:
                      "linear-gradient(135deg, rgba(59,130,246,0.28), rgba(59,130,246,0.12))",
                    border: "1px solid rgba(59,130,246,0.50)",
                    color: "#f1f5f9",
                    textDecoration: "none",
                    fontWeight: 900,
                  }}
                >
                  Open {symbol} in Dashboard →
                </Link>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
