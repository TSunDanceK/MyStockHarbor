import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // ── Duplicate consolidation (301) ──────────────────────────────
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

      // ── Removed page cleanup (301) ──────────────────────────────────
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

      // ── Existing redirects ─────────────────────────────────────────
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

export default nextConfig;
