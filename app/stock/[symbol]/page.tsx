// app/stock/[symbol]/page.tsx
import type { Metadata } from "next";
import { fmpFetch } from "@/lib/server/fmpUsage";
import { toDashed } from "@/lib/symbolSpellings.mjs";
import { getDailyHistory } from "@/lib/server/historyCache";
import { searchSymbols } from "@/lib/server/symbolSearch";
import {
  getStockPageSecFacts,
  type SecEarningsSnapshot,
} from "@/lib/server/secEarningsSnapshot";
import type { ProfileDividend } from "@/lib/server/secDividend";
import type { StockPageProfileFacts } from "@/lib/server/secEarningsSnapshot";
import { readCachedFundamentalsBulk } from "@/lib/server/fundamentalsCache";
import { classificationAsOf, resolveProfile } from "@/lib/server/staticProfile";
import { getCompanyNameMap } from "@/lib/server/companyNames";
import { snapshotCompanyName } from "@/lib/server/companyNameSnapshot";
import { composeCompanyProfile, exchangeFor, registrantFor } from "@/lib/server/stockProfile";
import { filingDescriptionFor } from "@/lib/server/filingDescription";
import {
  REFUSAL_WORDS, valuationMultiples, type MultipleInputs, type ValuationFigure, type ValuationInputs,
} from "@/lib/server/secValuation";
import { symbolSpellings } from "@/lib/symbolSpellings.mjs";
import type { CompanyProfile } from "@/app/components/CompanyProfile";
import type { DilutionHistoryData } from "@/app/components/DilutionHistory";
import {
  computeIndicatorSeed,
  buildSeoTitle,
  buildSeoDescription,
  type IndicatorSeed,
  type Point,
} from "@/lib/indicators";
import { mintQuoteToken } from "@/lib/server/quoteToken";
import Link from "next/link";
import { getRelatedSymbols } from "@/lib/curatedSymbols";
import RelatedStocks from "@/app/components/RelatedStocks";
import StockSymbolPageClient, { type InitialQuote } from "./StockSymbolPageClient";

type Props = {
  params: Promise<{ symbol: string }>;
};

// ── Server-side data fetching ────────────────────────────────────────────────

// Fetches the FMP stable/quote payload once on the server. Beyond the
// price/date pair used for SEO + indicator seeding, this also captures the
// day range, volume vs average volume, previous close and change — all
// included in the same response — so the header "quote snapshot" can render
// real numbers in the initial HTML instead of waiting on a client refetch.
// Why fetchQuote reports an outcome as well as a quote.
//
// It used to collapse four different situations into one all-null object: no
// API key, a non-ok response, a thrown request, and FMP answering normally with
// no row for this symbol. Those are not the same thing. The first three mean we
// could not ask; the last means we asked and the answer is "this symbol has no
// data" -- which is a legitimate page, not a failure.
//
// Note what this signal does NOT support: concluding that FMP is down. One
// symbol failing is not evidence of an outage, so "unavailable" here only ever
// changes the wording on the page, never whether it renders. A real
// outage/circuit-breaker signal needs state across requests; see the note on
// the no-data branch in the page component.
type QuoteOutcome = "ok" | "no-data" | "unavailable";

// toDashed AT THE VENDOR BOUNDARY, as in lib/stock-news-data.ts's fetchFmpQuote.
// The route parameter is the reader's spelling; FMP's is the dash. Without it
// /stock/BRK.B asked FMP for "BRK.B", got the empty row, and scored the page
// "no-data" -- which reads as "this symbol has no data", the one outcome above
// that is supposed to be legitimate. The displayed symbol is left alone.
async function fetchQuote(symbol: string): Promise<{ quote: InitialQuote; outcome: QuoteOutcome }> {
  const apiKey = process.env.FMP_API_KEY;
  const empty: InitialQuote = {
    price: null,
    date: null,
    open: null,
    previousClose: null,
    change: null,
    changePercentage: null,
    dayLow: null,
    dayHigh: null,
    yearLow: null,
    yearHigh: null,
    volume: null,
    avgVolume: null,
  };
  if (!apiKey) return { quote: empty, outcome: "unavailable" };
  try {
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(
      toDashed(symbol)
    )}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fmpFetch(url, {
      next: { revalidate: 3600 },
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { quote: empty, outcome: "unavailable" };
    const json = await res.json();
    const row = Array.isArray(json) ? json[0] : json;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const price = num(row?.price);
    // A 200 with no usable row is FMP answering "nothing here for that ticker".
    const quote: InitialQuote = {
      price,
      date: price != null ? new Date().toISOString().slice(0, 10) : null,
      open: num(row?.open),
      previousClose: num(row?.previousClose),
      change: num(row?.change),
      changePercentage: num(row?.changePercentage),
      dayLow: num(row?.dayLow),
      dayHigh: num(row?.dayHigh),
      yearLow: num(row?.yearLow),
      yearHigh: num(row?.yearHigh),
      volume: num(row?.volume),
      avgVolume: num(row?.avgVolume),
    };
    return { quote, outcome: price == null ? "no-data" : "ok" };
  } catch {
    return { quote: empty, outcome: "unavailable" };
  }
}

// Calls the shared lib/server/symbolSearch.ts function IN-PROCESS instead of
// self-fetching this deployment's own /api/symbols route over HTTP. That
// route is BotID-protected, and a server-to-server self-fetch never carries
// the browser-signed header BotID checks for, so it always read as an
// unverified bot and 403'd itself -- the on-page company-name subtitle (e.g.
// "GameStop Corp." under the GME ticker) silently fell back to blank in the
// crawlable SSR HTML. Same self-block failure mode as
// claude/pickers-firewall-selfblock-2026-07-17.md and
// claude/stock-page-earnings-selfblock-2026-07-21.md.
async function fetchCompanyName(symbol: string): Promise<string> {
  try {
    const upper = symbol.toUpperCase();
    const results = await searchSymbols(upper, "");
    const exact = results.find((r) => (r.symbol ?? "").toUpperCase() === upper);
    return exact?.name ?? "";
  } catch {
    return "";
  }
}

/**
 * The sidebar earnings snapshot, from the company's own SEC filings.
 *
 * ── WHY THIS IS NO LONGER getLatestEarningsData ──────────────────────────
 * That function reads FMP's stable/earnings rows, which carry an analyst
 * estimate and a surprise beside every actual. Those estimates left with the
 * FMP licence on 2026-09-15 and /stock/[symbol]/earnings already hides them
 * (RETIRED_SOURCES in lib/server/secEarningsView.ts) — but this sidebar, one
 * click away on the same stock, was still drawing "EPS surprise" and "Revenue
 * estimate" from the same dead source. getSecEarningsSnapshot reads the stored
 * fact sets and runs the SAME scorer the full report runs, so the two cannot
 * disagree about one filing.
 *
 * NO try/catch AND NO EMPTY FALLBACK, WHICH IS THE CHANGE THAT MATTERS MOST
 * HERE. `emptyEarnings()` used to return hasStructuredData:false on any throw,
 * and this route is ISR-cached — so one transient Redis blip produced a
 * plausible-looking card reading "Structured EPS and revenue data is not
 * available for this symbol right now", and that artefact was then served to
 * every visitor and crawler for the next 15 minutes. Indistinguishable from a
 * symbol that genuinely has no filings.
 *
 * getSecEarningsSnapshot has an `available: false` branch of its own for the
 * cases that ARE a real answer (not read in yet, non-USD filer, no quarterly
 * periods), each with its own sentence. Anything else is a failure, and a
 * failure should throw: Next does not cache a render that throws, and on
 * regeneration it keeps serving the last good copy. Same reasoning as the
 * history/quote guard below.
 */
async function fetchStockPageSecFacts(symbol: string): Promise<{
  snapshot: SecEarningsSnapshot;
  dividend: ProfileDividend;
  profileFacts: StockPageProfileFacts;
}> {
  return getStockPageSecFacts(symbol);
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Fetch the FMP company profile on the SERVER so the description + fundamentals
// render into the crawlable initial HTML (real per-company content = strong
// "information gain" for indexing). Tries the stable endpoint first, then the
// legacy v3 profile; maps both field-name variants defensively.
//
// ── RETIRED 2026-09-22 (PR 3, #518): NOT CALLED. Kept, per the hidden-not-
// removed rule, as the record of what FMP's profile supplied. PR 2 composed
// every row from free sources (lib/server/stockProfile.ts); the description,
// the last field this was read for, is now the company's own annual-report
// wording (lib/server/filingDescription.ts). No FMP profile call remains on
// this page.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function fetchCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return null;
  // Route parameter in, FMP's dashed spelling out -- same rule as fetchQuote.
  // Both URLs below share `enc`, so the legacy v3 path segment converts too.
  const enc = encodeURIComponent(toDashed(symbol));
  const key = encodeURIComponent(apiKey);
  const urls = [
    `https://financialmodelingprep.com/stable/profile?symbol=${enc}&apikey=${key}`,
    `https://financialmodelingprep.com/api/v3/profile/${enc}?apikey=${key}`,
  ];
  for (const url of urls) {
    try {
      const res = await fmpFetch(url, { next: { revalidate: 60 * 60 * 24 } });
      if (!res.ok) continue;
      const json = await res.json();
      const row = Array.isArray(json) ? json[0] : json;
      if (!row || typeof row !== "object") continue;

      // FMP splits the 52-week range as "164.08-260.10".
      let rangeLow: number | null = null;
      let rangeHigh: number | null = null;
      const range = str(row.range);
      if (range) {
        const parts = range.split("-").map((p) => num(p.trim()));
        if (parts.length === 2 && parts[0] != null && parts[1] != null) {
          rangeLow = Math.min(parts[0], parts[1]);
          rangeHigh = Math.max(parts[0], parts[1]);
        }
      }

      const profile: CompanyProfile = {
        companyName: str(row.companyName),
        description: str(row.description),
        sector: str(row.sector),
        industry: str(row.industry),
        ceo: str(row.ceo),
        website: str(row.website),
        employees: num(row.fullTimeEmployees) ?? num(row.employees),
        exchange: str(row.exchangeShortName) ?? str(row.exchange),
        country: str(row.country),
        ipoDate: str(row.ipoDate),
        isin: str(row.isin),
        cusip: str(row.cusip),
        marketCap: num(row.marketCap) ?? num(row.mktCap),
        beta: num(row.beta),
        price: num(row.price),
        rangeLow,
        rangeHigh,
        lastDividend: num(row.lastDividend) ?? num(row.lastDiv),
        currency: str(row.currency),
      };

      // Only treat as usable if we actually got some substance.
      if (profile.description || profile.sector || profile.industry || profile.marketCap != null) {
        return profile;
      }
    } catch {
      // try next url
    }
  }
  return null;
}

// ── RETIRED 2026-09-22: NOT CALLED. Kept, per the hidden-not-removed rule. ──
// The share-dilution chart reads the stored SEC set now (buildShareHistory in
// lib/server/secShareHistory.ts, via getStockPageSecFacts): same concept —
// weighted-average basic shares — and it does not stop when FMP does. The
// body below is the record of the FMP read it replaced.
//
// Fetch historical shares-outstanding data on the SERVER for the "share
// dilution" chart (DilutionHistory.tsx), same SSR pattern as the company
// profile above — real data in the crawlable initial HTML, no client loading
// gate.
//
// NOTE: FMP's dedicated historical-shares-float endpoints are dead on this
// account's plan — confirmed live via a temporary diagnostic route:
//   stable/historical-shares-float          -> 404 (doesn't exist on this tier)
//   api/v3/historical/shares_float/{symbol} -> 403 (legacy endpoint, retired
//                                               for non-legacy subscribers
//                                               after Aug 31, 2025)
//   stable/shares-float                     -> 200, but only a single current
//                                               snapshot, not a history
// Instead, this pulls weightedAverageShsOut (falling back to the diluted
// figure) from each reported period on stable/income-statement — a current,
// non-legacy endpoint already used elsewhere in this codebase — which gives
// a real per-quarter (and per-year, as a fallback for sparse quarterly
// coverage) shares-outstanding series. Field names are still mapped
// defensively in case FMP changes the shape.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function fetchShareHistory(symbol: string): Promise<DilutionHistoryData | null> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return null;
  const enc = encodeURIComponent(toDashed(symbol)); // route parameter; see fetchQuote
  const key = encodeURIComponent(apiKey);
  const sources = [
    // Prefer quarterly: more datapoints, a finer-grained trend line.
    `https://financialmodelingprep.com/stable/income-statement?symbol=${enc}&period=quarter&limit=40&apikey=${key}`,
    // Fall back to annual for symbols with sparse quarterly coverage.
    `https://financialmodelingprep.com/stable/income-statement?symbol=${enc}&period=annual&limit=15&apikey=${key}`,
  ];

  type ShareRow = { date: string; shares: number };

  for (const url of sources) {
    try {
      const res = await fmpFetch(url, { next: { revalidate: 60 * 60 * 24 } });
      if (!res.ok) continue;
      const json = await res.json();
      const rows: unknown[] = Array.isArray(json) ? json : [];
      if (!rows.length) continue;

      const raw: ShareRow[] = rows
        .map((r) => {
          const row = r as Record<string, unknown>;
          const date = str(row.date);
          const shares =
            num(row.weightedAverageShsOut) ?? num(row.weightedAverageShsOutDil);
          if (!date || shares == null || shares <= 0) return null;
          return { date, shares };
        })
        .filter((r): r is ShareRow => r !== null)
        // FMP returns newest-first; normalize to ascending by date.
        .sort((a, b) => a.date.localeCompare(b.date));

      if (raw.length < 3) continue;

      // Each row is already one reported period (a quarter or a year), so
      // no further downsampling is needed — just cap at a sane number of
      // points for the SVG (last ~28 periods).
      const capped = raw.slice(-28);
      if (capped.length < 3) continue;

      return { points: capped };
    } catch {
      // try next source
    }
  }
  return null;
}

/**
 * The Valuation section's footer: SEC EDGAR, and which periods the figures
 * cover. No FMP wording — the section no longer reads FMP.
 */
function valuationSourceNote(m: MultipleInputs | null, v: ValuationInputs | null): string {
  const basis = (b: "four-quarters" | "fiscal-year", end: string) =>
    b === "four-quarters" ? `the four quarters to ${end}` : `the fiscal year to ${end}`;
  const parts: string[] = [];
  if (v?.eps) parts.push(`earnings over ${basis(v.eps.basis, v.eps.periodEnd)}`);
  if (m?.revenue) parts.push(`revenue over ${basis(m.revenue.basis, m.revenue.periodEnd)}`);
  if (m?.ebitda) parts.push(`operating income plus D&A over ${basis(m.ebitda.basis, m.ebitda.periodEnd)}`);
  if (m?.balanceSheet) parts.push(`the balance sheet at ${m.balanceSheet.asOf}`);
  return (
    "Computed from the company's own filings on SEC EDGAR and this page's share price" +
    (parts.length ? `: ${parts.join("; ")}.` : ".") +
    " A figure the filings cannot support shows —, never an estimate."
  );
}

// ── Metadata (dynamic, data-driven) ─────────────────────────────────────────

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();

  // Run history + quote in parallel; we only need these for meta generation.
  const [rawHistory, quoteResult] = await Promise.all([
    getDailyHistory(upper, { caller: "stock-page" }).catch(() => []),
    fetchQuote(upper),
  ]);
  const quote = quoteResult.quote;

  const points: Point[] = (rawHistory as Point[]).filter(
    (p) => p.date && Number.isFinite(p.close)
  );

  // Same test the page component uses to decide whether it has anything to
  // show. Kept in step with it deliberately: a page that renders the "no data"
  // state must not also be advertising itself as indexable.
  const hasData = points.length > 0 || quote.price != null;

  const seed = computeIndicatorSeed(points, "", quote.price, quote.date);
  const title = hasData ? buildSeoTitle(upper, seed) : `${upper} | No data available | MyStockHarbor`;
  const description = hasData
    ? buildSeoDescription(upper, seed)
    : `We do not currently have market data for ${upper}.`;

  return {
    title,
    description,
    robots: {
      // noindex on the no-data state so it cannot be indexed as thin content.
      // `follow` stays true: the page still links out to real stock pages, and
      // there is no reason to strand a crawler that has arrived here.
      //
      // This route is hit with a lot of junk and delisted tickers -- runtime
      // logs show ~1,519 distinct request paths, i.e. something is enumerating
      // symbols -- so this state is common, not exceptional.
      index: hasData,
      follow: true,
    },
    alternates: {
      canonical: `https://www.mystockharbor.com/stock/${upper}`,
    },
    openGraph: {
      title: `${upper} Stock Analysis | MyStockHarbor`,
      description,
      url: `https://www.mystockharbor.com/stock/${upper}`,
      siteName: "MyStockHarbor",
      type: "article",
      images: [
        {
          url: "https://www.mystockharbor.com/og-image-v2.png",
          width: 1200,
          height: 630,
          alt: "MyStockHarbor stock analysis dashboard",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${upper} Stock Analysis | MyStockHarbor`,
      description,
      images: ["https://www.mystockharbor.com/og-image-v2.png"],
    },
  };
}

// ── Page (SSR seed + AI analysis both resolved server-side) ─────────────────

export default async function StockPage({ params }: Props) {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();

  // Fetch everything in parallel — none of these block each other.
  const [historyResult, quoteResult, companyName, secFacts, fundamentals, directory] =
    await Promise.all([
      // .then/.catch rather than .catch(() => []) so a thrown read (FMP or Redis
      // unreachable) stays distinguishable from a read that legitimately
      // returned nothing for this symbol.
      getDailyHistory(upper, { caller: "stock-page-meta" }).then(
        (pts) => ({ points: pts as Point[], failed: false }),
        () => ({ points: [] as Point[], failed: true })
      ),
      fetchQuote(upper),
      fetchCompanyName(upper),
      // ONE FACT-SET READ, TWO ANSWERS: the sidebar snapshot and the Dividend
      // row. They were two calls in the first draft, on the belief that
      // secColdFetch dedupes an in-flight read per symbol the way
      // getDailyHistory does. It does not — see getStockPageSecFacts.
      fetchStockPageSecFacts(upper),
      // A cached Redis mget that never fetches on a miss: the FMP-cache leg of
      // resolveProfile, exactly as the news page reads it.
      readCachedFundamentalsBulk([upper]).then((m) => m.get(upper) ?? null, () => null),
      // Nasdaq Trader's directory for the heading, memoised per process.
      getCompanyNameMap().catch(() => new Map<string, string>()),
    ]);

  const quote = quoteResult.quote;
  const points: Point[] = historyResult.points.filter(
    (p) => p.date && Number.isFinite(p.close)
  );

  // ── THE PROFILE BLOCK, FROM FREE SOURCES (brief 2026-09-22 PR 2) ─────────
  // Composed rather than fetched, and no longer from FMP at all: the
  // description is the company's own annual-report wording (PR 3, #518). Market cap is the SEC cover-page share count times THIS page's
  // price, so it moves to Tiingo with the quote and needs no change of its
  // own; the 52-week range is computed from the same bars the chart draws.
  const directoryName =
    symbolSpellings(upper).map((s) => directory.get(s)).find(Boolean) ?? "";
  const taxonomy = resolveProfile(upper, fundamentals);
  const composed = composeCompanyProfile({
    symbol: upper,
    directoryName,
    snapshotName: snapshotCompanyName(upper),
    entityName: secFacts.profileFacts.entityName,
    filingDescription: filingDescriptionFor(upper),
    taxonomy,
    classificationAsOf: classificationAsOf(taxonomy, fundamentals?.updatedAt),
    valuation: secFacts.profileFacts.valuation,
    price: quote.price,
    points,
    exchange: exchangeFor(upper),
    registrant: registrantFor(upper),
  });
  const shareHistory = secFacts.profileFacts.shareHistory;

  // ── THE VALUATION SECTION AND THE HERO P/E, FROM THE FILINGS ───────────
  // Were FMP's ratios-ttm / key-metrics-ttm via /api/stock-valuation, fetched
  // client-side. Computed here from the same fact-set read and THIS page's
  // price, so the cap in the About block and the multiples below it are the
  // same number (owner addendum, brief 2026-09-22 PR 2).
  const multiples =
    secFacts.profileFacts.valuation && secFacts.profileFacts.multiples
      ? valuationMultiples(secFacts.profileFacts.valuation, secFacts.profileFacts.multiples, quote.price)
      : null;
  const figure = (f: ValuationFigure | null | undefined) => (f && f.ok ? f.val : null);
  const why = (f: ValuationFigure | null | undefined) => (f && !f.ok ? REFUSAL_WORDS[f.why] : null);
  const valuation = {
    peRatio: figure(multiples?.pe),
    priceToSalesRatio: figure(multiples?.ps),
    priceToBookRatio: figure(multiples?.pb),
    evToEbitda: figure(multiples?.evEbitda),
    reasons: {
      peRatio: why(multiples?.pe),
      priceToSalesRatio: why(multiples?.ps),
      priceToBookRatio: why(multiples?.pb),
      evToEbitda: why(multiples?.evEbitda),
    },
    sourceNote: valuationSourceNote(secFacts.profileFacts.multiples, secFacts.profileFacts.valuation),
  };

  // OLD BEHAVIOUR, REMOVED: this threw when there was no history and no price.
  //
  // fetchQuote() returns an all-null `empty` quote when FMP fails, and
  // getDailyHistory() is .catch(() => []) above, so a total data failure used to
  // render a normal-looking page with a null price, no company name and an
  // "Unavailable" state -- indistinguishable from a real render, and green in
  // the build. That is survivable while this route renders per request. It is
  // not survivable now that it is cached: the artefact is what every subsequent
  // visitor and crawler receives for the next 15 minutes, and most traffic here
  // is prefetch and crawlers rather than readers.
  //
  // Throwing is what keeps it out of the cache. Next does not cache a render
  // that throws, and on ISR regeneration it keeps serving the last good copy, so
  // a transient FMP or Redis failure can no longer replace a good page with an
  // empty one. Same reasoning as the payload guard in PickerResultPage; see
  // claude/picker-pages-isr-2026-08-20.md.
  //
  // Deliberately requires BOTH to be missing. A symbol with a price but no
  // history (a fresh listing) and one with history but a momentarily unavailable
  // quote are both real pages worth serving; nothing at all is not.
  //
  // NOTE: this throws rather than notFound() because it cannot tell a genuinely
  // unknown ticker from a transient outage, and cached 404s on real symbols
  // would be far worse than a retry. Giving unknown symbols a real 404 needs a
  // symbol-directory check (searchSymbols is already imported here) and is its
  // own change.
  const hasData = points.length > 0 || quote.price != null;

  if (!hasData) {
    // A symbol with no data is a legitimate page, not a server failure.
    //
    // This branch used to throw. That produced a 500, and this route is hit
    // with a lot of junk and delisted tickers -- ~1,519 distinct request paths
    // in the runtime logs, i.e. something is enumerating symbols. Sustained 5xx
    // makes Google throttle crawl rate site-wide, which directly undoes the ISR
    // work this change exists for. Returning 200 with an honest state, marked
    // noindex in generateMetadata above, is both truthful and safe: it cannot be
    // indexed as thin content, and it costs no crawl budget.
    //
    // The empty-artefact concern that motivated the throw is real but is
    // handled elsewhere now: this state is explicit rather than a normal-looking
    // page full of nulls, so a cached copy says what it is, and it self-heals at
    // the next revalidate.
    //
    // WHAT THIS DELIBERATELY DOES NOT DO: hard-fail on a data-layer outage.
    // `quoteResult.outcome` and `historyResult.failed` tell us we could not
    // reach FMP for THIS symbol, which is not evidence that FMP is down -- so
    // they only change the wording below. A genuine outage signal needs state
    // across requests (consecutive-failure count or a circuit breaker in Redis)
    // and is its own change; until it exists, a hard failure here would be a
    // guess with a 5xx attached.
    const couldNotReach = quoteResult.outcome === "unavailable" || historyResult.failed;

    // No JSON-LD on this branch on purpose: emitting FinancialProduct data for
    // a symbol we have no data for would be asserting something untrue.
    return (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 20px 96px" }}>
        <h1 style={{ fontSize: "1.6rem", marginBottom: 12 }}>
          {couldNotReach ? `${upper} data is temporarily unavailable` : `No data available for ${upper}`}
        </h1>
        <p style={{ opacity: 0.8, lineHeight: 1.6, marginBottom: 8 }}>
          {couldNotReach
            ? `We could not load market data for ${upper} just now. This is usually temporary -- please try again shortly.`
            : `We do not have market data for ${upper}. It may be delisted, not covered by our data provider, or not a valid ticker symbol.`}
        </p>
        <p style={{ opacity: 0.8, lineHeight: 1.6 }}>
          Try <Link href="/stock-search">searching for another symbol</Link>, or browse the{" "}
          <Link href="/pickers">stock screeners</Link>.
        </p>
        <RelatedStocks currentSymbol={upper} symbols={getRelatedSymbols(upper)} />
      </main>
    );
  }

  // Compute indicators once on the server; pass as seed so the client
  // renders real content immediately rather than showing "Loading…".
  const seed: IndicatorSeed = computeIndicatorSeed(
    points,
    companyName,
    quote.price,
    quote.date
  );

  const seoTitle = buildSeoTitle(upper, seed);
  const seoDescription = buildSeoDescription(upper, seed);

  // Curated, deterministic set of OTHER stock symbols for the "Explore More
  // Stocks" internal-linking module (see lib/curatedSymbols.ts and
  // app/components/RelatedStocks.tsx). Pure/no I/O — reuses the same
  // curated arrays app/sitemap.ts submits to Google, doesn't add any new
  // API calls.
  const relatedSymbols = getRelatedSymbols(upper);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "Organization",
                "@id": "https://www.mystockharbor.com/#organization",
                name: "MyStockHarbor",
                url: "https://www.mystockharbor.com",
                logo: {
                  "@type": "ImageObject",
                  url: "https://www.mystockharbor.com/logo.png",
                },
              },
              {
                "@type": "WebSite",
                "@id": "https://www.mystockharbor.com/#website",
                name: "MyStockHarbor",
                url: "https://www.mystockharbor.com",
                publisher: {
                  "@id": "https://www.mystockharbor.com/#organization",
                },
              },
              {
                "@type": "WebPage",
                "@id": `https://www.mystockharbor.com/stock/${upper}#webpage`,
                url: `https://www.mystockharbor.com/stock/${upper}`,
                name: seoTitle,
                description: seoDescription,
                isPartOf: {
                  "@id": "https://www.mystockharbor.com/#website",
                },
                about: {
                  "@id": `https://www.mystockharbor.com/stock/${upper}#financialproduct`,
                },
                mainEntity: {
                  "@id": `https://www.mystockharbor.com/stock/${upper}#financialproduct`,
                },
              },
              {
                "@type": "FinancialProduct",
                "@id": `https://www.mystockharbor.com/stock/${upper}#financialproduct`,
                name: `${upper} Stock`,
                tickerSymbol: upper,
                category: "Equity",
                provider: {
                  "@id": "https://www.mystockharbor.com/#organization",
                },
                url: `https://www.mystockharbor.com/stock/${upper}`,
                description: seoDescription,
              },
              {
                "@type": "BreadcrumbList",
                "@id": `https://www.mystockharbor.com/stock/${upper}#breadcrumb`,
                itemListElement: [
                  {
                    "@type": "ListItem",
                    position: 1,
                    name: "Home",
                    item: "https://www.mystockharbor.com/",
                  },
                  {
                    "@type": "ListItem",
                    position: 2,
                    name: `${upper} Stock Analysis`,
                    item: `https://www.mystockharbor.com/stock/${upper}`,
                  },
                ],
              },
            ],
          }),
        }}
      />

      <StockSymbolPageClient
        symbol={upper}
        earningsSnapshot={secFacts.snapshot}
        dividend={secFacts.dividend}
        // NULL WHEN NOTHING RESOLVED, not an empty object. The client renders
        // the standalone dilution chart and "Learn the indicators" section only
        // when `profile` is null; CompanyProfile returns null on an empty
        // profile, so passing an empty one would drop both.
        profile={
          composed.description || composed.sector || composed.industry ||
          composed.marketCap != null || composed.rangeLow != null ||
          composed.exchange || composed.country
            ? composed
            : null
        }
        shareHistory={shareHistory}
        valuation={valuation}
        seed={seed}
        // 500, not 300. The chart renders history.slice(-240) and ma200 needs
        // 200 prior bars to be defined across that window, so 440 is the
        // floor; 500 leaves slack for the weekly aggregation and the macro
        // support/resistance scan, which both read the full array. At 300 the
        // MA200 line was undefined over roughly half the visible chart, which
        // is why the client re-fetched 900 bars on every load.
        initialHistory={points.slice(-500)}
        initialQuote={quote}
        // Proves to /api/quote that this client rendered a real page. Empty
        // string when QUOTE_TOKEN_SECRET is unset, in which case the client
        // sends no header and behaviour is unchanged. See lib/server/quoteToken.ts.
        pageToken={mintQuoteToken()}
      />

      {/* -- Explore More Stocks --------------------------------------
             Server-rendered, always-present internal-linking module to
             OTHER stock pages (see lib/curatedSymbols.ts +
             app/components/RelatedStocks.tsx). Rendered here rather than
             threaded through the large StockSymbolPageClient.tsx client
             component to keep this change tightly scoped -- it's still
             part of the same server-rendered response, so it's in the
             crawlable initial HTML. -- */}
      <RelatedStocks currentSymbol={upper} symbols={relatedSymbols} />
    </>
  );
}
