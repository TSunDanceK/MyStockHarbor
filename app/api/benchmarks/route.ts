// app/api/benchmarks/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type BenchItem = {
  key: "sp500" | "nasdaq";
  label: string;
  symbol: string;
  date: string | null;
  time: string | null;
  close: number | null;
  prevClose: number | null;
  changePct: number | null;
  source: string;
};

type BenchPayload = {
  updatedAt: string;
  scope: string;
  items: BenchItem[];
};

const CACHE_MS = 60_000; // 1 min
let cache: { at: number; payload: BenchPayload } | null = null;

function toNum(x: unknown): number | null {
  const n = typeof x === "string" ? Number(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) ? n : null;
}

// Quote CSV: https://stooq.com/q/l/?s=SPY&f=sd2t2ohlcv&h&e=csv
async function fetchStooqQuote(symbol: string): Promise<{ date: string | null; time: string | null; close: number | null }> {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return { date: null, time: null, close: null };

  const text = await res.text();
  const lines = text.trim().split("\n");
  if (lines.length < 2) return { date: null, time: null, close: null };

  const header = lines[0].split(",").map((s) => s.trim().toLowerCase());
  const row = lines[1].split(",").map((s) => s.trim());

  const idx = (k: string) => header.indexOf(k);

  const date = row[idx("date")] ?? null;
  const time = row[idx("time")] ?? null;
  const close = toNum(row[idx("close")]);

  return { date, time, close };
}

// History CSV: https://stooq.com/q/d/l/?s=SPY&i=d
async function fetchPrevClose(symbol: string): Promise<number | null> {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;

  const text = await res.text();
  const lines = text.trim().split("\n");
  if (lines.length < 3) return null; // header + at least 2 rows

  const header = lines[0].split(",").map((s) => s.trim().toLowerCase());
  const idxClose = header.indexOf("close");
  if (idxClose === -1) return null;

  const prev = lines[lines.length - 2].split(","); // previous day row
  return toNum(prev[idxClose]) ?? null;
}

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json(cache.payload);
  }

  // ✅ Use liquid ETFs (more reliable on Stooq than ^SPX/^NDX)
  const defs = [
    { key: "sp500" as const, label: "S&P 500 (via SPY)", symbol: "SPY" },
    { key: "nasdaq" as const, label: "Nasdaq 100 (via QQQ)", symbol: "QQQ" },
  ];

  try {
    const [spyQ, qqqQ, spyPrev, qqqPrev] = await Promise.all([
      fetchStooqQuote("SPY"),
      fetchStooqQuote("QQQ"),
      fetchPrevClose("SPY"),
      fetchPrevClose("QQQ"),
    ]);

    const items: BenchItem[] = [
      {
        key: "sp500",
        label: "S&P 500 (via SPY)",
        symbol: "SPY",
        date: spyQ.date,
        time: spyQ.time,
        close: spyQ.close,
        prevClose: spyPrev,
        changePct:
          spyQ.close != null && spyPrev != null && spyPrev > 0 ? ((spyQ.close - spyPrev) / spyPrev) * 100 : null,
        source: "stooq.com",
      },
      {
        key: "nasdaq",
        label: "Nasdaq 100 (via QQQ)",
        symbol: "QQQ",
        date: qqqQ.date,
        time: qqqQ.time,
        close: qqqQ.close,
        prevClose: qqqPrev,
        changePct:
          qqqQ.close != null && qqqPrev != null && qqqPrev > 0 ? ((qqqQ.close - qqqPrev) / qqqPrev) * 100 : null,
        source: "stooq.com",
      },
    ];

    const payload: BenchPayload = {
      updatedAt: new Date().toISOString(),
      scope: "Benchmarks (Stooq, free)",
      items,
    };

    cache = { at: Date.now(), payload };
    return NextResponse.json(payload);
  } catch {
    const payload: BenchPayload = {
      updatedAt: new Date().toISOString(),
      scope: "Benchmarks (Stooq, free)",
      items: [],
    };
    return NextResponse.json(payload);
  }
}
