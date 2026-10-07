import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import DashboardClient, {
  type Quote,
  type Point,
  type BenchPayload,
  type NewsPayload,
  type StockEarningsSummary,
} from "../components/DashboardClient";
import StockPagesBottomNav from "@/app/components/StockPagesBottomNav";
import { getCachedDailyHistory, getDailyHistory } from "@/lib/server/historyCache";
import { historyForSurface, historyOnTiingo } from "@/lib/server/tiingoHistory";
import { TIINGO_CREDIT, TIINGO_URL } from "@/lib/server/tiingoSurfacePrice";
import { getBenchmarksData } from "@/lib/server/benchmarksBuilder";
import { fetchQuoteSnapshot } from "@/lib/server/quoteData";
import { mintQuoteToken } from "@/lib/server/quoteToken";
import { secEarningsSummary } from "@/lib/server/secEarningsSummary";
import { getInternalNewsPayload } from "@/lib/server/internalNews";
import { cleanSymbol, SYMBOL_COOKIE } from "@/lib/symbol";
import { priceProviderFor } from "@/lib/server/marketData/provider";
import { DASHBOARD_SOURCE_BUDGET_MS, withBudget } from "@/lib/server/sourceBudget";
import { EMPTY_LANDING, getDashboardLanding } from "@/lib/server/dashboardCards";
import { LANDING_CSS, LandingCards, MarketNow } from "./DashboardLanding";
import { filedEarningsGate } from "@/lib/server/filedEarnings";

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

// THE HERO LINE AS THE TITLE (#563 COWORK #142 §2); the canonical is "/" since #149 §1 (below).
const DASHBOARD_TITLE = "Stock research from the filings, not the hype | MyStockHarbor";
const DASHBOARD_DESCRIPTION =
  "Every figure traced to the SEC filing or the price it came from, and every chart explained in plain English: supply chains, capex flows, screens and a full stock analyser.";
export const metadata: Metadata = {
  title: DASHBOARD_TITLE,
  description: DASHBOARD_DESCRIPTION,
  // "/" SERVES THIS SAME PAGE (#563 COWORK #149 §1), so this URL points at it:
  // the homepage keeps its own title, description and structured data and is
  // the one canonical copy.
  alternates: {
    canonical: "https://www.mystockharbor.com/",
  },
  openGraph: {
    title: DASHBOARD_TITLE,
    description: DASHBOARD_DESCRIPTION,
    url: "https://www.mystockharbor.com/",
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
        priceLabel: q.priceLabel ?? null,
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
    // ONLY THE FIELDS THE CLIENT READS. The whole object used to be passed as
    // a prop, which serialises it into the page's RSC payload -- including
    // FMP's `nextEarningsDate`, an exact next-report day that nothing on this
    // page renders and that the owner's 2026-09-23 ruling keeps off the site.
    //
    // AND FROM SEC SINCE 2026-09-23 (#535 COWORK #18 §3): the stock page's own
    // snapshot verdict, not a second score built on FMP's /stable/earnings.
    return await secEarningsSummary(symbol);
  } catch {
    return null;
  }
}

export default async function DashboardPage({ searchParams }: Props) {
  const params = await searchParams;
  const requested = cleanSymbol(params?.symbol);

  // The remembered symbol, resolved BEFORE rendering so the HTML this sends is
  // already the one the client will want -- which is the entire point: without
  // it the server rendered SPY, the client hydrated to the remembered symbol,
  // and all five payloads below were fetched, discarded and fetched again.
  //
  // cookies() IS DELIBERATELY CONFINED TO THIS FILE. Reading it opts the route
  // out of static rendering, so every module that calls it drags whatever
  // imports it dynamic too. /dashboard is already dynamic and always will be --
  // the rendered symbol is per-visitor, which is the trade accepted when the
  // "Resume" affordance was rejected (#294) -- so the cost is already paid
  // HERE and nowhere else. Read it in a shared helper or a layout and that
  // stops being true silently. If another route ever needs this, give it its
  // own cookies() call rather than reaching for a shared one.
  //
  // The response therefore varies by cookie. Next sets no Vary: Cookie header
  // for this, and does not need to: the route is dynamic, so it is rendered
  // per request and never served from a shared cache. Should /dashboard ever
  // be made cacheable, THIS is the line that makes that unsafe.
  const remembered = cleanSymbol((await cookies()).get(SYMBOL_COOKIE)?.value);

  // An explicit ?symbol= outranks the memory, which outranks the default.
  const symbol = requested || remembered || "SPY";

  // A BUDGET PER SOURCE (#553 CODE-B #137, COWORK #145/#146). These five used
  // to share one unbounded Promise.all, so a single read that never answered
  // (our Upstash client has no request timeout) held the render to Vercel's
  // 300 s limit -- ~3.5% of cold renders in the 24 h before this. Each source
  // now resolves to its own "missing" value after DASHBOARD_SOURCE_BUDGET_MS,
  // the page renders the other four, and one log line names the source and
  // symbol. See lib/server/sourceBudget.ts.
  const budget = <T,>(source: string, work: Promise<T>, fallback: T) =>
    withBudget("dashboard", source, symbol, work, fallback, DASHBOARD_SOURCE_BUDGET_MS);

  const [rawHistory, quoteAndName, benchmarks, news, earningsSummary, landing] =
    await Promise.all([
      // STEP 3 (#553 COWORK #71 row 3), behind PRICE_PROVIDER_HISTORY, the same
      // gate as /api/history, which this chart calls on every timeframe change:
      // one provider for the seed and the refetches (lib/server/tiingoHistory.ts).
      //
      // NO KEY, CACHE ONLY (COWORK #146): with FMP_API_KEY unset the FMP path
      // can only ever serve what is cached, so it reads the cache and stops.
      // getDailyHistory would otherwise, on a miss, take or lose the history
      // lock and poll up to 12 s for a fetch that cannot happen.
      budget(
        "history",
        historyForSurface("HISTORY", symbol, () =>
          process.env.FMP_API_KEY
            ? getDailyHistory(symbol, { caller: "dashboard" })
            : getCachedDailyHistory(symbol, "dashboard")
        ).then(
          (h) => ({ points: h.points as Point[], provider: h.provider as string }),
          () => ({ points: [] as Point[], provider: "none" })
        ),
        { points: [] as Point[], provider: "none" }
      ),
      budget("quote", getInitialQuoteAndName(symbol), { quote: null, name: "" }),
      budget("benchmarks", getInitialBenchmarks(), null),
      budget("news", getInitialNews(symbol), null),
      budget("earnings", getInitialEarningsSummary(symbol), null),
      // THE LANDING (#563 COWORK #134): "Market right now" and the cards, one
      // Data Cache entry for every visitor (15 min; lib/server/dashboardCards.ts).
      // Not per symbol. A miss renders every card's empty state, never a failure.
      budget("landing", getDashboardLanding().catch(() => EMPTY_LANDING), EMPTY_LANDING),
    ]);

  const initialHistory: Point[] = Array.isArray(rawHistory.points) ? rawHistory.points : [];
  const { quote: initialQuote, name: initialSymbolName } = quoteAndName;

  // STEP 4 (#553 COWORK #71/#92): the linked credit, rendered here and handed
  // down, shown by the client beside any figure that came from Tiingo (a quote
  // with a priceLabel, a benchmark payload with provider "tiingo").
  // Step 5 (#553 COWORK #98): also when the ticker's movers are Tiingo's (POOL).
  const tiingoCredit =
    priceProviderFor("STOCK_PAGE") === "tiingo" || priceProviderFor("POOL") === "tiingo" ? (
      <a href={TIINGO_URL} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>{TIINGO_CREDIT}</a>
    ) : null;

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
          tiingoCredit={tiingoCredit}
          // Step 3 (#553 COWORK #71/#92/#103): the linked credit under the
          // chart, handed down while the gate is on (the client swaps symbols
          // and timeframes through /api/history, which follows the same gate).
          // The client shows it only beside a series whose provider is
          // "tiingo": the seed's below, then each refetch's.
          historyCredit={
            historyOnTiingo("HISTORY") ? (
              <a href={TIINGO_URL} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>{TIINGO_CREDIT}</a>
            ) : null
          }
          initialHistoryProvider={rawHistory.provider}
          // Proves to /api/quote that this client rendered a real page. Empty
          // string when QUOTE_TOKEN_SECRET is unset, in which case the client
          // sends no header and behaviour is unchanged. Session-scoped, not
          // symbol-scoped, precisely because chooseSymbol() swaps symbols here
          // without a reload. See lib/server/quoteToken.ts.
          pageToken={mintQuoteToken()}
          landing={{
            market: <MarketNow m={landing.market} />,
            cards: <LandingCards c={landing.cards} hasFiledEarnings={await filedEarningsGate()} />,
            mapped: landing.market.mapped,
            bottlenecks: landing.bottlenecks,
            css: LANDING_CSS,
          }}
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
