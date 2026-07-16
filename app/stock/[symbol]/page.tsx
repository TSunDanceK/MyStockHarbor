// app/stock/[symbol]/page.tsx
import type { Metadata } from "next";
import { getDailyHistory } from "@/lib/server/historyCache";
import type { LatestEarningsData } from "@/app/components/LatestEarningsCard";
import type { CompanyProfile } from "@/app/components/CompanyProfile";
import type { DilutionHistoryData } from "@/app/components/DilutionHistory";
import {
  computeIndicatorSeed,
  buildSeoTitle,
  buildSeoDescription,
  type IndicatorSeed,
  type Point,
} from "@/lib/indicators";
import StockSymbolPageClient, { type InitialQuote } from "./StockSymbolPageClient";
import PageShareBar from "@/app/components/PageShareBar";

type Props = {
  params: Promise<{ symbol: string }>;
};

// ── Server-side data fetching ────────────────────────────────────────────────

// Fetches the FMP stable/quote payload once on the server. Beyond the
// price/date pair used for SEO + indicator seeding, this also captures the
// day range, volume vs average volume, previous close and change — all
// included in the same response — so the header "quote snapshot" can render
// real numbers in the initial HTML instead of waiting on a client refetch.
async function fetchQuote(symbol: string): Promise<InitialQuote> {
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
  if (!apiKey) return empty;
  try {
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(
      symbol
    )}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      next: { revalidate: 900 },
      headers: { accept: "application/json" },
    });
    if (!res.ok) return empty;
    const json = await res.json();
    const row = Array.isArray(json) ? json[0] : json;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const price = num(row?.price);
    return {
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
  } catch {
    return empty;
  }
}

async function fetchCompanyName(symbol: string): Promise<string> {
  try {
    const url = new URL(
      `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.mystockharbor.com"}/api/symbols`
    );
    url.searchParams.set("q", symbol);
    const res = await fetch(url.toString(), { next: { revalidate: 3600 } });
    if (!res.ok) return "";
    const data = await res.json();
    const exact = (
      (data?.results ?? []) as Array<{ symbol?: string; name?: string }>
    ).find((r) => (r.symbol ?? "").toUpperCase() === symbol.toUpperCase());
    return exact?.name ?? "";
  } catch {
    return "";
  }
}

function emptyEarnings(): LatestEarningsData {
  return {
    hasStructuredData: false,
    tone: "yellow",
    toneLabel: "Unavailable",
    score: null,
    reportDate: null,
    fiscalDate: null,
    actualEps: null,
    estimatedEps: null,
    epsSurprise: null,
    epsSurprisePercent: null,
    revenue: null,
    revenueEstimate: null,
    revenueSurprise: null,
    revenueSurprisePercent: null,
    grossMargin: null,
    operatingMargin: null,
    netIncome: null,
    guidanceSummary: null,
    nextEarningsDate: null,
    recentReports: [],
    yearlySummaries: [],
    sourceNote: "Structured earnings data is unavailable right now.",
  };
}

// Fetch the structured earnings snapshot on the SERVER (same /api/stock-earnings
// pipeline the Earnings page uses) and pass it down as a prop. This removes the
// old client-side earnings round-trip and its loading flash. The client is also
// seeded with server-computed indicators (seed) and recent history
// (initialHistory), so the whole layout renders into the crawlable initial HTML
// instead of behind a "Loading…" gate.
async function fetchLatestEarnings(symbol: string): Promise<LatestEarningsData> {
  try {
    const url = `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.mystockharbor.com"}/api/stock-earnings/${encodeURIComponent(symbol)}`;
    const res = await fetch(url, { next: { revalidate: 60 * 60 * 6 } });
    if (!res.ok) return emptyEarnings();
    return (await res.json()) as LatestEarningsData;
  } catch {
    return emptyEarnings();
  }
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
async function fetchCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return null;
  const enc = encodeURIComponent(symbol);
  const key = encodeURIComponent(apiKey);
  const urls = [
    `https://financialmodelingprep.com/stable/profile?symbol=${enc}&apikey=${key}`,
    `https://financialmodelingprep.com/api/v3/profile/${enc}?apikey=${key}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { next: { revalidate: 60 * 60 * 24 } });
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
async function fetchShareHistory(symbol: string): Promise<DilutionHistoryData | null> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return null;
  const enc = encodeURIComponent(symbol);
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
      const res = await fetch(url, { next: { revalidate: 60 * 60 * 24 } });
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

// ── Metadata (dynamic, data-driven) ─────────────────────────────────────────

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();

  // Run history + quote in parallel; we only need these for meta generation.
  const [rawHistory, quote] = await Promise.all([
    getDailyHistory(upper).catch(() => []),
    fetchQuote(upper),
  ]);

  const points: Point[] = (rawHistory as Point[]).filter(
    (p) => p.date && Number.isFinite(p.close)
  );

  const seed = computeIndicatorSeed(points, "", quote.price, quote.date);
  const title = buildSeoTitle(upper, seed);
  const description = buildSeoDescription(upper, seed);

  return {
    title,
    description,
    robots: {
      index: true,
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
  const [rawHistory, quote, companyName, latestEarnings, profile, shareHistory] =
    await Promise.all([
      getDailyHistory(upper).catch(() => [] as Point[]),
      fetchQuote(upper),
      fetchCompanyName(upper),
      fetchLatestEarnings(upper),
      fetchCompanyProfile(upper).catch(() => null),
      fetchShareHistory(upper).catch(() => null),
    ]);

  const points: Point[] = (rawHistory as Point[]).filter(
    (p) => p.date && Number.isFinite(p.close)
  );

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

  const shareText = seed.lastClose != null
    ? `${upper} stock analysis — Price $${seed.lastClose.toFixed(2)}${seed.trend ? `, ${seed.trend}` : ""} 📊 MyStockHarbor`
    : `${upper} stock analysis — chart, indicators & technical read 📊 MyStockHarbor`;

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

      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "12px 20px 0" }}>
        <PageShareBar
          url={`https://www.mystockharbor.com/stock/${upper}`}
          title={`${upper} Stock Analysis | MyStockHarbor`}
          text={shareText}
        />
      </div>

      <StockSymbolPageClient
        symbol={upper}
        latestEarnings={latestEarnings}
        profile={profile}
        shareHistory={shareHistory}
        seed={seed}
        initialHistory={points.slice(-300)}
        initialQuote={quote}
      />
    </>
  );
}
