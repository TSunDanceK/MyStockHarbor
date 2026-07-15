import type { Metadata } from "next";
import { headers } from "next/headers";
import DescendingTrianglesClient, {
  type PlaysPayload,
} from "./DescendingTrianglesClient";

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

// Server-side fetch of the same payload DescendingTrianglesClient fetches
// client-side, so crawlers (and the very first paint for real users) see
// the real scan results instead of a loading skeleton. Cached via Next's
// fetch Data Cache for a few minutes -- the /api/descending-triangles route
// itself is also memoized (in-memory + Redis) for ~6 minutes, so this
// rarely triggers a fresh scan.
async function getInitialDescendingTrianglesPayload(): Promise<PlaysPayload | null> {
  try {
    const origin = await getOriginFromHeaders();
    const res = await fetch(`${origin}/api/descending-triangles`, {
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
