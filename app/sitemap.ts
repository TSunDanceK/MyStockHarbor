import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";
import { LESSONS } from "@/app/learn/lessons";

const baseUrl = "https://www.mystockharbor.com";

const mainPages = [
  { path: "", changeFrequency: "daily" as const, priority: 1 },
  { path: "/learn", changeFrequency: "weekly" as const, priority: 0.9 },
  { path: "/pickers", changeFrequency: "daily" as const, priority: 0.9 },
  { path: "/platforms", changeFrequency: "weekly" as const, priority: 0.8 },
  { path: "/utilities", changeFrequency: "weekly" as const, priority: 0.7 },
  { path: "/insights", changeFrequency: "daily" as const, priority: 0.85 },
  { path: "/about", changeFrequency: "monthly" as const, priority: 0.5 },
  { path: "/contact", changeFrequency: "monthly" as const, priority: 0.5 },
  { path: "/privacy-policy", changeFrequency: "monthly" as const, priority: 0.4 },
  { path: "/affiliate-disclosure", changeFrequency: "monthly" as const, priority: 0.4 },
  { path: "/risk-disclaimer", changeFrequency: "monthly" as const, priority: 0.4 },
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
  "/hot-market-names-right-now",
];

const coreMegaCaps = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "META",
  "GOOGL",
  "TSLA",
  "BRK.B",
  "AVGO",
  "LLY",
  "JPM",
  "V",
  "MA",
  "COST",
  "UNH",
  "HD",
  "PG",
  "XOM",
  "CVX",
  "MRK",
  "ABBV",
  "PEP",
  "KO",
  "WMT",
  "T",
  "VZ",
  "ORCL",
  "CRM",
  "ADBE",
  "CSCO",
  "INTC",
  "AMD",
  "QCOM",
  "TXN",
  "MCD",
  "SBUX",
  "PYPL",
  "BAC",
  "WFC",
  "TGT",
  "DIS",
];

const retailInterestStocks = [
  "PLTR",
  "SOFI",
  "RIVN",
  "LCID",
  "NIO",
  "HOOD",
  "COIN",
  "DKNG",
  "AFRM",
  "UPST",
  "ROKU",
  "SNAP",
  "PINS",
  "U",
  "SHOP",
  "SQ",
  "RDDT",
  "MSTR",
  "MARA",
  "RIOT",
  "HIMS",
  "CAVA",
  "DUOL",
  "CELH",
  "ARM",
  "SMCI",
  "PATH",
  "CVNA",
  "CHWY",
  "ETSY",
];

const recognizableMidCaps = [
  "F",
  "GM",
  "UBER",
  "LYFT",
  "ABNB",
  "NET",
  "CRWD",
  "PANW",
  "SNOW",
  "ZS",
  "DDOG",
  "OKTA",
  "DOCU",
  "MDB",
  "TWLO",
  "HUBS",
  "ESTC",
  "TEAM",
  "ZM",
  "BILL",
  "TTD",
  "INTU",
  "NOW",
  "ADSK",
  "ANET",
  "MU",
  "KLAC",
  "LRCX",
  "AMAT",
  "ON",
  "MRVL",
  "DELL",
  "HPQ",
  "CSX",
  "UAL",
  "DAL",
  "AAL",
  "CCL",
  "RCL",
  "MAR",
  "HLT",
  "CMG",
  "NKE",
  "LOW",
  "CAT",
  "DE",
  "GE",
  "BA",
  "RTX",
  "PFE",
  "BMY",
  "GILD",
  "AMGN",
  "ISRG",
  "BKNG",
  "MELI",
  "EBAY",
  "WDAY",
];

const etfs = [
  "SPY",
  "QQQ",
  "DIA",
  "IWM",
  "VTI",
  "VOO",
  "ARKK",
  "XLF",
  "XLE",
  "XLK",
  "XLP",
  "XLY",
  "XLV",
  "XLRE",
  "XLI",
  "XLC",
  "XLB",
  "XLU",
  "SMH",
  "SOXX",
  "IBIT",
  "HODL",
  "ARKW",
  "VUG",
  "SCHD",
  "DGRO",
  "JEPI",
  "JEPQ",
  "GLD",
  "SLV",
  "TLT",
  "HYG",
];



const priorityStocks = Array.from(
  new Set([...coreMegaCaps, ...retailInterestStocks])
);

const uniqueEtfs = Array.from(new Set(etfs));

function toAbsoluteUrl(path: string) {
  return `${baseUrl}${path}`;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const insightPosts = getAllPosts();

  const mainPageEntries: MetadataRoute.Sitemap = mainPages.map((page) => ({
    url: toAbsoluteUrl(page.path),
    lastModified: now,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
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

    const learnEntries: MetadataRoute.Sitemap = LESSONS.map((lesson) => ({
    url: toAbsoluteUrl(`/learn/${encodeURIComponent(lesson.slug)}`),
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.68,
  }));

  const stockEntries: MetadataRoute.Sitemap = priorityStocks.map((symbol) => ({
    url: toAbsoluteUrl(`/stock/${encodeURIComponent(symbol.toUpperCase())}`),
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.72,
  }));

  const stockNewsEntries: MetadataRoute.Sitemap = priorityStocks.map((symbol) => ({
    url: toAbsoluteUrl(`/stock/${encodeURIComponent(symbol.toUpperCase())}/news`),
    lastModified: now,
    changeFrequency: "daily",
    priority: 0.7,
  }));

  const etfEntries: MetadataRoute.Sitemap = uniqueEtfs.map((symbol) => ({
    url: toAbsoluteUrl(`/stock/${encodeURIComponent(symbol.toUpperCase())}`),
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.74,
  }));

  const etfNewsEntries: MetadataRoute.Sitemap = uniqueEtfs.map((symbol) => ({
    url: toAbsoluteUrl(`/stock/${encodeURIComponent(symbol.toUpperCase())}/news`),
    lastModified: now,
    changeFrequency: "daily",
    priority: 0.69,
  }));

  return [
    ...mainPageEntries,
    ...seoGuideEntries,
    ...insightEntries,
    ...learnEntries,
    ...stockEntries,
    ...stockNewsEntries,
    ...etfEntries,
    ...etfNewsEntries,
  ];
}
