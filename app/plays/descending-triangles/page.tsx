import type { Metadata } from "next";
import { headers } from "next/headers";
import DescendingTrianglesClient, {
  type PlaysPayload,
} from "./DescendingTrianglesClient";
import { getDescendingTrianglesData } from "@/lib/server/descendingTrianglesBuilder";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Descending Triangle Stock Setups | MyStockHarbor",
  description:
    "Find daily, weekly, and short-term descending triangle stock setups using MyStockHarbor's chart pattern scanner.",
  alternates: {
    canonical: "https://www.mystockharbor.com/plays/descending-triangles",
  },
  openGraph: {
    title: "Descending Triangle Stock Setups | MyStockHarbor",
    description:
      "Review descending triangle candidates, support levels, falling highs, setup scores, and chart structure.",
    url: "https://www.mystockharbor.com/plays/descending-triangles",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Descending Triangle Stock Setups | MyStockHarbor",
    description:
      "Find descending triangle stock setups from chart structure using MyStockHarbor.",
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

// Reads the descending-triangles payload in-process via
// getDescendingTrianglesData() (the same memo/Redis-cached builder the
// /api/descending-triangles route uses) instead of the server fetching its
// own public URL. That self-request carries no browser BotID header, so
// now that /api/descending-triangles is BotID-guarded it would otherwise
// read as bot traffic and get 403'd -- the same self-fetch-gets-blocked
// failure mode already documented as a past production outage in
// claude/pickers-firewall-selfblock-2026-07-17.md. Going in-process removes
// it entirely; the module's in-memory memo + Redis cache still means this
// rarely triggers a fresh scan.
async function getInitialDescendingTrianglesPayload(): Promise<PlaysPayload | null> {
  try {
    const origin = await getOriginFromHeaders();
    const { data, status } = await getDescendingTrianglesData(origin);

    if (status && status >= 400) return null;
    if ((data as { error?: unknown })?.error) return null;

    return data as unknown as PlaysPayload;
  } catch {
    return null;
  }
}

export default async function DescendingTrianglesPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Descending Triangle Stock Setups",
    url: "https://www.mystockharbor.com/plays/descending-triangles",
    description:
      "Daily, weekly, and short-term descending triangle stock chart setups from MyStockHarbor.",
    isPartOf: {
      "@type": "WebSite",
      name: "MyStockHarbor",
      url: "https://www.mystockharbor.com",
    },
  };

  const initialPayload = await getInitialDescendingTrianglesPayload();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd),
        }}
      />
      <DescendingTrianglesClient initialPayload={initialPayload} />
    </>
  );
}
