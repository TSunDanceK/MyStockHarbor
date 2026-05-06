import type { Metadata } from "next";
import DescendingTrianglesClient from "./DescendingTrianglesClient";

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

export default function DescendingTrianglesPage() {
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

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd),
        }}
      />
      <DescendingTrianglesClient />
    </>
  );
}
