import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAllPosts, getPostBySlug } from "@/lib/blog";
import { getOrCreateInsightSnapshot } from "@/lib/insightSnapshots";
import { remark } from "remark";
import html from "remark-html";
import InsightPostClient from "./InsightPostClient";
import { submitInsightToIndexNowOnce } from "@/lib/indexnowAuto";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  const posts = getAllPosts();

  return posts.map((post) => ({
    slug: post.slug,
  }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  try {
    const post = getPostBySlug(slug);

    const title = `${post.title} | MyStockHarbor`;

    // Use excerpt if present; otherwise derive a meaningful fallback from the
    // post title rather than a generic "Latest insight…" placeholder.
    const description =
      post.excerpt ||
      (post.symbol
        ? `Technical analysis and market insight on ${post.symbol} from MyStockHarbor.`
        : "Stock market analysis and technical insight from MyStockHarbor.");

    const url = `https://www.mystockharbor.com/insights/${slug}`;
    const image = "https://www.mystockharbor.com/og-image-v2.png";

    // ISO date string for article OG tags — falls back to today if post has no date.
    const publishedTime = post.date
      ? new Date(post.date).toISOString()
      : new Date().toISOString();

    return {
      title,
      description,
      alternates: {
        canonical: url,
      },
      robots: {
        index: true,
        follow: true,
      },
      openGraph: {
        title,
        description,
        url,
        siteName: "MyStockHarbor",
        images: [
          {
            url: image,
            width: 1200,
            height: 630,
            alt: post.title,
          },
        ],
        locale: "en_GB",
        type: "article",
        publishedTime,
        modifiedTime: publishedTime,
        authors: ["https://www.mystockharbor.com"],
        section: "Stock Market Insights",
        tags: post.symbol
          ? [post.symbol, "stock analysis", "technical analysis"]
          : ["stock analysis", "technical analysis", "market insights"],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [image],
      },
    };
  } catch {
    const image = "https://www.mystockharbor.com/og-image.png";

    return {
      title: "Insight | MyStockHarbor",
      description: "Stock market insight from MyStockHarbor.",
      robots: {
        index: true,
        follow: true,
      },
      openGraph: {
        title: "Insight | MyStockHarbor",
        description: "Stock market insight from MyStockHarbor.",
        url: "https://www.mystockharbor.com/insights",
        siteName: "MyStockHarbor",
        images: [
          {
            url: image,
            width: 1200,
            height: 630,
            alt: "MyStockHarbor insight",
          },
        ],
        locale: "en_GB",
        type: "article",
      },
      twitter: {
        card: "summary_large_image",
        title: "Insight | MyStockHarbor",
        description: "Stock market insight from MyStockHarbor.",
        images: [image],
      },
    };
  }
}

export default async function InsightPostPage({ params }: Props) {
  const { slug } = await params;

  let post: ReturnType<typeof getPostBySlug>;

  try {
    post = getPostBySlug(slug);
  } catch {
    notFound();
  }

  const processedContent = await remark().use(html).process(post.content);
  const contentHtml = processedContent.toString();

  const snapshot = await getOrCreateInsightSnapshot({
    slug: post.slug,
    symbol: post.symbol ?? null,
  });

  const insightUrl = `https://www.mystockharbor.com/insights/${post.slug}`;
  const stockUrl = post.symbol
    ? `https://www.mystockharbor.com/stock/${post.symbol.toUpperCase()}`
    : null;

  const publishedTime = post.date
    ? new Date(post.date).toISOString()
    : new Date().toISOString();

  const insightJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        "@id": `${insightUrl}#article`,
        headline: post.title,
        description: post.excerpt,
        datePublished: publishedTime,
        dateModified: publishedTime,
        mainEntityOfPage: {
          "@type": "WebPage",
          "@id": `${insightUrl}#webpage`,
        },
        url: insightUrl,
        author: {
          "@type": "Organization",
          "@id": "https://www.mystockharbor.com/#organization",
          name: "MyStockHarbor",
          url: "https://www.mystockharbor.com",
        },
        publisher: {
          "@type": "Organization",
          "@id": "https://www.mystockharbor.com/#organization",
          name: "MyStockHarbor",
          logo: {
            "@type": "ImageObject",
            url: "https://www.mystockharbor.com/logo.png",
          },
        },
        isPartOf: {
          "@id": "https://www.mystockharbor.com/#website",
        },
        articleSection: "Stock Market Insights",
        keywords: post.symbol
          ? [post.symbol, "stock analysis", "technical analysis", "market insights"]
          : ["stock analysis", "technical analysis", "market insights"],
        about: post.symbol
          ? {
              "@type": "Thing",
              name: post.symbol,
              url: stockUrl,
            }
          : undefined,
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${insightUrl}#breadcrumb`,
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
            name: "Insights",
            item: "https://www.mystockharbor.com/insights",
          },
          {
            "@type": "ListItem",
            position: 3,
            name: post.title,
            item: insightUrl,
          },
        ],
      },
    ],
  };

  void submitInsightToIndexNowOnce(post.slug).catch((error) => {
    console.error("IndexNow auto-submit failed:", error);
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(insightJsonLd),
        }}
      />

      <InsightPostClient
        post={{
          slug: post.slug,
          title: post.title,
          date: post.date,
          excerpt: post.excerpt,
          symbol: post.symbol ?? null,
          timeframe: post.timeframe,
          chartBars: post.chartBars,
          chartIndicators: post.chartIndicators,
          overallBreakdown: post.overallBreakdown,
          latestNews: post.latestNews,
          latestEarnings: post.latestEarnings,
          investorUsefulInfo: post.investorUsefulInfo,
          contentHtml,
        }}
        snapshot={snapshot}
      />
    </>
  );
}
