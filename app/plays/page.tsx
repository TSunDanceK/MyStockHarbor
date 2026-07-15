import type { Metadata } from "next";
import { headers } from "next/headers";
import PlaysClient, { type PlaysPayload } from "./PlaysClient";

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

// Server-side fetch of the same payload PlaysClient fetches client-side, so
// crawlers (and the very first paint for real users) see the real scan
// results instead of the "Loading chart-pattern plays..." skeleton. Cached
// via Next's fetch Data Cache for a few minutes -- the /api/plays route
// itself is also memoized (in-memory + Redis) for ~6 minutes, so this
// rarely triggers a fresh scan.
async function getInitialPlaysPayload(): Promise<PlaysPayload | null> {
  try {
    const origin = await getOriginFromHeaders();
    const res = await fetch(`${origin}/api/plays`, {
      next: { revalidate: 300 },
    });

    if (!res.ok) return null;

    const data = (await res.json()) as PlaysPayload;
    if (data?.error) return null;

    return data;
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
