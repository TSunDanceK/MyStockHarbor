import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // SE Ranking's backlink crawler enumerates the whole site one hit per
      // page -- ~890 requests/day, all served (see
      // claude/firewall-daily-watch-2026-09-27.md). It brings no traffic of
      // its own, and /bottlenecks/* and /stock/* are lazily populated, so on a
      // cold cache the same walk turns into real upstream FMP demand. It
      // declares itself in the UA and is documented to obey robots.txt, which
      // is why this is a Disallow rather than a firewall rule on Hetzner
      // AS24940 -- that ASN carries plenty of legitimate infrastructure.
      //
      // Keep this separate from lib/server/knownGoodBots.ts: that list decides
      // who is exempt from an IP/JA4 *block*, this is a polite "please don't".
      {
        userAgent: "SERankingBacklinksBot",
        disallow: "/",
      },
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/"],
      },
    ],
    sitemap: "https://www.mystockharbor.com/sitemap.xml",
  };
}
