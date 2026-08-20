import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPostBySlug, getRelatedPosts } from "@/lib/blog";
import { getOrCreateInsightSnapshot } from "@/lib/insightSnapshots";
import { remark } from "remark";
import html from "remark-html";
import InsightPostClient from "./InsightPostClient";
import { submitInsightToIndexNowOnce } from "@/lib/indexnowAuto";
import RelatedInsights from "@/app/components/RelatedInsights";

// Was `dynamic = "force-dynamic"`, which ships `Cache-Control: no-store` and
// forced a full serverless render of a frozen article on every single crawl.
// Insight posts never change after publish — app/sitemap.ts already declares
// them `changeFrequency: "yearly"` — so no-store was the most expensive
// possible setting for the least changeable content on the site, and Google
// could never revalidate one cheaply. See
// claude/seo-recovery-plan-2026-08-15.md item 3.1.
//
// 24 hours: the article body and JSON-LD are fully static, and the only live
// element is the price snapshot, which InsightPostClient already labels and
// degrades gracefully when absent (see the try/catch below).
export const revalidate = 86400;

// `generateStaticParams` was deliberately REMOVED alongside the change above,
// not just left in place. It was inert while force-dynamic was set, so it has
// never actually run; re-enabling it by switching to revalidate would have
// prerendered every post at build time, and each one calls
// getOrCreateInsightSnapshot below — which, on a Redis cache miss, builds a
// fresh snapshot from live FMP data. Against a cold cache and hundreds of
// posts that is a build-time FMP call storm on a plan with a 300/min ceiling
// and a documented history of stage starvation (see the FMP budget notes in
// claude/CLAUDE.md). Without it, posts render on demand once and are then
// cached for `revalidate` — same end state for a crawler, no build-time
// stampede. `dynamicParams` defaults to true, so every slug still resolves.

type Props = {
  params: Promise<{ slug: string }>;
};

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

    // Dynamic OG image is served by opengraph-image.tsx in this directory.
    // Next.js auto-wires it — do NOT set images here or the static URL wins.
    const ogImageUrl = `https://www.mystockharbor.com/insights/${slug}/opengraph-image`;

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
            url: ogImageUrl,
            width: 1200,
            height: 630,
            alt: post.symbol
              ? `${post.symbol} — ${post.title}`
              : post.title,
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
        images: [ogImageUrl],
      },
    };
  } catch {
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
            url: "https://www.mystockharbor.com/og-image-v2.png",
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
        images: ["https://www.mystockharbor.com/og-image-v2.png"],
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

  // getOrCreateInsightSnapshot builds a fresh snapshot (live quote + history +
  // symbol lookup) on a Redis cache miss -- i.e. for every brand-new post.
  // InsightPostClient already renders correctly with snapshot === null (see
  // its `hasSnapshot`/"Archived snapshot" fallbacks), so guard this call: a
  // transient upstream failure here (FMP outage, Redis hiccup, or anything
  // else in the fetch chain) should degrade to a snapshot-less page, never
  // take down the whole post with an uncaught 500. This was exactly the
  // failure mode that made brand-new Insight posts 500 after the 2026-07-20
  // BotID site-wide expansion started 403-ing this snapshot build's internal
  // data calls -- now fixed at the source in lib/insightSnapshots.ts, but
  // this try/catch stays as a safety net against the next thing that can go
  // wrong in that chain.
  let snapshot: Awaited<ReturnType<typeof getOrCreateInsightSnapshot>> = null;

  try {
    snapshot = await getOrCreateInsightSnapshot({
      slug: post.slug,
      symbol: post.symbol ?? null,
    });
  } catch (error) {
    console.error("getOrCreateInsightSnapshot failed:", error);
  }

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

  // Deterministic, no-I/O related-posts selection for the "More Insights"
  // cross-linking module (see lib/blog.ts getRelatedPosts +
  // app/components/RelatedInsights.tsx). Mirrors the "Explore More Stocks"
  // pattern already shipped on /stock/[symbol] (getRelatedSymbols +
  // RelatedStocks.tsx) — individual insight posts previously had exactly
  // one inbound internal link (their listing on the paginated /insights
  // archive), so this gives every post page a small, stable set of links
  // from OTHER post pages too. getAllPosts()/readSortedPosts() is already a
  // local content-file read used elsewhere on this page — no new I/O.
  const relatedPosts = getRelatedPosts(post.slug, post.symbol ?? null, 8);

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

      {/* -- View full stock analysis -----------------------------------
             Small, single, real <Link> to this post's own stock page.
             A July 2026 GSC audit found individual insight posts never
             link to their own /stock/[symbol] page — this closes that gap
             with a minimal addition rather than a whole new module. Kept
             here (server-rendered, in page.tsx) rather than threaded
             through the large InsightPostClient.tsx (~60KB) client
             component, to keep this change small and safe. -- */}
      {post.symbol && (
        <div style={{ background: "#06080d" }}>
          <div style={{ maxWidth: 1240, margin: "0 auto", padding: "20px 20px 0", boxSizing: "border-box" }}>
            <Link
              href={`/stock/${post.symbol.toUpperCase()}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                fontSize: 14,
                fontWeight: 800,
                letterSpacing: "-0.01em",
                color: "#93c5fd",
                textDecoration: "none",
              }}
            >
              View full {post.symbol.toUpperCase()} stock analysis →
            </Link>
          </div>
        </div>
      )}

      <RelatedInsights posts={relatedPosts} />
    </>
  );
}
