import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://mystockharbor.com";
  const now = new Date();

  const mainPages = [
    { path: "", changeFrequency: "daily" as const, priority: 1 },
    { path: "/learn", changeFrequency: "weekly" as const, priority: 0.9 },
    { path: "/pickers", changeFrequency: "daily" as const, priority: 0.9 },
    { path: "/platforms", changeFrequency: "weekly" as const, priority: 0.8 },
    { path: "/utilities", changeFrequency: "weekly" as const, priority: 0.7 },
    { path: "/about", changeFrequency: "monthly" as const, priority: 0.5 },
    { path: "/contact", changeFrequency: "monthly" as const, priority: 0.5 },
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
    "/oversold-stocks",
    "/breakout-stocks",
    "/buy-the-dip-stocks",
    "/bullish-divergence-stocks",
    "/bearish-divergence-stocks",
    "/overbought-stocks",
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
    "/stocks-above-200-day-moving-average",
    "/position-sizing-guide",
    "/stop-loss-strategy",
    "/risk-reward-ratio",
    "/margin-trading-explained",
    "/trading-risk-management",
  ];

  const stocks = [
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
    "GLD",
    "SLV",
  ];

  const mainPageEntries = mainPages.map((page) => ({
    url: `${baseUrl}${page.path}`,
    lastModified: now,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));

  const seoGuideEntries = seoGuides.map((path) => ({
    url: `${baseUrl}${path}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  const stockEntries = stocks.map((symbol) => ({
    url: `${baseUrl}/stock/${encodeURIComponent(symbol.toUpperCase())}`,
    lastModified: now,
    changeFrequency: "daily" as const,
    priority: 0.8,
  }));

  const stockNewsEntries = stocks.map((symbol) => ({
    url: `${baseUrl}/stock/${encodeURIComponent(symbol.toUpperCase())}/news`,
    lastModified: now,
    changeFrequency: "daily" as const,
    priority: 0.78,
  }));

  const etfEntries = etfs.map((symbol) => ({
    url: `${baseUrl}/stock/${encodeURIComponent(symbol.toUpperCase())}`,
    lastModified: now,
    changeFrequency: "daily" as const,
    priority: 0.8,
  }));

  const etfNewsEntries = etfs.map((symbol) => ({
    url: `${baseUrl}/stock/${encodeURIComponent(symbol.toUpperCase())}/news`,
    lastModified: now,
    changeFrequency: "daily" as const,
    priority: 0.78,
  }));

  return [
    ...mainPageEntries,
    ...seoGuideEntries,
    ...stockEntries,
    ...stockNewsEntries,
    ...etfEntries,
    ...etfNewsEntries,
  ];
}
