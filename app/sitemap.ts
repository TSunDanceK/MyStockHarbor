import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://mystockharbor.com";

  const staticPages = [
    "",
    "/learn",
    "/pickers",
    "/platforms",
    "/utilities",
    "/about",
    "/contact",
    "/risk-disclaimer",
  ];

  const stocks = [
    "aapl",
    "msft",
    "nvda",
    "amzn",
    "meta",
    "googl",
    "tsla",
    "brk.b",
    "avgo",
    "ll y",
    "jpm",
    "v",
    "ma",
    "cost",
    "unh",
    "hd",
    "pg",
    "xom",
    "cvx",
    "mrk",
    "abbv",
    "pe p",
    "ko",
    "wmt",
    "t",
    "vz",
    "orcl",
    "crm",
    "adbe",
    "csco",
    "intc",
    "amd",
    "qcom",
    "tx n",
    "mcd",
    "sbux",
    "pypl",
    "bac",
    "wfc",
    "tgt",
    "dis",
  ];

  const etfs = [
    "spy",
    "qqq",
    "dia",
    "iwm",
    "vti",
    "voo",
    "arkk",
    "xlf",
    "xle",
    "xlk",
    "xlp",
    "xly",
    "xlv",
    "xlre",
    "gld",
    "slv",
  ];

  const stockPages = stocks.map((symbol) => ({
    url: `${baseUrl}/stocks/${symbol}`,
    lastModified: new Date(),
    changeFrequency: "daily" as const,
    priority: 0.8,
  }));

  const etfPages = etfs.map((symbol) => ({
    url: `${baseUrl}/stocks/${symbol}`,
    lastModified: new Date(),
    changeFrequency: "daily" as const,
    priority: 0.8,
  }));

  const mainPages = staticPages.map((path) => ({
    url: `${baseUrl}${path}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: path === "" ? 1 : 0.7,
  }));

  return [...mainPages, ...stockPages, ...etfPages];
}
