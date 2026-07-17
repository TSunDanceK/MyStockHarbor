import type { Metadata } from "next";
import { headers } from "next/headers";
import BullFlagsClient, { type PlaysPayload } from "./BullFlagsClient";

export const dynamic = "force-dynamic";

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

// Server-side fetch of the same payload BullFlagsClient fetches client-side,
// so crawlers (and the very first paint for real users) see the real scan
// results instead of the "Loading chart-pattern plays..." skeleton. Cached
// via Next's fetch Data Cache for up to an hour -- the /api/bull-flags
// route itself is also memoized (in-memory + Redis) for ~60 minutes, so this
// rarely triggers a fresh scan.
async function getInitialBullFlagsPayload(): Promise<PlaysPayload | null> {
  try {
    const origin = await getOriginFromHeaders();
    const res = await fetch(`${origin}/api/bull-flags`, {
      next: { revalidate: 3600 },
    });

    if (!res.ok) return null;

    const data = (await res.json()) as PlaysPayload;
    if (data?.error) return null;

    return data;
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
