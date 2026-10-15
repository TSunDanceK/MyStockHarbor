import { positiveLastEarningsHidden } from "@/lib/positiveLastEarnings";
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
// ONE FILE FOR BOTH NAVS (#552 COWORK #231)
//
// The header's own tree is HEADER_NAV below, as plain data: SiteHeader (a
// server component) passes it to its client island, SiteHeaderNav, so the
// tree is HTML/RSC payload rather than JavaScript on every page. Each entry's
// active-path rule is data too (NavMatch), not a function. The crawlable
// footer list (CRAWLABLE_NAV_SECTIONS) keeps its own grouping and wording;
// scripts/check-header-nav.mjs requires every static header href to appear
// in it (or on its short list of documented exceptions), so a link added to
// the header and not here fails the check instead of drifting silently.
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
      { href: "/bottlenecks/capex", label: "Capex — Follow the money" },
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
    heading: "Trend Flips",
    links: [
      {
        href: "/stocks-with-bullish-trend-flip",
        label: "Bullish Trend Flip (Daily)",
      },
      {
        href: "/stocks-with-bearish-trend-flip",
        label: "Bearish Trend Flip (Daily)",
      },
      {
        href: "/stocks-with-weekly-bullish-trend-flip",
        label: "Bullish Trend Flip (Weekly)",
      },
      {
        href: "/stocks-with-weekly-bearish-trend-flip",
        label: "Bearish Trend Flip (Weekly)",
      },
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
      // Hidden 2026-09-27 (#553 COWORK #64): see lib/positiveLastEarnings.ts.
    ].filter((link) => !positiveLastEarningsHidden(link.href)),
  },
  {
    heading: "News & Markets",
    links: [
      { href: "/headlines", label: "Headlines" },
      { href: "/upcoming-ipos", label: "Upcoming IPOs" },
      { href: "/markets/spx", label: "SPX Analysis" },
      { href: "/markets/qqq", label: "Nasdaq-100 (QQQ)" },
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

// ---------------------------------------------------------------------------
// THE HEADER'S NAVIGATION TREE (#552 COWORK #231)
// ---------------------------------------------------------------------------

/** The symbol-dependent stock pages: their href is resolved in the browser. */
export type StockNavKind = "earnings" | "analysis" | "news";

// The active-path rule type and its matcher live in lib/navMatch.ts, so the
// header's client island can match paths without importing this data file.
export type { NavMatch } from "@/lib/navMatch";
import type { NavMatch } from "@/lib/navMatch";

export type HeaderNavChild = {
  label: string;
  /** Static href; for a `stockNav` entry it is filled in the browser. */
  href: string;
  /** Omitted: active on its own href exactly. */
  match?: NavMatch;
  emphasize?: boolean;
  stockNav?: StockNavKind;
  /** A link only when the last symbol has a filed SEC set (#552 COWORK #197); otherwise the entry stays, greyed and unlinked, with a note (#553 COWORK #236). */
  requiresFiledEarnings?: boolean;
  /** The newest video's page when one is known (lib/youtube.ts), else `href`. */
  latestVideo?: boolean;
};

export type HeaderNavEntry =
  | ({ kind: "link" } & HeaderNavChild)
  | { kind: "submenu"; label: string; match: NavMatch; items: HeaderNavChild[] };

export type HeaderNavItem =
  | ({ kind: "link" } & HeaderNavChild)
  | {
      kind: "dropdown";
      label: string;
      match: NavMatch;
      entries: HeaderNavEntry[];
      menuMinWidth?: number;
      submenuMinWidth?: number;
    };

const exact = (...paths: string[]): NavMatch => ({ exact: paths });

const POPULAR_SCREENS = [
  ["Low P/E Stocks", "/low-pe-stocks"],
  ["High Dividend Yield", "/high-dividend-yield-stocks"],
  ["Dividend Growth", "/dividend-growth-stocks"],
  ["Cash-Rich Value", "/cash-rich-value-stocks"],
  ["Semiconductor Stocks", "/semiconductor-stocks"],
  ["Cheap Tech Stocks", "/cheap-tech-stocks"],
] as const;
const INDICATOR_PLAYS = [
  ["Overbought Stocks", "/overbought-stocks-today"],
  ["Oversold Stocks", "/oversold-stocks-today"],
  ["Bullish / Bearish Divergence", "/bullish-bearish-divergence-stocks"],
  ["Bullish RSI Divergence", "/bullish-rsi-divergence-stocks"],
  ["Bearish RSI Divergence", "/bearish-rsi-divergence-stocks"],
  ["Bullish MACD Divergence", "/bullish-macd-divergence-stocks"],
  ["Bearish MACD Divergence", "/bearish-macd-divergence-stocks"],
] as const;
const VOLUME_VOLATILITY = [
  ["Breakout Signals", "/breakout-signal-stocks"],
  ["Volume Spike", "/volume-spike-stocks"],
  ["ATR Spike", "/atr-spike-stocks"],
] as const;
const MOVING_AVERAGES = [
  ["Near 200-Day MA (Daily)", "/stocks-near-200-day-moving-average"],
  ["Near 200-Day MA (Weekly)", "/stocks-near-weekly-200-day-moving-average"],
  ["Above 50-Day MA", "/stocks-above-50-day-moving-average"],
  ["Below 50-Day MA", "/stocks-below-50-day-moving-average"],
  ["Above 200-Day MA", "/stocks-trading-above-200-day-moving-average"],
  ["Below 200-Day MA", "/stocks-below-200-day-moving-average"],
] as const;
const TREND_FLIPS = [
  ["Bullish Trend Flip (Daily)", "/stocks-with-bullish-trend-flip"],
  ["Bearish Trend Flip (Daily)", "/stocks-with-bearish-trend-flip"],
  ["Bullish Trend Flip (Weekly)", "/stocks-with-weekly-bullish-trend-flip"],
  ["Bearish Trend Flip (Weekly)", "/stocks-with-weekly-bearish-trend-flip"],
] as const;
const EARNINGS_SCREENS = [
  ["Positive Last Earnings", "/stocks-with-positive-last-earnings"],
  ["Strong Earnings Growth", "/stocks-with-strong-earnings-growth"],
] as const;
const SIGNALS_SCREENS = [
  ["Buy Signals", "/top-stocks-with-buy-signals"],
  ["Sell Signals", "/top-stocks-with-sell-signals"],
  ["ATH Breakouts", "/all-time-high-breakout-stocks"],
  ["3-Month Highs", "/3-month-high-breakout-stocks"],
  ["20% From ATH", "/stocks-down-20-from-all-time-highs"],
  ["Best Trend Score", "/best-trend-score-stocks"],
] as const;

const links = (rows: ReadonlyArray<readonly [string, string]>): HeaderNavChild[] =>
  rows.map(([label, href]) => ({ label, href }));
const hrefs = (rows: ReadonlyArray<readonly [string, string]>) => rows.map(([, href]) => href);

/**
 * The header, top to bottom, as the desktop row and the mobile overlay show
 * it. Moved here from SiteHeader.tsx unchanged in labels, order, hrefs and
 * active rules (scripts/check-header-nav.mjs pins the rules on real paths).
 */
export const HEADER_NAV: HeaderNavItem[] = [
  { kind: "link", label: "Dashboard", href: "/dashboard", match: exact("/", "/dashboard") },
  {
    kind: "dropdown",
    label: "Pickers",
    match: {
      exact: [
        "/pickers", "/stock-screener", "/plays", "/macro-support-resistance-stocks",
        ...hrefs(INDICATOR_PLAYS), ...hrefs(VOLUME_VOLATILITY), ...hrefs(MOVING_AVERAGES), ...hrefs(TREND_FLIPS),
        ...hrefs(SIGNALS_SCREENS), ...hrefs(EARNINGS_SCREENS), ...hrefs(POPULAR_SCREENS),
      ],
      prefixes: ["/plays/"],
    },
    menuMinWidth: 220,
    submenuMinWidth: 250,
    entries: [
      // Two landing options at the top: the full screener, then the original
      // /pickers accordion. "Advanced Screener" is the wording ScreenerNav and
      // the page's own H1 use, so one destination has one name.
      { kind: "link", label: "Advanced Screener", href: "/stock-screener", emphasize: true },
      { kind: "link", label: "Basic Pickers Page", href: "/pickers", emphasize: true },
      // The saved fundamental screens: the menu is their primary route in.
      { kind: "submenu", label: "Popular Screens", match: exact(...hrefs(POPULAR_SCREENS)), items: links(POPULAR_SCREENS) },
      {
        kind: "submenu",
        label: "Chart Plays",
        match: { exact: ["/plays", "/macro-support-resistance-stocks"], prefixes: ["/plays/"] },
        items: [
          { label: "Ascending Triangle Plays", href: "/plays" },
          { label: "Descending Triangle Plays", href: "/plays/descending-triangles" },
          { label: "Bull Flag Plays", href: "/plays/bull-flags" },
          { label: "Macro Support & Resistance Plays", href: "/macro-support-resistance-stocks" },
        ],
      },
      { kind: "submenu", label: "Indicator Plays", match: exact(...hrefs(INDICATOR_PLAYS)), items: links(INDICATOR_PLAYS) },
      { kind: "submenu", label: "Volume & Volatility", match: exact(...hrefs(VOLUME_VOLATILITY)), items: links(VOLUME_VOLATILITY) },
      { kind: "submenu", label: "Moving Averages", match: exact(...hrefs(MOVING_AVERAGES)), items: links(MOVING_AVERAGES) },
      { kind: "submenu", label: "Trend Flips", match: exact(...hrefs(TREND_FLIPS)), items: links(TREND_FLIPS) },
      {
        kind: "submenu",
        label: "Earnings",
        match: exact(...hrefs(EARNINGS_SCREENS)),
        // Hidden 2026-09-27 (#553 COWORK #64): see lib/positiveLastEarnings.ts.
        items: links(EARNINGS_SCREENS).filter((item) => !positiveLastEarningsHidden(item.href)),
      },
      {
        kind: "submenu",
        label: "Signals & Screens",
        match: exact(...hrefs(SIGNALS_SCREENS), ...hrefs(EARNINGS_SCREENS)),
        items: links(SIGNALS_SCREENS),
      },
      { kind: "link", label: "Build Screener", href: "/pickers#custom-screener", match: {} },
    ],
  },
  {
    kind: "dropdown",
    label: "Insights",
    match: { exact: ["/insights"], prefixes: ["/insights/"] },
    entries: [
      {
        kind: "link",
        label: "Insights",
        href: "/insights",
        match: { exact: ["/insights"], prefixes: ["/insights/"], exceptPrefixes: ["/insights/videos"] },
        emphasize: true,
      },
      { kind: "link", label: "Video Breakdowns", href: "/insights", latestVideo: true, match: { prefixes: ["/insights/videos"] } },
    ],
  },
  {
    kind: "dropdown",
    label: "Bottlenecks",
    match: { exact: ["/bottlenecks"], prefixes: ["/bottlenecks/"] },
    entries: [
      {
        kind: "link",
        label: "Stock bottlenecks",
        href: "/bottlenecks",
        match: { exact: ["/bottlenecks"], prefixes: ["/bottlenecks/"], exceptExact: ["/bottlenecks/capex"] },
        emphasize: true,
      },
      { kind: "link", label: "Capex — Follow the money", href: "/bottlenecks/capex" },
    ],
  },
  {
    kind: "dropdown",
    label: "Earnings",
    match: { exact: ["/earnings-calendar"], patterns: ["^/stock/[^/]+/earnings$"] },
    entries: [
      {
        kind: "link",
        label: "Company Earnings",
        href: "",
        stockNav: "earnings",
        requiresFiledEarnings: true,
        match: { patterns: ["^/stock/[^/]+/earnings$"] },
      },
      { kind: "link", label: "Earnings Calendar", href: "/earnings-calendar" },
    ],
  },
  {
    kind: "dropdown",
    label: "News",
    // Wider than the 180px default: "Communication Services" and "Consumer
    // Defensive" need the room in the Sector News flyout.
    menuMinWidth: 210,
    submenuMinWidth: 250,
    match: { exact: ["/sector", "/upcoming-ipos", "/headlines"], patterns: ["^/stock/[^/]+/news$", "^/sector/[^/]+"] },
    entries: [
      { kind: "link", label: "Stock News", href: "", stockNav: "news", match: { patterns: ["^/stock/[^/]+/news$"] } },
      {
        kind: "submenu",
        label: "Sector News",
        match: { exact: ["/sector"], patterns: ["^/sector/[^/]+"] },
        items: [
          { label: "All Sectors", href: "/sector", emphasize: true },
          ...SECTORS.map((sector) => ({ label: sector.name, href: sectorNewsPath(sector.slug) })),
        ],
      },
      { kind: "link", label: "Upcoming IPO's", href: "/upcoming-ipos" },
      { kind: "link", label: "Headlines", href: "/headlines" },
    ],
  },
  {
    kind: "dropdown",
    label: "Analysis",
    match: { exact: ["/markets/spx", "/markets/qqq"], patterns: ["^/stock/[^/]+$"] },
    entries: [
      { kind: "link", label: "Stock Analysis", href: "", stockNav: "analysis", match: { patterns: ["^/stock/[^/]+$"] } },
      { kind: "link", label: "SPX Analysis", href: "/markets/spx" },
      // #553 COWORK #217: the Nasdaq-100 twin, directly after SPX (desktop and mobile read this list).
      { kind: "link", label: "Nasdaq-100 (QQQ)", href: "/markets/qqq" },
    ],
  },
  { kind: "link", label: "Platforms", href: "/platforms" },
  { kind: "link", label: "Calculators", href: "/utilities" },
  { kind: "link", label: "Learn", href: "/learn", match: { exact: ["/learn"], prefixes: ["/learn/"] } },
];
