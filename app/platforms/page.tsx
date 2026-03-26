import type { Metadata } from "next";
import { headers } from "next/headers";
import PlatformsClient from "./PlatformsClient";

export const metadata: Metadata = {
  title: "Best Trading Platforms in the UK & US | MyStockHarbor",
  description:
    "Compare beginner-friendly trading platforms and charting tools for UK and US users, including TradingView, Webull, Robinhood, eToro, Interactive Brokers, and more.",
  alternates: {
    canonical: "https://www.mystockharbor.com/platforms",
  },
  openGraph: {
    title: "Best Trading Platforms in the UK & US | MyStockHarbor",
    description:
      "Compare beginner-friendly trading platforms and charting tools for UK and US users, including TradingView, Webull, Robinhood, eToro, Interactive Brokers, and more.",
    url: "https://www.mystockharbor.com/platforms",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Best Trading Platforms in the UK & US | MyStockHarbor",
    description:
      "Compare beginner-friendly trading platforms and charting tools for UK and US users, including TradingView, Webull, Robinhood, eToro, Interactive Brokers, and more.",
  },
};

function detectRegion(country: string | null): "UK" | "US" {
  if (country === "US") return "US";
  return "UK";
}

export default async function PlatformsPage() {
  const headerStore = await headers();
  const ipCountry =
    headerStore.get("x-vercel-ip-country") ||
    headerStore.get("cf-ipcountry") ||
    headerStore.get("x-country-code");

  const initialRegion = detectRegion(ipCountry?.toUpperCase() ?? null);

  const schema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Best Trading Platforms in the UK & US",
    url: "https://www.mystockharbor.com/platforms",
    description:
      "Compare beginner-friendly trading platforms and charting tools for UK and US users.",
    about: {
      "@type": "Thing",
      name: "Trading platforms and chart analysis tools",
    },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: "https://www.mystockharbor.com/",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Platforms",
          item: "https://www.mystockharbor.com/platforms",
        },
      ],
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <PlatformsClient initialRegion={initialRegion} />
    </>
  );
}
