import type { Metadata } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import DashboardClient, {
  type Quote,
  type Point,
  type BenchPayload,
  type NewsPayload,
  type StockEarningsSummary,
} from "../components/DashboardClient";
import { getDailyHistory } from "@/lib/server/historyCache";
import { getBenchmarksData } from "@/lib/server/benchmarksBuilder";
import { fetchQuoteSnapshot } from "@/lib/server/quoteData";
import { getLatestEarningsData } from "@/lib/latest-earnings-data";

// Was a plain client-rendered shell (Suspense fallback "Loading dashboard…"
// with no real content until client effects fetched everything). Now fetches
// the same data DashboardClient would otherwise only load client-side --
// quote, price history, market benchmarks, headline briefing, earnings tone
// -- for the default symbol (SPY, or whatever ?symbol= is in the URL) and
// passes it down as initial props, matching the SSR pattern already used on
// /pickers, /plays and /stock/[symbol]. DashboardClient seeds its state from
// these props and skips its own first-mount fetch when they match the
// symbol it lands on, so this adds no new FMP calls -- the same requests
// were always going to happen from the client on first load; they're just
// made once, here, on the server, instead.
//
// Quote, benchmarks and earnings are all read IN-PROCESS (fetchQuoteSnapshot,
// getBenchmarksData, getLatestEarningsData) rather than via an HTTP
// self-fetch to /api/quote / /api/benchmarks / /api/stock-earnings: those
// routes are now BotID-guarded, and a server-to-server self-fetch carries no
// browser BotID header, so it would otherwise itself read as bot traffic and
// get 403'd -- the same self-fetch-gets-blocked failure mode already
// documented as a past production outage in
// claude/pickers-firewall-selfblock-2026-07-17.md and, for the quote +
// earnings self-fetches specifically that used to live here, in
// claude/stock-page-earnings-selfblock-2026-07-21.md. Each in-process
// function is the same one its public API route calls internally, so the
// public endpoint and this server-rendered path always return identically
// shaped data. /api/internal-news is NOT BotID-guarded, so it's left as a
// plain self-fetch below.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Stock Chart Dashboard | MyStockHarbor",
  description:
    "Interactive stock chart dashboard with technical indicators, stock pickers, market benchmarks and news briefings. Analyse any stock with MA, RSI, MACD and more.",
  alternates: {
    canonical: "https://www.mystockharbor.com/dashboard",
  },
  openGraph: {
    title: "Stock Chart Dashboard | MyStockHarbor",
    description:
      "Interactive stock charts with technical indicators, pickers and market benchmarks.",
    url: "https://www.mystockharbor.com/dashboard",
    siteName: "MyStockHarbor",
    type: "website",
  },
};

type Props = {
  searchParams: Promise<{ symbol?: string | string[] }>;
};

async function getOriginFromHeaders() {
  const headerStore = await headers();
  const host =
    headerStore.get("x-forwarded-host") ||
    headerStore.get("host") ||
    "www.mystockharbor.com";
  const proto =
    headerStore.get("x-forwarded-proto") ||
    (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function cleanSymbolParam(value?: string | string[]) {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

async function fetchJson<T = Record<string, unknown>>(
  url: string,
  init: RequestInit
): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function getInitialBenchmarks(): Promise<BenchPayload | null> {
  try {
    const { data, status } = await getBenchmarksData("stock");
    if (status && status >= 400) return null;
    return data as unknown as BenchPayload;
  } catch {
    return null;
  }
}

async function getInitialQuoteAndName(
  symbol: string
): Promise<{ quote: Quote | null; name: string }> {
  try {
    const q = await fetchQuoteSnapshot(symbol);
    if (q.price == null) return { quote: null, name: "" };
    return {
      quote: {
        symbol: q.symbol || symbol,
        price: q.price,
        date: q.date,
        time: q.time,
        source: q.source,
      },
      name: q.name ?? "",
    };
  } catch {
    return { quote: null, name: "" };
  }
}

async function getInitialEarningsSummary(
  symbol: string
): Promise<StockEarningsSummary | null> {
  try {
    return (await getLatestEarningsData(symbol, "yellow")) as unknown as StockEarningsSummary;
  } catch {
    return null;
  }
}

export default async function DashboardPage({ searchParams }: Props) {
  const params = await searchParams;
  const requested = cleanSymbolParam(params?.symbol);
  const symbol = requested || "SPY";
  const origin = await getOriginFromHeaders();

  const [rawHistory, quoteAndName, benchmarks, news, earningsSummary] =
    await Promise.all([
      getDailyHistory(symbol).catch(() => [] as Point[]),
      getInitialQuoteAndName(symbol),
      getInitialBenchmarks(),
      fetchJson<NewsPayload>(
        `${origin}/api/internal-news?symbol=${encodeURIComponent(symbol)}`,
        { next: { revalidate: 900 } }
      ),
      getInitialEarningsSummary(symbol),
    ]);

  const initialHistory: Point[] = Array.isArray(rawHistory) ? rawHistory : [];
  const { quote: initialQuote, name: initialSymbolName } = quoteAndName;

  return (
    <Suspense
      fallback={
        <div style={{ padding: 40, fontFamily: "system-ui, Arial" }}>
          Loading dashboard…
        </div>
      }
    >
      <DashboardClient
        defaultSymbol={symbol}
        initialQuote={initialQuote}
        initialHistory={initialHistory}
        initialSymbolName={initialSymbolName}
        initialBenchmarks={benchmarks}
        initialNews={news}
        initialEarningsSummary={earningsSummary}
      />
    </Suspense>
  );
}
