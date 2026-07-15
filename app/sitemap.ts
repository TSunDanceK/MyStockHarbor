import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";
import { getAllVideoIds } from "@/lib/videoContent";
import { getAllBottleneckPosts } from "@/lib/bottlenecks";
import { LESSONS } from "@/app/learn/lessons";

const baseUrl = "https://www.mystockharbor.com";

const mainPages = [
  { path: "", changeFrequency: "daily" as const, priority: 1 },
  { path: "/dashboard", changeFrequency: "daily" as const, priority: 0.95 },
  { path: "/learn", changeFrequency: "weekly" as const, priority: 0.9 },
  { path: "/pickers", changeFrequency: "daily" as const, priority: 0.9 },
  { path: "/utilities", changeFrequency: "weekly" as const, priority: 0.7 },
  { path: "/insights", changeFrequency: "daily" as const, priority: 0.85 },
  { path: "/bottlenecks", changeFrequency: "daily" as const, priority: 0.85 },
  { path: "/upcoming-ipos", changeFrequency: "daily" as const, priority: 0.75 },
  { path: "/headlines", changeFrequency: "hourly" as const, priority: 0.8 },
  { path: "/earnings-calendar", changeFrequency: "daily" as const, priority: 0.85 },
  { path: "/recently-added-to-index", changeFrequency: "daily" as const, priority: 0.75 },
  { path: "/about", changeFrequency: "monthly" as const, priority: 0.5 },
  { path: "/contact", changeFrequency: "monthly" as const, priority: 0.5 },
  { path: "/privacy-policy", changeFrequency: "monthly" as const, priority: 0.4 },
  { path: "/affiliate-disclosure", changeFrequency: "monthly" as const, priority: 0.4 },
  { path: "/risk-disclaimer", changeFrequency: "monthly" as const, priority: 0.4 },
];

const marketPages = [
  // Market overview / analysis pages
  "/markets/spx",
];

const seoGuides = [
  "/how-to-read-stock-charts",
  "/best-stock-indicators-for-beginners",
  "/how-to-identify-stock-trends",
  "/what-is-rsi-indicator",
  "/what-is-macd-indicator",
  "/what-is-vwap-indicator",
  "/stocks-down-from-highs",
  "/buy-the-dip-stocks",
  "/trading-setups",
  "/stock-screener-for-breakouts",
  "/stock-screener-for-oversold-stocks",
  "/stocks-down-20-percent",
  "/best-free-stock-screener",
  "/how-to-find-buy-the-dip-stocks",
  "/bullish-divergence-explained",
  "/bearish-divergence-explained",
  "/best-indicators-for-swing-trading",
  "/how-to-scan-stocks",
  "/stocks-ready-to-break-out",
  "/best-charting-platforms",
  "/how-to-analyse-stocks",
  "/stocks-with-high-rsi",
  "/stocks-with-low-rsi",
  "/stocks-with-unusual-volume",
  "/position-sizing-guide",
  "/stop-loss-strategy",
  "/risk-reward-ratio",
  "/margin-trading-explained",
  "/trading-risk-management",
  "/best-trading-platform-for-beginners",
  "/stocks-above-200-day-moving-average",
  "/macro-support-resistance-stocks",
  "/platforms",
  "/stock-indicators",
  "/stock-scanners",

  // live setup / picker SEO pages
  "/oversold-stocks-today",
  "/overbought-stocks-today",
  "/all-time-high-breakout-stocks",
  "/3-month-high-breakout-stocks",
  "/bullish-bearish-divergence-stocks",
  "/best-trend-score-stocks",
  "/top-stocks-with-buy-signals",
  "/top-stocks-with-sell-signals",
  "/stocks-near-200-day-moving-average",
  "/stocks-near-weekly-200-day-moving-average",
  "/stocks-down-20-from-all-time-highs",
  "/stocks-with-positive-last-earnings",
  "/stocks-with-strong-earnings-growth",

  // chart pattern plays
  "/plays",
  "/plays/descending-triangles",
  "/plays/bull-flags",

  // beginner setup explainer guides (real built pages, previously missing
  // from the sitemap - found via June 2026 SEO audit)
  "/breakout-stocks",
  "/oversold-stocks",
  "/bullish-divergence-stocks",
  "/bearish-divergence-stocks",
];

const coreMegaCaps = [
  "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "BRK.B", "AVGO",
  "LLY", "JPM", "V", "MA", "COST", "UNH", "HD", "PG", "XOM", "CVX", "MRK",
  "ABBV", "PEP", "KO", "WMT", "T", "VZ", "ORCL", "CRM", "ADBE", "CSCO",
  "INTC", "AMD", "QCOM", "TXN", "MCD", "SBUX", "PYPL", "BAC", "WFC", "TGT",
  "DIS",
];

const retailInterestStocks = [
  "PLTR", "SOFI", "RIVN", "LCID", "NIO", "HOOD", "COIN", "DKNG", "AFRM",
  "UPST", "ROKU", "SNAP", "PINS", "U", "SHOP", "SQ", "RDDT", "MSTR", "MARA",
  "RIOT", "HIMS", "CAVA", "DUOL", "CELH", "ARM", "SMCI", "PATH", "CVNA",
  "CHWY", "ETSY",
];

const recognizableMidCaps = [
  "F", "GM", "UBER", "LYFT", "ABNB", "NET", "CRWD", "PANW", "SNOW", "ZS",
  "DDOG", "OKTA", "DOCU", "MDB", "TWLO", "HUBS", "ESTC", "TEAM", "ZM", "BILL",
  "TTD", "INTU", "NOW", "ADSK", "ANET", "MU", "KLAC", "LRCX", "AMAT", "ON",
  "MRVL", "DELL", "HPQ", "CSX", "UAL", "DAL", "AAL", "CCL", "RCL", "MAR",
  "HLT", "CMG", "NKE", "LOW", "CAT", "DE", "GE", "BA", "RTX", "PFE", "BMY",
  "GILD", "AMGN", "ISRG", "BKNG", "MELI", "EBAY", "WDAY",
];

const etfs = [
  "SPY", "QQQ", "DIA", "IWM", "VTI", "VOO", "ARKK", "XLF", "XLE", "XLK",
  "XLP", "XLY", "XLV", "XLRE", "XLI", "XLC", "XLB", "XLU", "SMH", "SOXX",
  "IBIT", "HODL", "ARKW", "VUG", "SCHD", "DGRO", "JEPI", "JEPQ", "GLD",
  "SLV", "TLT", "HYG",
];

const priorityStocks = Array.from(
  new Set([...coreMegaCaps, ...retailInterestStocks, ...recognizableMidCaps])
);

const uniqueEtfs = Array.from(new Set(etfs));

function toAbsoluteUrl(path: string) {
  return `${baseUrl}${path}`;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const insightPosts = getAllPosts();
  const bottleneckPosts = getAllBottleneckPosts();
  const videoIds = getAllVideoIds();

  const mainPageEntries: MetadataRoute.Sitemap = mainPages.map((page) => ({
    url: toAbsoluteUrl(page.path),
    lastModified: now,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));

  const marketPageEntries: MetadataRoute.Sitemap = marketPages.map((path) => ({
    url: toAbsoluteUrl(path),
    lastModified: now,
    changeFrequency: "daily" as const,
    priority: 0.88,
  }));

  const seoGuideEntries: MetadataRoute.Sitemap = seoGuides.map((path) => ({
    url: toAbsoluteUrl(path),
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  const insightEntries: MetadataRoute.Sitemap = insightPosts.map((post) => ({
    url: toAbsoluteUrl(`/insights/${post.slug}`),
    lastModified: post.date ? new Date(post.date) : now,
    changeFrequency: "monthly",
    priority: 0.72,
  }));

  const bottleneckEntries: MetadataRoute.Sitemap = bottleneckPosts.map(
    (post) => ({
      url: toAbsoluteUrl(`/bottlenecks/${post.slug}`),
      lastModified: post.date ? new Date(post.date) : now,
      changeFrequency: "weekly",
      priority: 0.72,
    })
  );

  // Video pages — only pages with a content file are submitted to Google.
  // Auto-updates as new content/videos/*.md files are added.
  const videoEntries: MetadataRoute.Sitemap = videoIds.map((id) => ({
    url: toAbsoluteUrl(`/insights/videos/${id}`),
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.75,
  }));

  const learnEntries: MetadataRoute.Sitemap = LESSONS.map((lesson) => ({
    url: toAbsoluteUrl(`/learn/${encodeURIComponent(lesson.slug)}`),
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.68,
  }));

  // NOTE: /stock/[symbol] (and its /news, /earnings subpages) are
  // intentionally excluded from the sitemap. Those pages are set to
  // noindex,follow (see app/stock/[symbol]/*/page.tsx generateMetadata)
  // because per-ticker content is thin/templated and Google should not
  // spend crawl budget indexing every symbol. priorityStocks/uniqueEtfs
  // are kept here (unused in entries) as the source list in case a
  // future curated subset of tickers is made indexable again.
  void priorityStocks;
  void uniqueEtfs;

  const entries: MetadataRoute.Sitemap = [
    ...mainPageEntries,
    ...marketPageEntries,
    ...seoGuideEntries,
    ...insightEntries,
    ...bottleneckEntries,
    ...videoEntries,
    ...learnEntries,
  ];

  // Safety guard: only return clean canonical www HTTPS URLs once.
  const seen = new Set<string>();

  return entries.filter((entry) => {
    if (!entry.url.startsWith(`${baseUrl}/`) && entry.url !== baseUrl) {
      return false;
    }
    if (seen.has(entry.url)) {
      return false;
    }
    seen.add(entry.url);
    return true;
  });
}
