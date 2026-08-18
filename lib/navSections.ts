// ---------------------------------------------------------------------------
// The site's full navigation link set, as plain data.
//
// WHY THIS FILE EXISTS
//
// app/components/SiteHeader.tsx renders every dropdown menu, every submenu and
// the whole mobile overlay through `createPortal`, and only while the menu is
// open. A crawler never opens a dropdown, so none of those links exist in the
// server-rendered HTML. Measured on a production build of /earnings-calendar
// on 17 Aug 2026: 48 hrefs in the nav config plus 11 sector links, and 19
// distinct links actually in the SSR HTML -- almost all of them the footer's.
// Spot checks returning zero occurrences included /pickers, /sector,
// /headlines, /markets/spx and /overbought-stocks-today.
//
// That matters because the site's binding constraint is crawl demand: 582 URLs
// discovered and never crawled, Discovery flat at 3% of crawl requests. The
// primary navigation was contributing essentially nothing to it. See
// claude/header-nav-not-crawlable-2026-08-17.md for the full measurement.
//
// This file is the data half of the fix. app/components/CrawlableNav.tsx
// renders it as a server component in the footer, so every link below is in
// the SSR HTML of every page.
//
// WHAT IS AND ISN'T HERE
//
// Static hrefs only. The header's "Company Earnings", "Stock News" and "Stock
// Analysis" entries resolve against a symbol read from localStorage, so they
// have no stable server-side value and are deliberately absent -- /stocks is
// the crawlable route into that family instead. /pickers#custom-screener is
// omitted too: a fragment of a page already linked here is not a separate URL.
//
// Every href below was checked against app/**/page.tsx before being added.
// /insights/videos is the notable omission -- app/insights/videos has only a
// [videoId] child and no index page, so linking it would have manufactured a
// 404 on every page of the site. Check the route exists before adding one.
//
// ON DRIFT
//
// SiteHeader's nav config is still the source of truth for what the
// interactive nav shows; this is a parallel list, and a link added there will
// not appear here automatically. That duplication is the price of shipping
// this without refactoring a 1,792-line client component whose entries carry
// bespoke isActive() predicates. The correct end state is for SiteHeader to
// consume this file, at which point the duplication disappears. Until then:
// add nav links in both places.
//
// Deliberately free of any server/Redis import, matching lib/sectors.ts, so it
// stays readable from client components, server components and the sitemap
// alike.
// ---------------------------------------------------------------------------

import { SECTORS, sectorNewsPath } from "@/lib/sectors";

export type NavSectionLink = {
  href: string;
  label: string;
};

export type NavSection = {
  heading: string;
  links: NavSectionLink[];
};

export const CRAWLABLE_NAV_SECTIONS: NavSection[] = [
  {
    heading: "Start Here",
    links: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/stocks", label: "Stock Directory" },
      { href: "/stock-screener", label: "Advanced Screener" },
      { href: "/pickers", label: "Basic Pickers" },
      { href: "/insights", label: "Insights" },
      { href: "/bottlenecks", label: "Bottlenecks" },
      { href: "/earnings-calendar", label: "Earnings Calendar" },
    ],
  },
  {
    heading: "Popular Screens",
    links: [
      { href: "/low-pe-stocks", label: "Low P/E Stocks" },
      { href: "/high-dividend-yield-stocks", label: "High Dividend Yield" },
      { href: "/dividend-growth-stocks", label: "Dividend Growth" },
      { href: "/cash-rich-value-stocks", label: "Cash-Rich Value" },
      { href: "/semiconductor-stocks", label: "Semiconductor Stocks" },
      { href: "/cheap-tech-stocks", label: "Cheap Tech Stocks" },
    ],
  },
  {
    heading: "Chart Plays",
    links: [
      { href: "/plays", label: "Ascending Triangle Plays" },
      { href: "/plays/descending-triangles", label: "Descending Triangle Plays" },
      { href: "/plays/bull-flags", label: "Bull Flag Plays" },
      {
        href: "/macro-support-resistance-stocks",
        label: "Macro Support & Resistance Plays",
      },
    ],
  },
  {
    heading: "Indicator Plays",
    links: [
      { href: "/overbought-stocks-today", label: "Overbought Stocks" },
      { href: "/oversold-stocks-today", label: "Oversold Stocks" },
      {
        href: "/bullish-bearish-divergence-stocks",
        label: "Bullish / Bearish Divergence",
      },
      { href: "/bullish-rsi-divergence-stocks", label: "Bullish RSI Divergence" },
      { href: "/bearish-rsi-divergence-stocks", label: "Bearish RSI Divergence" },
      {
        href: "/bullish-macd-divergence-stocks",
        label: "Bullish MACD Divergence",
      },
      {
        href: "/bearish-macd-divergence-stocks",
        label: "Bearish MACD Divergence",
      },
    ],
  },
  {
    heading: "Volume & Volatility",
    links: [
      { href: "/breakout-signal-stocks", label: "Breakout Signals" },
      { href: "/volume-spike-stocks", label: "Volume Spike" },
      { href: "/atr-spike-stocks", label: "ATR Spike" },
    ],
  },
  {
    heading: "Moving Averages",
    links: [
      {
        href: "/stocks-near-200-day-moving-average",
        label: "Near 200-Day MA (Daily)",
      },
      {
        href: "/stocks-near-weekly-200-day-moving-average",
        label: "Near 200-Day MA (Weekly)",
      },
      { href: "/stocks-above-50-day-moving-average", label: "Above 50-Day MA" },
      { href: "/stocks-below-50-day-moving-average", label: "Below 50-Day MA" },
      {
        href: "/stocks-trading-above-200-day-moving-average",
        label: "Above 200-Day MA",
      },
      { href: "/stocks-below-200-day-moving-average", label: "Below 200-Day MA" },
    ],
  },
  {
    heading: "Signals & Earnings Screens",
    links: [
      { href: "/top-stocks-with-buy-signals", label: "Buy Signals" },
      { href: "/top-stocks-with-sell-signals", label: "Sell Signals" },
      { href: "/all-time-high-breakout-stocks", label: "ATH Breakouts" },
      { href: "/3-month-high-breakout-stocks", label: "3-Month Highs" },
      { href: "/stocks-down-20-from-all-time-highs", label: "20% From ATH" },
      { href: "/best-trend-score-stocks", label: "Best Trend Score" },
      {
        href: "/stocks-with-positive-last-earnings",
        label: "Positive Last Earnings",
      },
      {
        href: "/stocks-with-strong-earnings-growth",
        label: "Strong Earnings Growth",
      },
    ],
  },
  {
    heading: "News & Markets",
    links: [
      { href: "/headlines", label: "Headlines" },
      { href: "/upcoming-ipos", label: "Upcoming IPOs" },
      { href: "/markets/spx", label: "SPX Analysis" },
      { href: "/sector", label: "All Sectors" },
    ],
  },
  {
    // Built from lib/sectors.ts rather than hand-listed, so the 11 sector
    // entries here can never disagree with the ones the header flyout, the
    // sitemap and the /sector route family all read from.
    heading: "Sector News",
    links: SECTORS.map((sector) => ({
      href: sectorNewsPath(sector.slug),
      label: sector.name,
    })),
  },
  {
    heading: "Learn & Tools",
    links: [
      { href: "/learn", label: "All Lessons" },
      { href: "/how-to-read-stock-charts", label: "How To Read Charts" },
      { href: "/trading-setups", label: "Trading Setups" },
      { href: "/platforms", label: "Trading Platforms" },
      { href: "/utilities", label: "Calculators" },
    ],
  },
];

/** Total link count, handy for verifying the SSR output. */
export const CRAWLABLE_NAV_LINK_COUNT = CRAWLABLE_NAV_SECTIONS.reduce(
  (total, section) => total + section.links.length,
  0
);
