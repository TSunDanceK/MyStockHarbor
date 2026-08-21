import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import { NOINDEX_PICKER_PAGES } from "./lib/noindexPickerPages";

const nextConfig: NextConfig = {
  // ── Picker pages dropped from the index (noindex, follow) ────
  // Served as an X-Robots-Tag response header rather than a
  // `robots: { index: false, follow: true }` metadata export in each of the
  // 22 route files. Google documents the header and the meta tag as
  // equivalent, and one list in lib/noindexPickerPages.ts is far easier to
  // audit, extend or reverse than 22 scattered edits that can silently drift
  // apart. Which pages are on the list, which 10 are deliberately NOT, and
  // why `follow` is mandatory, are all documented in that file.
  async headers() {
    return NOINDEX_PICKER_PAGES.map((source) => ({
      source,
      headers: [{ key: "X-Robots-Tag", value: "noindex, follow" }],
    }));
  },
  async redirects() {
    return [
      // ── Duplicate consolidation (301) ────────────────────────────
      // /bullish-divergence-stocks and /bearish-divergence-stocks are both
      // byte-for-byte identical to /bullish-bearish-divergence-stocks (same
      // git tree, canonical already points at the combined page). Consolidate
      // ranking signals onto the canonical combined page for both variants.
      {
        source: "/bullish-divergence-stocks",
        destination: "/bullish-bearish-divergence-stocks",
        permanent: true,
      },
      {
        source: "/bearish-divergence-stocks",
        destination: "/bullish-bearish-divergence-stocks",
        permanent: true,
      },
      // /stock-market-setups duplicated /trading-setups (same 7 destination
      // cards, different copy). Consolidated into /trading-setups; redirect
      // any residual traffic/link equity instead of leaving a 404.
      {
        source: "/stock-market-setups",
        destination: "/trading-setups",
        permanent: true,
      },

      // ── Removed page cleanup (301) ────────────────────────
      // /hot-market-names-right-now was deliberately removed from the site
      // (see CLAUDE.md "Lessons learned") but Google still has it indexed
      // from before removal and keeps re-crawling it as a dead 404, wasting
      // crawl budget. Redirect any residual traffic/link equity to the
      // closest live equivalent instead of leaving it as a permanent 404.
      {
        source: "/hot-market-names-right-now",
        destination: "/pickers",
        permanent: true,
      },

      // /recently-added-to-index, retired 2026-08-21. Same destination and the
      // same reasoning as the line above, and 301 rather than 410 for
      // consistency with that documented decision rather than a marginal
      // truthfulness gain.
      //
      // This page NEVER RENDERED DATA, on any deploy, for its entire life. It
      // read FMP's three historical-*-constituent endpoints, and ALL THREE
      // answer 402 "Restricted Endpoint" on this plan. It was invisible for
      // two compounding reasons: a cache:"no-store" fetch threw
      // DynamicServerError first and feedCache misreported it as an upstream
      // failure (#304), and Promise.all reported only the first of the three
      // 402s, so the one visible error named a single endpoint and implied the
      // other two were healthy (#305). See claude/silent-failure-traps.md
      // claude/traps/framework-signal-swallowed-by-a-network-handler.md and
      // claude/traps/promise-all-reports-only-the-first-rejection.md.
      //
      // *** THE SAME 402 WAS ALREADY FOUND AND WORKED AROUND ONCE. ***
      // app/api/market/route.ts hit it on the sibling sp500/nasdaq/dowjones-
      // constituent endpoints, where it had silently pinned the discovery
      // universe to its static fallback, and its comment records the identical
      // lesson about invisible failure. indexChanges.ts was written against the
      // same endpoint family months later without the connection being made --
      // two independent discoveries of one plan limitation, neither aware of
      // the other. Before adding any FMP constituent endpoint, check
      // /api/debug/fmp-endpoints; the whole family is restricted on this tier.
      //
      // lib/server/indexChanges.ts is deliberately KEPT: the code is correct
      // and the endpoints may become available on a higher plan.
      {
        source: "/recently-added-to-index",
        destination: "/pickers",
        permanent: true,
      },

      // ── Thin footer pages retired (301) ──────────────────
      // Seven pages that were only ever reachable from the footer and were
      // thin duplicates of work since done properly elsewhere: /learn now
      // carries 19 real lessons (rsi, macd and moving-averages among them),
      // and the live screeners cover the "stocks that..." variants.
      //
      // 301 rather than delete-and-404 deliberately. They date from March, are
      // in the sitemap, and were linked from 50+ places internally, so simply
      // removing them would both scatter broken links and discard whatever
      // ranking the URLs had accumulated. Redirecting retires the page and
      // hands its equity to the one that deserves it. The internal links have
      // been retargeted at the destinations directly, so these rules fire only
      // for external links, bookmarks and re-crawls rather than adding a hop
      // to ordinary navigation.
      {
        source: "/what-is-rsi-indicator",
        destination: "/learn/rsi",
        permanent: true,
      },
      {
        source: "/what-is-macd-indicator",
        destination: "/learn/macd",
        permanent: true,
      },
      {
        source: "/stocks-above-200-day-moving-average",
        destination: "/stocks-trading-above-200-day-moving-average",
        permanent: true,
      },
      {
        source: "/stocks-with-unusual-volume",
        destination: "/volume-spike-stocks",
        permanent: true,
      },
      {
        source: "/buy-the-dip-stocks",
        destination: "/stocks-down-20-from-all-time-highs",
        permanent: true,
      },
      {
        source: "/best-free-stock-screener",
        destination: "/stock-screener",
        permanent: true,
      },
      {
        source: "/best-trading-platform-for-beginners",
        destination: "/platforms",
        permanent: true,
      },

      // ── Existing redirects ───────────────────────
      {
        source: "/stocks/:symbol",
        destination: "/stock/:symbol",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [
          {
            type: "host",
            value: "mystockharbor.com",
          },
        ],
        destination: "https://www.mystockharbor.com/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [
          {
            type: "host",
            value: "mystockharbour.com",
          },
        ],
        destination: "https://www.mystockharbor.com/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [
          {
            type: "host",
            value: "www.mystockharbour.com",
          },
        ],
        destination: "https://www.mystockharbor.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default withBotId(nextConfig);
