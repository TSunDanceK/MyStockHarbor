"use client";

import React, { useEffect, useMemo, useState } from "react";
import PriceChart, { type Overlay } from "./PriceChart";

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

type SymbolResult = { symbol: string; name: string; exchange: string };

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

function rollingStd(values: number[], window: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  for (let i = window - 1; i < values.length; i++) {
    let mean = 0;
    for (let j = i - window + 1; j <= i; j++) mean += values[j];
    mean /= window;

    let variance = 0;
    for (let j = i - window + 1; j <= i; j++) {
      const d = values[j] - mean;
      variance += d * d;
    }
    variance /= window;

    out[i] = Math.sqrt(variance);
  }
  return out;
}

function bollinger(values: number[], window = 20, k = 2) {
  const mid = movingAverage(values, window);
  const sd = rollingStd(values, window);
  const upper = mid.map((m, i) => (m == null || sd[i] == null ? null : m + k * sd[i]!));
  const lower = mid.map((m, i) => (m == null || sd[i] == null ? null : m - k * sd[i]!));
  return { upper, mid, lower };
}

function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length === 0) return out;

  const k = 2 / (period + 1);

  let emaPrev: number | null = null;
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];

    if (i < period) {
      sum += v;
      if (i === period - 1) {
        emaPrev = sum / period;
        out[i] = emaPrev;
      }
      continue;
    }

    emaPrev = emaPrev == null ? v : v * k + emaPrev * (1 - k);
    out[i] = emaPrev;
  }

  return out;
}

function rsiWilder(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length < period + 1) return out;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss += -diff;
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  out[period] = 100 - 100 / (1 + rs0);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;

    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }

  return out;
}

function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);

  const line: (number | null)[] = values.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    if (typeof f !== "number" || typeof s !== "number") return null;
    return f - s;
  });

  const lineForEma = line.map((v) => (typeof v === "number" ? v : 0));
  const sigAll = ema(lineForEma, signal);

  const sig: (number | null)[] = sigAll.map((v, i) => (line[i] == null ? null : v));
  const hist: (number | null)[] = line.map((v, i) => (v == null || sig[i] == null ? null : v - sig[i]!));

  return { line, signal: sig, hist };
}

function vwapFromPoints(points: Point[]): (number | null)[] {
  const out: (number | null)[] = Array(points.length).fill(null);
  let cumPV = 0;
  let cumV = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const v = typeof p.volume === "number" && Number.isFinite(p.volume) ? p.volume : null;
    if (v == null || v <= 0) {
      out[i] = cumV > 0 ? cumPV / cumV : null;
      continue;
    }

    const h = typeof p.high === "number" && Number.isFinite(p.high) ? p.high : null;
    const l = typeof p.low === "number" && Number.isFinite(p.low) ? p.low : null;

    const typical =
      h != null && l != null ? (h + l + p.close) / 3 : p.close;

    cumPV += typical * v;
    cumV += v;

    out[i] = cumPV / cumV;
  }

  return out;
}

function stochastic(points: Point[], kPeriod = 14, dPeriod = 3) {
  const k: (number | null)[] = Array(points.length).fill(null);

  for (let i = 0; i < points.length; i++) {
    if (i < kPeriod - 1) continue;

    let highestHigh = -Infinity;
    let lowestLow = Infinity;

    for (let j = i - kPeriod + 1; j <= i; j++) {
      const hh = points[j].high;
      const ll = points[j].low;
      if (typeof hh !== "number" || !Number.isFinite(hh)) {
        highestHigh = NaN;
        break;
      }
      if (typeof ll !== "number" || !Number.isFinite(ll)) {
        lowestLow = NaN;
        break;
      }
      if (hh > highestHigh) highestHigh = hh;
      if (ll < lowestLow) lowestLow = ll;
    }

    if (!Number.isFinite(highestHigh) || !Number.isFinite(lowestLow)) continue;

    const denom = highestHigh - lowestLow;
    if (denom <= 0) continue;

    k[i] = ((points[i].close - lowestLow) / denom) * 100;
  }

  // %D = SMA of %K
  const d = movingAverage(k.map((v) => (typeof v === "number" ? v : 0)), dPeriod).map((v, i) =>
    k[i] == null ? null : v
  );

  return { k, d };
}

function atr(points: Point[], period = 14): (number | null)[] {
  const tr: (number | null)[] = Array(points.length).fill(null);

  for (let i = 0; i < points.length; i++) {
    const h = points[i].high;
    const l = points[i].low;
    const cPrev = i > 0 ? points[i - 1].close : null;

    if (typeof h !== "number" || !Number.isFinite(h)) continue;
    if (typeof l !== "number" || !Number.isFinite(l)) continue;

    const hl = h - l;
    const hc = cPrev == null ? hl : Math.abs(h - cPrev);
    const lc = cPrev == null ? hl : Math.abs(l - cPrev);

    tr[i] = Math.max(hl, hc, lc);
  }

  const out: (number | null)[] = Array(points.length).fill(null);

  // Wilder smoothing
  let sum = 0;
  let count = 0;
  let prevATR: number | null = null;

  for (let i = 0; i < points.length; i++) {
    const v = tr[i];

    if (v == null) {
      out[i] = prevATR;
      continue;
    }

    if (prevATR == null) {
      // seed with SMA of first "period" TR values (that exist)
      sum += v;
      count++;
      if (count === period) {
        prevATR = sum / period;
        out[i] = prevATR;
      }
      continue;
    }

    prevATR = (prevATR * (period - 1) + v) / period;
    out[i] = prevATR;
  }

  return out;
}

function valuationSignal(lastPrice: number | null, ma200Last: number | null) {
  if (lastPrice === null || ma200Last === null) {
    return { label: "Signal unavailable", detail: "Need enough data for MA200." };
  }

  const diff = (lastPrice - ma200Last) / ma200Last;

  if (diff <= -0.05) {
    return { label: "Undervalued-ish 🟢", detail: `Price is ${Math.abs(diff * 100).toFixed(1)}% below MA200.` };
  }
  if (diff < 0.05) {
    return { label: "Fair-ish 🟡", detail: `Price is ${Math.abs(diff * 100).toFixed(1)}% from MA200.` };
  }
  return { label: "Overextended 🔴", detail: `Price is ${(diff * 100).toFixed(1)}% above MA200.` };
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
  { symbol: "XOM", name: "Exxon Mobil Corp." },
].sort((a, b) => a.symbol.localeCompare(b.symbol));

const TIMEFRAMES: { label: string; days: number }[] = [
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1D", days: 1 },
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "1Y", days: 365 },
  { label: "3Y", days: 365 * 3 },
  { label: "5Y", days: 365 * 5 },
];

const INDICATORS: Overlay[] = [
  "None",
  "MA50",
  "MA200",
  "Bollinger(20,2)",
  "RSI(14)",
  "MACD(12,26,9)",
  "EMA20",
  "VWAP",
  "Stochastic(14,3)",
  "ATR(14)",
  "Volume",
];

export default function DashboardClient({ defaultSymbol = "AAPL" }: { defaultSymbol?: string }) {
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [tfDays, setTfDays] = useState(365);
  const [indicator, setIndicator] = useState<Overlay>("None");

  const [quote, setQuote] = useState<Quote | null>(null);
  const [historyAll, setHistoryAll] = useState<Point[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SymbolResult[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      try {
        const historyDays = Math.max(tfDays, 2600);

        const [qRes, hRes] = await Promise.all([
          fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" }),
          fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&days=${historyDays}`, { cache: "no-store" }),
        ]);

        if (!qRes.ok) throw new Error("Quote fetch failed");
        if (!hRes.ok) throw new Error("History fetch failed");

        const q = (await qRes.json()) as Quote;
        const h = (await hRes.json()) as { symbol: string; points: any[] };

        if (cancelled) return;

        const ptsRaw = Array.isArray(h.points) ? h.points : [];
        const pts: Point[] = ptsRaw
          .map((p: any) => ({
            date: String(p?.date ?? ""),
            close: Number(p?.close),
            high: p?.high == null ? undefined : Number(p.high),
            low: p?.low == null ? undefined : Number(p.low),
            volume: p?.volume == null ? undefined : Number(p.volume),
          }))
          .filter((p) => p.date && Number.isFinite(p.close));

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

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }

    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/symbols?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        const data = (await res.json()) as { results: SymbolResult[] };
        if (cancelled) return;
        setResults(Array.isArray(data.results) ? data.results : []);
      } catch {
        if (cancelled) return;
        setResults([]);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const displayedHistory = useMemo(() => historyAll.slice(-tfDays), [historyAll, tfDays]);

  const closesAll = useMemo(() => historyAll.map((p) => p.close), [historyAll]);

  const ma50Full = useMemo(() => movingAverage(closesAll, 50), [closesAll]);
  const ma200Full = useMemo(() => movingAverage(closesAll, 200), [closesAll]);

  const ema20Full = useMemo(() => ema(closesAll, 20), [closesAll]);
  const bbFull = useMemo(() => bollinger(closesAll, 20, 2), [closesAll]);
  const rsi14Full = useMemo(() => rsiWilder(closesAll, 14), [closesAll]);
  const macdFull = useMemo(() => macd(closesAll, 12, 26, 9), [closesAll]);

  const vwapFull = useMemo(() => vwapFromPoints(historyAll), [historyAll]);
  const stochFull = useMemo(() => stochastic(historyAll, 14, 3), [historyAll]);
  const atr14Full = useMemo(() => atr(historyAll, 14), [historyAll]);

  const ma50 = useMemo(() => ma50Full.slice(-tfDays), [ma50Full, tfDays]);
  const ma200 = useMemo(() => ma200Full.slice(-tfDays), [ma200Full, tfDays]);

  const ema20 = useMemo(() => ema20Full.slice(-tfDays), [ema20Full, tfDays]);

  const bollUpper = useMemo(() => bbFull.upper.slice(-tfDays), [bbFull, tfDays]);
  const bollMid = useMemo(() => bbFull.mid.slice(-tfDays), [bbFull, tfDays]);
  const bollLower = useMemo(() => bbFull.lower.slice(-tfDays), [bbFull, tfDays]);

  const rsi14 = useMemo(() => rsi14Full.slice(-tfDays), [rsi14Full, tfDays]);

  const macdLine = useMemo(() => macdFull.line.slice(-tfDays), [macdFull, tfDays]);
  const macdSignal = useMemo(() => macdFull.signal.slice(-tfDays), [macdFull, tfDays]);
  const macdHist = useMemo(() => macdFull.hist.slice(-tfDays), [macdFull, tfDays]);

  const vwap = useMemo(() => vwapFull.slice(-tfDays), [vwapFull, tfDays]);
  const volume = useMemo(() => displayedHistory.map((p) => (typeof p.volume === "number" ? p.volume : null)), [displayedHistory]);
  const stochK = useMemo(() => stochFull.k.slice(-tfDays), [stochFull, tfDays]);
  const stochD = useMemo(() => stochFull.d.slice(-tfDays), [stochFull, tfDays]);
  const atr14 = useMemo(() => atr14Full.slice(-tfDays), [atr14Full, tfDays]);

  const lastClose = displayedHistory.length ? displayedHistory[displayedHistory.length - 1].close : null;
  const lastMA50 = ma50.length ? ma50[ma50.length - 1] : null;
  const lastMA200 = ma200.length ? ma200[ma200.length - 1] : null;

  const signal = useMemo(() => valuationSignal(lastClose, lastMA200), [lastClose, lastMA200]);

  function chooseSymbol(s: string) {
    const cleaned = s.trim().toUpperCase();
    if (!cleaned) return;
    setSymbol(cleaned);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  return (
    <main style={{ padding: 40, fontFamily: "system-ui, Arial" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>My Stock Dashboard</h1>
      <p style={{ marginTop: 0, opacity: 0.7 }}>Version 1 – Learning Build (free data)</p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 16 }}>
        <label style={{ fontWeight: 600 }}>Ticker</label>

        <select
          value={symbol}
          onChange={(e) => chooseSymbol(e.target.value)}
          style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #3333" }}
        >
          {PRESET_TICKERS.map((t) => (
            <option key={t.symbol} value={t.symbol}>
              {t.symbol} – {t.name}
            </option>
          ))}
        </select>

        <label style={{ fontWeight: 600, marginLeft: 8 }}>Indicator</label>
        <select
          value={indicator}
          onChange={(e) => setIndicator(e.target.value as any)}
          style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #3333" }}
        >
          {INDICATORS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>

        <span style={{ opacity: 0.6 }}>or</span>

        <div style={{ position: "relative" }}>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Enter") chooseSymbol(query);
            }}
            placeholder="Search ticker or company"
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #3333",
              width: 360,
            }}
          />

          {open && results.length > 0 ? (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0,
                right: 0,
                border: "1px solid #3333",
                borderRadius: 12,
                background: "#fff",
                color: "#111",
                overflow: "hidden",
                zIndex: 9999,
                boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
                maxHeight: 340,
                overflowY: "auto",
              }}
            >
              {results.map((r) => (
                <button
                  key={`${r.symbol}-${r.exchange}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => chooseSymbol(r.symbol)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>
                    {r.symbol} <span style={{ fontWeight: 500, opacity: 0.7 }}>({r.exchange})</span>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>{r.name}</div>
                </button>
              ))}
            </div>
          ) : null}
        </div>

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
                <strong>Last price:</strong> {quote?.price == null ? "Unavailable" : `$${quote.price.toFixed(2)}`}
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
          <PriceChart
            data={displayedHistory}
            ma50={ma50}
            ma200={ma200}
            overlay={indicator}
            bollUpper={bollUpper}
            bollMid={bollMid}
            bollLower={bollLower}
            ema20={ema20}
            rsi14={rsi14}
            macdLine={macdLine}
            macdSignal={macdSignal}
            macdHist={macdHist}
            vwap={vwap}
            volume={volume}
            stochK={stochK}
            stochD={stochD}
            atr14={atr14}
          />
        </div>
      </div>
    </main>
  );
}
