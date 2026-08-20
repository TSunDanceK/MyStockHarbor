import Link from "next/link";
import type { Metadata } from "next";
import {
  getAllBottleneckPosts,
  getBottleneckCompanyCounts,
} from "@/lib/bottlenecks";
import BottleneckList from "@/app/components/BottleneckList";
import BottleneckArchive from "@/app/components/BottleneckArchive";
import BottleneckLeaderboard from "@/app/components/BottleneckLeaderboard";
import BottlenecksMobileTabs from "@/app/components/BottlenecksMobileTabs";

const PAGE_TITLE =
  "Stock Bottlenecks | Supply Chain & Customer Dependency | MyStockHarbor";
const PAGE_DESCRIPTION =
  "See which companies a stock relies on most - key suppliers and customer concentration - broken down into simple pie charts, one stock built per day.";
const PAGE_URL = "https://www.mystockharbor.com/bottlenecks";
const OG_IMAGE_URL = "https://www.mystockharbor.com/og-image-v2.png";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: {
    canonical: PAGE_URL,
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: PAGE_URL,
    siteName: "MyStockHarbor",
    images: [
      {
        url: OG_IMAGE_URL,
        width: 1200,
        height: 630,
        alt: "MyStockHarbor stock bottlenecks",
      },
    ],
    locale: "en_GB",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [OG_IMAGE_URL],
  },
};

// Was `dynamic = "force-dynamic"`, which ships `Cache-Control: no-store`.
// Nothing on this page is request-dependent: getAllBottleneckPosts() and
// getBottleneckCompanyCounts() are both local content-file reads, and the
// three child components are client components fed entirely by props. The
// underlying markdown can only change on a deploy, so `no-store` bought
// nothing and cost a full serverless render on every crawl of a page that
// carries the crawl path to every /bottlenecks/{ticker} child.
// See claude/seo-recovery-plan-2026-08-15.md item 3.1.
export const revalidate = 3600;

export default function BottlenecksIndexPage() {
  // Newest-first by default (was alphabetical by company name) so freshly
  // built/refreshed pages surface immediately for both readers and
  // crawlers instead of being buried wherever they land alphabetically.
  // BottleneckList still owns its own client-side Latest/A-Z toggle -- this
  // server-side order just has to match that toggle's default state so
  // there's no order flash between SSR paint and hydration.
  const posts = [...getAllBottleneckPosts()].sort((a, b) => {
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    return dateB - dateA;
  });
  const counts = getBottleneckCompanyCounts();

  const bottlenecksJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://www.mystockharbor.com/#organization",
        name: "MyStockHarbor",
        url: "https://www.mystockharbor.com",
        logo: {
          "@type": "ImageObject",
          url: "https://www.mystockharbor.com/logo.png",
        },
      },
      {
        "@type": "CollectionPage",
        "@id": `${PAGE_URL}#webpage`,
        url: PAGE_URL,
        name: "Stock Bottlenecks",
        description: PAGE_DESCRIPTION,
        isPartOf: {
          "@type": "WebSite",
          "@id": "https://www.mystockharbor.com/#website",
          name: "MyStockHarbor",
          url: "https://www.mystockharbor.com",
        },
        about: {
          "@type": "Thing",
          name: "Supply chain and customer concentration risk for public companies",
        },
        publisher: { "@id": "https://www.mystockharbor.com/#organization" },
        mainEntity: { "@id": `${PAGE_URL}#itemlist` },
      },
      {
        "@type": "ItemList",
        "@id": `${PAGE_URL}#itemlist`,
        itemListElement: posts.map((post, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: `${PAGE_URL}/${post.slug}`,
          name: `${post.companyName} (${post.symbol})`,
        })),
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${PAGE_URL}#breadcrumb`,
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
            name: "Bottlenecks",
            item: PAGE_URL,
          },
        ],
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(bottlenecksJsonLd) }}
      />

      <main
        className="bottlenecksMain"
        style={{
          minHeight: "100vh",
          background: "#06080d",
          color: "#f1f5f9",
          fontFamily: "system-ui, Arial",
          padding: "40px 20px",
          overflowX: "hidden",
        }}
      >
        <div style={{ maxWidth: 1160, margin: "0 auto" }}>
          <div style={{ marginBottom: 24 }}>
            <Link
              href="/"
              style={{
                color: "#93c5fd",
                textDecoration: "none",
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              ← Back to Dashboard
            </Link>
          </div>

          {/* Under 960px the three blocks below become two tabs on a docked
              bottom bar: the list (with the archive under it) and the
              leaderboard. Each block declares which tab it belongs to via
              data-bntab; BottlenecksMobileTabs only puts a class on a
              wrapper and lets CSS hide the inactive one, so everything here
              still renders on the server and every archive link stays in the
              served HTML. Above 960px the bar is off and nothing changes.

              The intro card carries no data-bntab on purpose -- it holds the
              h1, so it stays on screen whichever tab is showing. */}
          <BottlenecksMobileTabs>
            {/* Named grid areas rather than nesting, so the single-column
                mobile layout can order the three blocks independently of the
                desktop one. The archive used to sit inside the main column,
                which put it above the leaderboard once the grid collapsed --
                on a phone that meant scrolling past 100+ A-Z links to reach
                the leaderboard. Row gap is 0 and vertical spacing comes from
                each block's own margin, so the desktop layout is unchanged. */}
            <div
              className="bottlenecksIndexLayout"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 340px",
                gridTemplateAreas: `"main rail" "archive rail"`,
                columnGap: 24,
                rowGap: 0,
                alignItems: "start",
              }}
            >
              <div style={{ gridArea: "main", minWidth: 0 }}>
                <section
                  className="bottlenecksIntroCard"
                  style={{
                    background: "#0b1220",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 16,
                    padding: 24,
                    boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
                  }}
                >
                  <h1
                    className="bottlenecksTitle"
                    style={{
                      marginTop: 0,
                      marginBottom: 16,
                      fontSize: 34,
                      lineHeight: 1.1,
                      fontWeight: 900,
                    }}
                  >
                    Stock Bottlenecks
                  </h1>

                  <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
                    Every public company depends on other companies to
                    function - suppliers it can&apos;t easily replace, and
                    customers that make up an outsized share of its revenue.
                    This section breaks that down for one stock at a time,
                    with two pie charts per stock:{" "}
                    <strong>supply-chain dependency</strong> and{" "}
                    <strong>customer concentration</strong>.
                  </p>

                  <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
                    New stock pages are added roughly one per day.
                  </p>
                </section>

                <section data-bntab="list" style={{ marginTop: 24 }}>
                  <BottleneckList posts={posts} />
                </section>
              </div>

              <div
                className="bottlenecksLeaderboardRail"
                data-bntab="board"
                style={{
                  gridArea: "rail",
                  position: "sticky",
                  top: 24,
                  minWidth: 0,
                }}
              >
                <BottleneckLeaderboard counts={counts} />
              </div>

              {/* Crawlable index of the full set. BottleneckList only mounts
                  30 rows before a `See more` button, which Googlebot cannot
                  click -- see the note at the top of BottleneckArchive.tsx.
                  Its own marginTop provides the spacing above it in both
                  layouts, which is why the grid sets rowGap: 0. */}
              <div data-bntab="list" style={{ gridArea: "archive", minWidth: 0 }}>
                <BottleneckArchive posts={posts} />
              </div>
            </div>
          </BottlenecksMobileTabs>
        </div>

        <style>{`
          @media (max-width: 960px) {
            .bottlenecksIndexLayout {
              grid-template-columns: 1fr !important;
              grid-template-areas: "main" "rail" "archive" !important;
            }
            .bottlenecksLeaderboardRail {
              position: static !important;
              margin-top: 24px !important;
            }
          }

          @media (max-width: 640px) {
            .bottlenecksMain {
              padding: 24px 14px !important;
            }
            .bottlenecksIntroCard {
              padding: 18px !important;
            }
            .bottlenecksTitle {
              font-size: 26px !important;
            }
          }
        `}</style>
      </main>
    </>
  );
}
