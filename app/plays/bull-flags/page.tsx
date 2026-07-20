import type { Metadata } from "next";
import { headers } from "next/headers";
import BullFlagsClient, { type PlaysPayload } from "./BullFlagsClient";
import { getBullFlagsData } from "@/lib/server/bullFlagsBuilder";

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
    const origin = await getOriginFromHeaders();
    const { data, status } = await getBullFlagsData(origin);

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
