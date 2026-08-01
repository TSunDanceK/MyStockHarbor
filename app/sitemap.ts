import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";
import { getAllVideoIds } from "@/lib/videoContent";
import { getAllBottleneckPosts } from "@/lib/bottlenecks";
import { LESSONS } from "@/app/learn/lessons";
import { priorityStocks, uniqueEtfs } from "@/lib/curatedSymbols";

const baseUrl = "https://www.mystockharbor.com";

// Google's hard cap is 50,000 URLs per sitemap file. We're nowhere near it
// today, but content/insights/ now grows 5x faster than before (5 posts/day
// instead of 1), so this is a genuine long-run number, not a hypothetical.
// If this ever fires in a Vercel build log, it's the cue to split this file
// using Next's generateSitemaps() - see the note above `insightEntries`
// below for exactly how, with the API confirmed against the Next.js 16 docs.
const SITEMAP_WARN_THRESHOLD = 40000;

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

// coreMegaCaps / retailInterestStocks / recognizableMidCaps / etfs and the
// derived priorityStocks / uniqueEtfs now live in lib/curatedSymbols.ts —
// the same shared source of truth used by the "Explore More Stocks"
// internal-linking module on /stock/[symbol] pages (see
// app/components/RelatedStocks.tsx). Import them from there instead of
// redefining inline; this file's output is unchanged.

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

  // Insight posts are frozen snapshots tied to their `date` field - they
  // never change after publish (see claude/CLAUDE.md "Lessons learned").
  // "yearly" is a more honest signal than "monthly" for Google's crawl
  // budget, and matters more now that 5 new frozen posts land every day
  // instead of 1.
  //
  // FUTURE SCALING NOTE: at 5 posts/day this list reaches Google's 50,000
  // per-sitemap cap in ~27 years - not urgent, but if SITEMAP_WARN_THRESHOLD
  // below ever fires, split this into its own nested file
  // (app/insights/sitemap.ts) using Next's generateSitemaps():
  //   export async function generateSitemaps() {
  //     const total = getAllPosts().length;
  //     return Array.from({ length: Math.ceil(total / 40000) }, (_, id) => ({ id }));
  //   }
  // which serves chunks at /insights/sitemap/0.xml, /insights/sitemap/1.xml,
  // etc. (confirmed against the Next.js 16 docs - a plain /insights/sitemap.xml
  // does not additionally exist once generateSitemaps is used). Add each new
  // chunk URL to the `sitemap` array in app/robots.ts alongside the existing
  // root sitemap - do NOT replace the already-registered
  // https://www.mystockharbor.com/sitemap.xml with this, only add to it.
  const insightEntries: MetadataRoute.Sitemap = insightPosts.map((post) => ({
    url: toAbsoluteUrl(`/insights/${post.slug}`),
    lastModified: post.date ? new Date(post.date) : now,
    changeFrequency: "yearly",
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

  // /stock/[symbol] (and its /news, /earnings subpages) now carry real,
  // non-thin content -- FMP company profile + fundamentals
  // (CompanyProfile.tsx), a shared earnings snapshot (LatestEarningsCard.tsx)
  // and a dedicated earnings-history page (PR #100/#101/#105) -- and
  // generateMetadata on all three routes already sets
  // robots: { index: true, follow: true }. This file was the only place
  // still treating them as excluded (stale comment/void from before that
  // indexing change landed). We submit the curated priorityStocks/uniqueEtfs
  // universe below (mega caps, retail-interest names, recognizable mid caps,
  // major ETFs) rather than every possible symbol, so Google has an explicit
  // discovery path into the highest-traffic tickers without ballooning the
  // sitemap with the full long-tail universe -- those stay reachable (and
  // indexable, since they're index:true too) via internal links from
  // pickers/plays/screener pages, just without a sitemap entry of their own.
  const stockSymbols = Array.from(new Set([...priorityStocks, ...uniqueEtfs]));

  const stockPageEntries: MetadataRoute.Sitemap = stockSymbols.map((symbol) => ({
    url: toAbsoluteUrl(`/stock/${symbol}`),
    lastModified: now,
    changeFrequency: "daily" as const,
    priority: 0.78,
  }));

  const stockNewsEntries: MetadataRoute.Sitemap = stockSymbols.map((symbol) => ({
    url: toAbsoluteUrl(`/stock/${symbol}/news`),
    lastModified: now,
    changeFrequency: "hourly" as const,
    priority: 0.7,
  }));

  const stockEarningsEntries: MetadataRoute.Sitemap = stockSymbols.map((symbol) => ({
    url: toAbsoluteUrl(`/stock/${symbol}/earnings`),
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.68,
  }));

  const entries: MetadataRoute.Sitemap = [
    ...mainPageEntries,
    ...marketPageEntries,
    ...seoGuideEntries,
    ...insightEntries,
    ...bottleneckEntries,
    ...videoEntries,
    ...learnEntries,
    ...stockPageEntries,
    ...stockNewsEntries,
    ...stockEarningsEntries,
  ];

  // Safety guard: only return clean canonical www HTTPS URLs once.
  const seen = new Set<string>();

  const deduped = entries.filter((entry) => {
    if (!entry.url.startsWith(`${baseUrl}/`) && entry.url !== baseUrl) {
      return false;
    }
    if (seen.has(entry.url)) {
      return false;
    }
    seen.add(entry.url);
    return true;
  });

  // Advance warning well before Google's real 50,000-per-sitemap limit, so
  // this shows up in a Vercel build log years before it could ever become
  // an actual problem - see the scaling note above `insightEntries`.
  if (deduped.length > SITEMAP_WARN_THRESHOLD) {
    console.warn(
      `[sitemap] ${deduped.length} URLs in the root sitemap - approaching Google's 50,000 ` +
        "per-sitemap limit. Time to split insights/bottlenecks into their own " +
        "generateSitemaps()-based files (see the comment above insightEntries in app/sitemap.ts)."
    );
  }

  return deduped;
}
