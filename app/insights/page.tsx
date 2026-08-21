import type { Metadata } from "next";
import { getPaginatedPosts } from "@/lib/blog";
import { getLatestYouTubeVideos } from "@/lib/youtube";
import { getAllVideoMeta, mergeVideoLists } from "@/lib/videoContent";
import InsightsPageClient from "./InsightsPageClient";

const PAGE_SIZE = 20;
const BASE_URL = "https://www.mystockharbor.com/insights";
const TITLE = "Stock Market Insights, Trade Ideas & Market Analysis | MyStockHarbor";
const DESCRIPTION =
  "Read daily stock market insights, chart-based trade ideas, technical analysis updates, and broader market analysis from MyStockHarbor.";

type Props = {
  searchParams: Promise<{ page?: string }>;
};

function parsePage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

// THIS ROUTE IS DELIBERATELY DYNAMIC. Do not "fix" it in an ISR sweep.
//
// Awaiting `searchParams` here opts the route out of static rendering, and that
// is the point rather than an oversight. The per-page canonical below is a
// deliberate SEO decision, and it cannot survive caching: Next has no per-query-
// string cache split, so under ISR every `?page=N` would be served page 1's
// HTML, page 1's canonical, page 1's title and page 1's JSON-LD ItemList. Two
// URLs would then claim to be /insights while PaginationNav still links to them
// -- the exact duplicate-content collapse the canonical exists to prevent, on a
// site mid-indexing-recovery.
//
// Moving pagination client-side (the fix applied to the 32 screener pages in
// #281) does NOT apply here. There, `?filters=` URLs were never indexed and
// every canonical was already pinned to the bare path, so one cached HTML was
// free. Here the paginated URLs are meant to be distinct.
//
// WHAT WOULD CHANGE THIS ANSWER: today the archive is 59 posts across 3 pages,
// `?page=N` is not in the sitemap, and every post is submitted individually via
// insightEntries -- so pagination is not a discovery route for Google, and the
// cost of leaving one URL dynamic is one render per crawl. If the archive grows
// far enough that pagination becomes a genuine discovery path, the answer is a
// real route (`/insights/page/[n]`) that can be cached per page, NOT caching
// this one and losing the canonicals. Revisit then, not before.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { page: pageParam } = await searchParams;
  const requestedPage = parsePage(pageParam);

  // Give every paginated page its own canonical instead of pointing them
  // all back at page 1 - avoids duplicate-content canonical confusion as
  // the archive grows into many pages.
  const canonical = requestedPage > 1 ? `${BASE_URL}?page=${requestedPage}` : BASE_URL;
  const title = requestedPage > 1 ? `${TITLE} — Page ${requestedPage}` : TITLE;

  return {
    title,
    description: DESCRIPTION,
    alternates: { canonical },
    openGraph: {
      title,
      description: DESCRIPTION,
      url: canonical,
      siteName: "MyStockHarbor",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: DESCRIPTION,
    },
  };
}

export default async function InsightsPage({ searchParams }: Props) {
  const { page: pageParam } = await searchParams;
  const requestedPage = parsePage(pageParam);

  const [{ posts, page, totalPages, totalCount }, apiVideos] = await Promise.all([
    Promise.resolve(getPaginatedPosts(requestedPage, PAGE_SIZE)),
    getLatestYouTubeVideos(20),
  ]);

  // The video rail is built from content/videos/*.md first, then enriched
  // with live YouTube data where it's available.
  //
  // It used to be built from getLatestYouTubeVideos() alone, which made every
  // internal link into /insights/videos/* conditional on a third-party API:
  // when the key, quota or circuit breaker took the call out, the page
  // rendered "Videos could not be loaded" and shipped no video links at all.
  // Even healthy, it returned the channel's latest 20 uploads — not the same
  // set as the .md files app/sitemap.ts submits — so any video that aged out
  // of that window permanently lost its only internal link, while uploads
  // with no written analysis got one. GSC showed the consequence directly:
  // video pages discovered via the sitemap with "Referring page: None
  // detected", sitting in "Crawled - currently not indexed".
  //
  // Reading from disk makes the link set deterministic, identical to the
  // sitemap by construction, and immune to API failure. The API is now purely
  // an enhancement (real titles, real thumbnails, real dates) rather than the
  // source of truth. See mergeVideoLists in lib/videoContent.ts.
  const videos = mergeVideoLists(getAllVideoMeta(), apiVideos);

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
        description: DESCRIPTION,
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
      <InsightsPageClient
        posts={posts}
        videos={videos}
        page={page}
        totalPages={totalPages}
        totalCount={totalCount}
      />
    </>
  );
}
