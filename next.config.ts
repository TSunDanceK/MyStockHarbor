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
