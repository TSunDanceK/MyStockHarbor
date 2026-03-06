import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [
          {
            type: "host",
            value: "mystockharbour.com",
          },
        ],
        destination: "https://mystockharbor.com/:path*",
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
        destination: "https://mystockharbor.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
