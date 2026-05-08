import type { Metadata } from "next";
import BullFlagsClient from "./BullFlagsClient";

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

export default function BullFlagsPage() {
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

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd),
        }}
      />
      <BullFlagsClient />
    </>
  );
}
