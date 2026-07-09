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
  // Real page (app/platforms/page.tsx) that was missing from the sitemap
  // entirely — found during the 2026-07-09 indexing audit. Prioritized
  // alongside Insights/Bottlenecks as one of the site's higher-value pages,
  // deliberately above the templated /stock/{symbol} pages below.
  { path: "/platforms", changeFrequency: "weekly" as const, priority: 0.85 },
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
  "/stock-market-setups",
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

  // Individual Insights posts — bumped from 0.72 to 0.8 (2026-07-09 SEO
  // rebalance) so Google weighs this real editorial content above the
  // templated /stock/{symbol} pages, which were previously tied at the
  // same 0.72 priority.
  const insightEntries: MetadataRoute.Sitemap = insightPosts.map((post) => ({
    url: toAbsoluteUrl(`/insights/${post.slug}`),
    lastModified: post.date ? new Date(post.date) : now,
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  // Individual Bottleneck pages — same 0.72 → 0.8 rebalance as Insights
  // above, for the same reason.
  const bottleneckEntries: MetadataRoute.Sitemap = bottleneckPosts.map(
    (post) => ({
      url: toAbsoluteUrl(`/bottlenecks/${post.slug}`),
      lastModified: post.date ? new Date(post.date) : now,
      changeFrequency: "weekly",
      priority: 0.8,
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

  // Plain /stock/{symbol} landing pages — deliberately dropped from 0.72
  // to 0.55 (2026-07-09 SEO rebalance). These are the thinnest, most
  // templated pages on the site (same shared layout across 129 symbols)
  // and made up the bulk of the "Discovered - currently not indexed"
  // backlog found in the 2026-07-09 Search Console audit
  // (claude/SEO_INDEXING_AUDIT_2026-07-09.md). Crawl/index priority should
  // go to Insights, Bottlenecks, Pickers, Platforms, and the per-symbol
  // News/Earnings pages instead - all bumped above this tier below.
  const stockEntries: MetadataRoute.Sitemap = priorityStocks.map((symbol) => ({
    url: toAbsoluteUrl(`/stock/${encodeURIComponent(symbol.toUpperCase())}`),
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.55,
  }));

  // Per-symbol News pages — bumped from 0.7 to 0.78. These carry real,
  // regularly-refreshed aggregated news content per symbol (much larger
  // page than the plain stock page), so they rank above the plain
  // /stock/{symbol} page in this rebalance.
  const stockNewsEntries: MetadataRoute.Sitemap = priorityStocks.map((symbol) => ({
    url: toAbsoluteUrl(`/stock/${encodeURIComponent(symbol.toUpperCase())}/news`),
    lastModified: now,
    changeFrequency: "daily",
    priority: 0.78,
  }));

  // Per-symbol Earnings pages — bumped from 0.69 to 0.78, same reasoning
  // as News above.
  const stockEarningsEntries: MetadataRoute.Sitemap = priorityStocks.map((symbol) => ({
    url: toAbsoluteUrl(`/stock/${encodeURIComponent(symbol.toUpperCase())}/earnings`),
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.78,
  }));

  // Plain ETF /stock/{symbol} pages — same 0.74 → 0.55 rebalance as the
  // stock entries above.
  const etfEntries: MetadataRoute.Sitemap = uniqueEtfs.map((symbol) => ({
    url: toAbsoluteUrl(`/stock/${encodeURIComponent(symbol.toUpperCase())}`),
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.55,
  }));

  // ETF News pages — bumped 0.69 → 0.78, same reasoning as stockNewsEntries.
  const etfNewsEntries: MetadataRoute.Sitemap = uniqueEtfs.map((symbol) => ({
    url: toAbsoluteUrl(`/stock/${encodeURIComponent(symbol.toUpperCase())}/news`),
    lastModified: now,
    changeFrequency: "daily",
    priority: 0.78,
  }));

  const entries: MetadataRoute.Sitemap = [
    ...mainPageEntries,
    ...marketPageEntries,
    ...seoGuideEntries,
    ...insightEntries,
    ...bottleneckEntries,
    ...videoEntries,
    ...learnEntries,
    ...stockEntries,
    ...stockNewsEntries,
    ...stockEarningsEntries,
    ...etfEntries,
    ...etfNewsEntries,
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
