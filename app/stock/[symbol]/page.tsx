// app/stock/[symbol]/page.tsx
import type { Metadata } from "next";
import { getDailyHistory } from "@/lib/server/historyCache";
import type { LatestEarningsData } from "@/app/components/LatestEarningsCard";
import {
  computeIndicatorSeed,
  buildSeoTitle,
  buildSeoDescription,
  type IndicatorSeed,
  type Point,
} from "@/lib/indicators";
import StockSymbolPageClient from "./StockSymbolPageClient";
import PageShareBar from "@/app/components/PageShareBar";

type Props = {
  params: Promise<{ symbol: string }>;
};

// ── Server-side data fetching ────────────────────────────────────────────────────

async function fetchQuotePrice(
  symbol: string
): Promise<{ price: number | null; date: string | null }> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return { price: null, date: null };
  try {
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(
      symbol
    )}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      next: { revalidate: 900 },
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { price: null, date: null };
    const json = await res.json();
    const row = Array.isArray(json) ? json[0] : json;
    const price =
      typeof row?.price === "number" && Number.isFinite(row.price)
        ? (row.price as number)
        : null;
    return { price, date: new Date().toISOString().slice(0, 10) };
  } catch {
    return { price: null, date: null };
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
// old client-side earnings round-trip and its loading flash. NOTE: the main
// layout is still gated behind the client price/history load, so this data is
// hydrated in — to get it into the crawlable initial HTML, de-gate the layout
// from `priceLoading` (tracked follow-up) and flip the page's robots noindex.
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

// ── Metadata (dynamic, data-driven) ──────────────────────────────────────────

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();

  // Run history + quote in parallel; we only need these for meta generation.
  const [rawHistory, { price, date }] = await Promise.all([
    getDailyHistory(upper).catch(() => []),
    fetchQuotePrice(upper),
  ]);

  const points: Point[] = (rawHistory as Point[]).filter(
    (p) => p.date && Number.isFinite(p.close)
  );

  const seed = computeIndicatorSeed(points, "", price, date);
  const title = buildSeoTitle(upper, seed);
  const description = buildSeoDescription(upper, seed);

  return {
    title,
    description,
    robots: {
      index: false,
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

// ── Page (SSR seed + AI analysis both resolved server-side) ────────────────────

export default async function StockPage({ params }: Props) {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();

  // Fetch everything in parallel — none of these block each other.
  const [rawHistory, { price, date }, companyName, latestEarnings] =
    await Promise.all([
      getDailyHistory(upper).catch(() => [] as Point[]),
      fetchQuotePrice(upper),
      fetchCompanyName(upper),
      fetchLatestEarnings(upper),
    ]);

  const points: Point[] = (rawHistory as Point[]).filter(
    (p) => p.date && Number.isFinite(p.close)
  );

  // Compute indicators once on the server; pass as seed so the client
  // renders real content immediately rather than showing "Loading…".
  const seed: IndicatorSeed = computeIndicatorSeed(
    points,
    companyName,
    price,
    date
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
        seed={seed}
      />
    </>
  );
}
