import type { Metadata } from "next";
import { Suspense } from "react";
import DashboardClient, {
  type Quote,
  type Point,
  type BenchPayload,
  type NewsPayload,
  type StockEarningsSummary,
} from "../components/DashboardClient";
import StockPagesBottomNav from "@/app/components/StockPagesBottomNav";
import { getDailyHistory } from "@/lib/server/historyCache";
import { getBenchmarksData } from "@/lib/server/benchmarksBuilder";
import { fetchQuoteSnapshot } from "@/lib/server/quoteData";
import { mintQuoteToken } from "@/lib/server/quoteToken";
import { getLatestEarningsData } from "@/lib/latest-earnings-data";
import { getInternalNewsPayload } from "@/lib/server/internalNews";
import { cleanSymbol } from "@/lib/symbol";

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
// shaped data.
//
// The news payload was the last exception -- it used to be a plain HTTP
// self-fetch to /api/internal-news, kept because that route is not
// BotID-guarded. It is now read in-process too, via getInternalNewsPayload().
// See lib/server/internalNews.ts for what that self-fetch was costing (an
// extra serverless invocation per render, an edge round-trip, and the only
// remaining headers() call on this route).
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

async function getInitialNews(symbol: string): Promise<NewsPayload | null> {
  try {
    return await getInternalNewsPayload(symbol);
  } catch {
    return null;
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
  const requested = cleanSymbol(params?.symbol);
  const symbol = requested || "SPY";

  const [rawHistory, quoteAndName, benchmarks, news, earningsSummary] =
    await Promise.all([
      getDailyHistory(symbol).catch(() => [] as Point[]),
      getInitialQuoteAndName(symbol),
      getInitialBenchmarks(),
      getInitialNews(symbol),
      getInitialEarningsSummary(symbol),
    ]);

  const initialHistory: Point[] = Array.isArray(rawHistory) ? rawHistory : [];
  const { quote: initialQuote, name: initialSymbolName } = quoteAndName;

  return (
    <>
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
          // Proves to /api/quote that this client rendered a real page. Empty
          // string when QUOTE_TOKEN_SECRET is unset, in which case the client
          // sends no header and behaviour is unchanged. Session-scoped, not
          // symbol-scoped, precisely because chooseSymbol() swaps symbols here
          // without a reload. See lib/server/quoteToken.ts.
          pageToken={mintQuoteToken()}
        />
      </Suspense>

      {/* The fourth item of the bar the three /stock/[symbol] routes mount
          from their shared layout. Deliberately OUTSIDE the Suspense
          boundary: the fallback replaces everything inside it, and a nav bar
          that vanishes while the dashboard is still resolving is worse than
          one that is simply always there. It takes no props -- it reads the
          ticker from msh_last_symbol, which DashboardClient writes on every
          symbol change. */}
      <StockPagesBottomNav />
    </>
  );
}
