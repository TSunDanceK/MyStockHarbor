import type { Metadata } from "next";
import { headers } from "next/headers";
import PlaysClient, { type PlaysPayload } from "./PlaysClient";
import { getPlaysData } from "@/lib/server/playsBuilder";

export const dynamic = "force-dynamic";

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

async function getOriginFromHeaders() {
  const headerStore = await headers();
  const host =
    headerStore.get("x-forwarded-host") ||
    headerStore.get("host") ||
    "www.mystockharbor.com";

  const proto =
    headerStore.get("x-forwarded-proto") ||
    (host.includes("localhost") ? "http" : "https");

  return `${proto}://${host}`;
}

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
    const origin = await getOriginFromHeaders();
    const { data, status } = await getPlaysData(origin);

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
