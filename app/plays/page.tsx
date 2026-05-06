import type { Metadata } from "next";
import PlaysClient from "./PlaysClient";

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

export default function PlaysPage() {
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

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd),
        }}
      />
      <PlaysClient />
    </>
  );
}
