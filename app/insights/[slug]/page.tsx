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

    return {
      title: `${post.title} | MyStockHarbor`,
      description: post.excerpt,
      alternates: {
        canonical: `https://www.mystockharbor.com/insights/${slug}`
      },
      openGraph: {
        title: `${post.title} | MyStockHarbor`,
        description: post.excerpt,
        url: `https://www.mystockharbor.com/insights/${slug}`,
        siteName: "MyStockHarbor",
        type: "article",
      },
      twitter: {
        card: "summary_large_image",
        title: `${post.title} | MyStockHarbor`,
        description: post.excerpt,
      },
    };
  } catch {
    return {
      title: "Insight | MyStockHarbor",
      description: "Stock market insight from MyStockHarbor.",
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

  const insightJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        "@id": `${insightUrl}#article`,
        headline: post.title,
        description: post.excerpt,
        datePublished: post.date,
        dateModified: post.date,
        mainEntityOfPage: {
          "@type": "WebPage",
          "@id": `${insightUrl}#webpage`,
        },
        url: insightUrl,
        author: {
          "@type": "Organization",
          "@id": "https://www.mystockharbor.com/#organization",
          name: "MyStockHarbor",
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
          contentHtml,
        }}
        snapshot={snapshot}
      />
    </>
  );
}
