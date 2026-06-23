import type { Metadata } from "next";
import Link from "next/link";
import { getAllPosts } from "@/lib/blog";
import { getLatestYouTubeVideos } from "@/lib/youtube";
import InsightsPageClient from "./InsightsPageClient";

export const metadata: Metadata = {
  title: "Stock Market Insights, Trade Ideas & Market Analysis | MyStockHarbor",
  description:
    "Read daily stock market insights, chart-based trade ideas, technical analysis updates, and broader market analysis from MyStockHarbor.",
  alternates: { canonical: "https://www.mystockharbor.com/insights" },
  openGraph: {
    title: "Stock Market Insights, Trade Ideas & Market Analysis | MyStockHarbor",
    description: "Read daily stock market insights, chart-based trade ideas, technical analysis updates, and broader market analysis from MyStockHarbor.",
    url: "https://www.mystockharbor.com/insights",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stock Market Insights, Trade Ideas & Market Analysis | MyStockHarbor",
    description: "Read daily stock market insights, chart-based trade ideas, technical analysis updates, and broader market analysis from MyStockHarbor.",
  },
};

export default async function InsightsPage() {
  const [posts, videos] = await Promise.all([
    Promise.resolve(getAllPosts()),
    getLatestYouTubeVideos(20),
  ]);

  const insightsJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://www.mystockharbor.com/#organization",
        name: "MyStockHarbor",
        url: "https://www.mystockharbor.com",
        logo: { "@type": "ImageObject", url: "https://www.mystockharbor.com/logo.png" },
      },
      {
        "@type": "CollectionPage",
        "@id": "https://www.mystockharbor.com/insights#webpage",
        url: "https://www.mystockharbor.com/insights",
        name: "Stock Market Insights & Trade Ideas",
        description: "Read daily stock market insights, chart-based trade ideas, and technical analysis updates from MyStockHarbor.",
        isPartOf: { "@type": "WebSite", "@id": "https://www.mystockharbor.com/#website", name: "MyStockHarbor", url: "https://www.mystockharbor.com" },
        about: { "@type": "Thing", name: "Stock market insights and technical analysis" },
        publisher: { "@id": "https://www.mystockharbor.com/#organization" },
        mainEntity: { "@id": "https://www.mystockharbor.com/insights#itemlist" },
      },
      {
        "@type": "ItemList",
        "@id": "https://www.mystockharbor.com/insights#itemlist",
        itemListElement: posts.slice(0, 12).map((post, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: `https://www.mystockharbor.com/insights/${post.slug}`,
          name: post.title,
          item: {
            "@type": "BlogPosting",
            headline: post.title,
            url: `https://www.mystockharbor.com/insights/${post.slug}`,
            datePublished: post.date,
            dateModified: post.date,
            description: post.excerpt,
            author: { "@type": "Organization", name: "MyStockHarbor" },
            publisher: { "@id": "https://www.mystockharbor.com/#organization" },
            about: post.symbol ? { "@type": "Thing", name: post.symbol } : { "@type": "Thing", name: "Stock market analysis" },
          },
        })),
      },
      {
        "@type": "BreadcrumbList",
        "@id": "https://www.mystockharbor.com/insights#breadcrumb",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://www.mystockharbor.com/" },
          { "@type": "ListItem", position: 2, name: "Insights", item: "https://www.mystockharbor.com/insights" },
        ],
      },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(insightsJsonLd) }} />
      <InsightsPageClient posts={posts} videos={videos} />
    </>
  );
}
