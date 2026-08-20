import type { Metadata } from "next";
import BullFlagsClient, { type PlaysPayload } from "./BullFlagsClient";
import { getBullFlagsData } from "@/lib/server/bullFlagsBuilder";

// ISR rather than force-dynamic. `force-dynamic` shipped Cache-Control:
// no-store, so every visit and every crawl paid a full serverless render of
// what is, between scans, the same HTML.
//
// 1800s against a payload whose own Redis TTL is 3600s (PLAYS_REDIS_TTL_SECONDS
// in playsBuilder.ts), so the page never trails the data by more than half a
// refresh cycle. See claude/picker-pages-isr-2026-08-20.md.
export const revalidate = 1800;

export const metadata: Metadata = {
  title: "Bull Flag Stock Setups | MyStockHarbor",
  description:
    "Find macro, weekly, daily, and short-term bull flag stock setups using MyStockHarbor's chart pattern scanner.",
  alternates: {
    canonical: "https://www.mystockharbor.com/plays/bull-flags",
  },
  openGraph: {
    title: "Bull Flag Stock Setups | MyStockHarbor",
    description:
      "Review bull flag candidates, pole moves, flag retracements, breakout areas, setup scores, and chart structure.",
    url: "https://www.mystockharbor.com/plays/bull-flags",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bull Flag Stock Setups | MyStockHarbor",
    description:
      "Find bull flag stock setups from chart structure using MyStockHarbor.",
  },
};

// The origin used to be read per-request from the request headers, and that
// alone forces dynamic rendering. It is a constant now because it is vestigial:
// the builder's fetchMarket() already reads in-process (it takes `_origin` and
// ignores it, fixed in #262/#263), so nothing downstream reads this value. A
// fixed production origin is correct for every environment that serves this page.
const SITE_ORIGIN = "https://www.mystockharbor.com";

// Reads the bull-flags payload in-process via getBullFlagsData() (the same
// memo/Redis-cached builder the /api/bull-flags route uses) instead of the
// server fetching its own public URL. That self-request carries no browser
// BotID header, so now that /api/bull-flags is BotID-guarded it would
// otherwise read as bot traffic and get 403'd -- the same self-fetch-gets-
// blocked failure mode already documented as a past production outage in
// claude/pickers-firewall-selfblock-2026-07-17.md. Going in-process removes
// it entirely; the module's in-memory memo + Redis cache still means this
// rarely triggers a fresh scan.
async function getInitialBullFlagsPayload(): Promise<PlaysPayload | null> {
  try {
    const { data, status } = await getBullFlagsData(SITE_ORIGIN);

    if (status && status >= 400) return null;
    if ((data as { error?: unknown })?.error) return null;

    return data as unknown as PlaysPayload;
  } catch {
    return null;
  }
}

export default async function BullFlagsPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Bull Flag Stock Setups",
    url: "https://www.mystockharbor.com/plays/bull-flags",
    description:
      "Macro, weekly, daily, and short-term bull flag stock chart setups from MyStockHarbor.",
    isPartOf: {
      "@type": "WebSite",
      name: "MyStockHarbor",
      url: "https://www.mystockharbor.com",
    },
  };

  const initialPayload = await getInitialBullFlagsPayload();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd),
        }}
      />
      <BullFlagsClient initialPayload={initialPayload} />
    </>
  );
}
