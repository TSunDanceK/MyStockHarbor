import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // ── Duplicate consolidation (301) ──────────────────────────────
      // /bullish-divergence-stocks is byte-for-byte identical to
      // /bullish-bearish-divergence-stocks (same git tree). Consolidate
      // ranking signals onto the canonical combined page.
      {
        source: "/bullish-divergence-stocks",
        destination: "/bullish-bearish-divergence-stocks",
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
