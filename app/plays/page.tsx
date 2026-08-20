import type { Metadata } from "next";
import PlaysClient, { type PlaysPayload } from "./PlaysClient";
import { getPlaysData } from "@/lib/server/playsBuilder";

// ISR rather than force-dynamic. `force-dynamic` shipped Cache-Control:
// no-store, so every visit and every crawl paid a full serverless render of
// what is, between scans, the same HTML.
//
// 1800s against a payload whose own Redis TTL is 3600s (PLAYS_REDIS_TTL_SECONDS
// in playsBuilder.ts), so the page never trails the data by more than half a
// refresh cycle. See claude/picker-pages-isr-2026-08-20.md.
export const revalidate = 1800;

export const metadata: Metadata = {
  title: "Stock Plays | Ascending Triangle Chart Setups | MyStockHarbor",
  description:
    "Find daily and weekly stock plays using MyStockHarbor's chart pattern scanner. Review ascending triangle setups, resistance levels, rising lows, scores, and chart structure.",
  alternates: {
    canonical: "https://www.mystockharbor.com/plays",
  },
  openGraph: {
    title: "Stock Plays | Ascending Triangle Chart Setups | MyStockHarbor",
    description:
      "Review daily and weekly stock chart pattern plays, including ascending triangle candidates, resistance levels, rising lows, and setup scores.",
    url: "https://www.mystockharbor.com/plays",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stock Plays | MyStockHarbor",
    description:
      "Find daily and weekly stock plays from chart structure using MyStockHarbor.",
  },
};

// The origin used to be read per-request from the request headers, and that
// alone forces dynamic rendering. It is a constant now because it is vestigial:
// the builder's fetchMarket() already reads in-process (it takes `_origin` and
// ignores it, fixed in #262/#263), so nothing downstream reads this value. A
// fixed production origin is correct for every environment that serves this page.
const SITE_ORIGIN = "https://www.mystockharbor.com";

// Reads the plays payload in-process via getPlaysData() (the same
// memo/Redis-cached builder the /api/plays route uses) instead of the
// server fetching its own public URL. That self-request carries no browser
// BotID header, so now that /api/plays is BotID-guarded it would otherwise
// read as bot traffic and get 403'd -- the same self-fetch-gets-blocked
// failure mode already documented as a past production outage in
// claude/pickers-firewall-selfblock-2026-07-17.md. Going in-process removes
// it entirely; the module's in-memory memo + Redis cache still means this
// rarely triggers a fresh scan.
async function getInitialPlaysPayload(): Promise<PlaysPayload | null> {
  try {
    const { data, status } = await getPlaysData(SITE_ORIGIN);

    if (status && status >= 400) return null;
    if ((data as { error?: unknown })?.error) return null;

    return data as unknown as PlaysPayload;
  } catch {
    return null;
  }
}

export default async function PlaysPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Stock Plays",
    url: "https://www.mystockharbor.com/plays",
    description:
      "Daily and weekly stock chart pattern plays from MyStockHarbor, focused on ascending triangle candidates and technical chart structure.",
    isPartOf: {
      "@type": "WebSite",
      name: "MyStockHarbor",
      url: "https://www.mystockharbor.com",
    },
  };

  const initialPayload = await getInitialPlaysPayload();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd),
        }}
      />
      <PlaysClient initialPayload={initialPayload} />
    </>
  );
}
