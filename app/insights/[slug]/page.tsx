import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPostBySlug } from "@/lib/blog";
import { getOrCreateInsightSnapshot } from "@/lib/insightSnapshots";
import { remark } from "remark";
import html from "remark-html";
import { submitInsightToIndexNowOnce } from "@/lib/indexnowAuto";
import { getInsightPageDataCached, isInsightFixture, readInsightSource } from "@/lib/server/insightPage";
import InsightPage from "./InsightPage";
import { hasFiledEarnings } from "@/lib/server/filedEarnings";

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

// generateStaticParams is REMOVED, and must stay removed until the condition
// below is met. #310 added it as an empty array, which made this route ● --
// and a prerendered route that performs a `no-store` fetch at request time
// throws DYNAMIC_SERVER_USAGE and returns 500. getOrCreateInsightSnapshot
// reaches Redis through a BARE client that does not use PAGE_READ_CACHE, so
// every request to a real slug 500'd in production for ~3.5 hours. Reverted in
// #323.
//
// The finding #310 documented is still true: without this export the
// `revalidate` above is inert and this route is fully dynamic. That is a
// performance cost, not an outage, and it is the correct trade until the read
// path is safe.
//
// BEFORE RE-ADDING, both must hold:
//   1. Every Redis client on this route's transitive read path uses
//      PAGE_READ_CACHE (lib/server/redisCacheMode.ts), not a bare
//      Redis.fromEnv(). Start with getOrCreateInsightSnapshot in
//      lib/insightSnapshots.ts.
//   2. A real slug has been requested against a preview deployment and
//      returned 200. The route table showing ● proves the route BECAME static;
//      it says nothing about whether the route SURVIVES being static, and a
//      preview build never issues that request on its own.
//
// See claude/traps/inert-route-revalidate.md and Rule 4 in
// claude/picker-pages-isr-2026-08-20.md.
//
// ---- what #310 said, kept because the FMP reasoning below is still correct ----
//
// `generateStaticParams` returns an EMPTY array, and both halves of that matter.
//
// The concern that removed it entirely was correct: prerendering every post at
// build would call getOrCreateInsightSnapshot below for each one, which on a
// Redis miss builds a fresh snapshot from live FMP data. Against a cold cache
// and hundreds of posts that is a build-time call storm on a plan with a
// 300/min ceiling and a documented history of stage starvation (see the FMP
// budget notes in claude/CLAUDE.md). An empty list still avoids all of that --
// nothing is prerendered at build.
//
// But REMOVING the export did not do what its comment claimed. It said posts
// would "render on demand once and are then cached for `revalidate`". They did
// not. A dynamic segment cannot be ISR at all without a generateStaticParams
// export, even with every dynamic API and no-store call already gone -- so this
// route stayed fully dynamic and `revalidate = 86400` above has NEVER ONCE HAD
// ANY EFFECT since it was written. Nothing warns about this: the config reads
// as active, the build is green, and the only symptom is an `f` in the route
// table. See claude/traps/inert-route-revalidate.md and Rule 4 in
// claude/picker-pages-isr-2026-08-20.md.
//
// Empty is the shape that satisfies both: no build-time prerender, and
// on-demand ISR that actually caches. `dynamicParams` defaults to true, so
// every slug still resolves.
type Props = {
  params: Promise<{ slug: string }>;
};

/**
 * The post, or a preview-only fixture (#563 COWORK #133) shaped like one.
 * Throws when neither exists.
 */
function postFor(slug: string): ReturnType<typeof getPostBySlug> {
  try {
    return getPostBySlug(slug);
  } catch (error) {
    if (!isInsightFixture(slug)) throw error;
    const { n } = readInsightSource(slug);
    return {
      slug, title: n.title, date: n.date, excerpt: n.summary, symbol: n.symbol, timeframe: n.timeframe, chartBars: null, chartIndicators: [],
      overallBreakdown: "", latestNews: "", latestEarnings: "", investorUsefulInfo: "", content: "",
    };
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  try {
    const post = postFor(slug);

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
    // CHANGES ONLY WHEN THE TEXT DOES (#563 COWORK #138): the post's own `updated`, else its date.
    const updated = (() => { try { return readInsightSource(slug).n.updated; } catch { return null; } })();
    const modifiedTime = updated ? new Date(updated).toISOString() : publishedTime;

    return {
      title,
      description,
      alternates: {
        canonical: url,
      },
      // A preview fixture is never indexed.
      robots: isInsightFixture(slug) ? { index: false, follow: false } : {
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
        modifiedTime,
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
    post = postFor(slug);
  } catch {
    notFound();
  }

  // THE PAGE (#563 COWORK #132/#133): one template for every post, its
  // figures from lib/server/insightPage.ts. The post's own text is rendered
  // from its markdown as written.
  const data = await getInsightPageDataCached(post.slug);
  const md = async (src: string | null) => (src ? (await remark().use(html).process(src)).toString() : null);
  const [whatHappened, why, originalRest] = await Promise.all([md(data.n.whatHappened), md(data.n.why), md(data.n.originalRest)]);

  // "CHART WHEN PUBLISHED": the frozen snapshot (B's reader, its contract
  // unchanged) drawn as a thumbnail, its closes cut at the snapshot date;
  // without one, the stored bars cut at the publish date. A failure here
  // degrades to the bars' version, never a 500.
  let snapshot: Awaited<ReturnType<typeof getOrCreateInsightSnapshot>> = null;
  try {
    snapshot = await getOrCreateInsightSnapshot({ slug: post.slug, symbol: post.symbol ?? null });
  } catch (error) {
    console.error("getOrCreateInsightSnapshot failed:", error);
  }
  const frozen = snapshot?.chartPoints?.length ? snapshot.chartPoints.slice(-120).map((p) => p.close) : null;
  const thumb = frozen && frozen.length > 1 ? frozen : data.thumb;

  const insightUrl = `https://www.mystockharbor.com/insights/${post.slug}`;
  const stockUrl = post.symbol
    ? `https://www.mystockharbor.com/stock/${post.symbol.toUpperCase()}`
    : null;

  const publishedTime = post.date
    ? new Date(post.date).toISOString()
    : new Date().toISOString();

  // ARTICLE + BREADCRUMB (#563 COWORK #138): dateModified moves only when the
  // post's text does (its frontmatter `updated`), never on the daily data
  // refresh; the image is the hero's picture.
  const modifiedTime = data.n.updated ? new Date(data.n.updated).toISOString() : publishedTime;
  const heroImage = data.art.kind === "library" ? `https://www.mystockharbor.com${data.art.art.src}` : `${insightUrl}/opengraph-image`;
  const sym = data.n.symbol;
  const insightJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${insightUrl}#article`,
        headline: post.title,
        description: post.excerpt,
        image: [heroImage],
        datePublished: publishedTime,
        dateModified: modifiedTime,
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
          // Insights › TICKER › the post.
          {
            "@type": "ListItem",
            position: 1,
            name: "Insights",
            item: "https://www.mystockharbor.com/insights",
          },
          {
            "@type": "ListItem",
            position: 2,
            name: sym,
            item: `https://www.mystockharbor.com/stock/${sym}`,
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

      <InsightPage d={data} html={{ whatHappened, why, originalRest }} thumb={thumb} hasFiledEarnings={await hasFiledEarnings(data.n.symbol)} />
    </>
  );
}
