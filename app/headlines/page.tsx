import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getGeneralMarketHeadlines, type GeneralHeadline } from "@/lib/general-market-news";
import { SHOW_PUBLISHER_IMAGES } from "@/lib/news-image-policy";
import NewsCardArt from "@/app/components/NewsCardArt";
import type { CardArt } from "@/lib/server/news/art";
import { planHeadlineArt } from "@/lib/server/news/artTags";

const PAGE_TITLE = "Market Headlines | Latest Stock Market News | MyStockHarbor";
// NO LONGER PROMISES IMAGES. This said "with images and article excerpts" and
// had said so since the publisher-thumbnail render was switched off in Step 0 --
// a description advertising a feature the page had stopped having. Even with
// the event art wired in below, most general headlines match no title pattern
// and render no picture, so "images" is not a claim this page can make.
const PAGE_DESCRIPTION =
  "The latest general market headlines, straight from the news wire with article excerpts, linked out to the full story - no AI commentary, just the news.";
const PAGE_URL = "https://www.mystockharbor.com/headlines";
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
        alt: "MyStockHarbor market headlines",
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

export const revalidate = 1800;

function formatDate(value: string | null) {
  if (!value) return "Recent";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function compactSource(source: string) {
  return source.replace(/\s+News$/i, "").trim() || "News";
}

export default async function HeadlinesPage() {
  const headlines = await getGeneralMarketHeadlines();

  // ── THE ART PLAN, COMPUTED ONCE FOR THE WHOLE PAGE ──────────────────────
  // ONE CALL PER CARD, AND THE RULE ITSELF LIVES IN artTags.ts. It used to be
  // written out here; it is a function now for the reason that module's header
  // gives at length — a rule in a page body can only be grepped at, and this
  // page is the one that shipped blank for a whole step with every grep-shaped
  // assertion passing. planHeadlineArt is tested by being called.
  //
  // WHAT IT DOES, in order: the article's own words -> tagged v2 art; failing
  // that, the title's event type -> the event bucket this page has shown since
  // #481; failing that, nothing. It never guesses a sector and never draws a
  // ticker card with no ticker.
  //
  // UNTIL THE TAGGED IMAGES LAND this page is byte-for-byte what it is today:
  // manifest-v2.json ships empty, so the first rule returns null for every
  // article and the second one decides every card.
  //
  // BOTH `taken` COLLECTIONS ARE PER PAGE AND LIVE HERE, not inside the card:
  // they are mutated to stop one image repeating down the grid, so every card
  // has to consult the same ones in render order. Two of them because the two
  // libraries are keyed differently — v2 by image NAME, v1 by BUCKET plus a
  // numeric index — and one shared collection would block images it has never
  // used.
  const takenTagNames = new Set<string>();
  const takenByBucket = new Map<string, Set<number>>();
  const headlineArt: CardArt[] = headlines.map((item) =>
    planHeadlineArt({
      title: item.title,
      description: item.excerpt,
      key: item.url,
      takenNames: takenTagNames,
      takenBuckets: takenByBucket,
    })
  );

  const headlinesJsonLd = {
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
        name: "Market Headlines",
        description: PAGE_DESCRIPTION,
        isPartOf: {
          "@type": "WebSite",
          "@id": "https://www.mystockharbor.com/#website",
          name: "MyStockHarbor",
          url: "https://www.mystockharbor.com",
        },
        publisher: { "@id": "https://www.mystockharbor.com/#organization" },
        mainEntity: { "@id": `${PAGE_URL}#itemlist` },
      },
      {
        "@type": "ItemList",
        "@id": `${PAGE_URL}#itemlist`,
        itemListElement: headlines.slice(0, 50).map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: item.title,
          url: item.url,
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
            name: "Headlines",
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(headlinesJsonLd) }}
      />

      <main
        className="headlinesMain"
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

          <section
            className="headlinesIntroCard"
            style={{
              background: "#0b1220",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 16,
              padding: 24,
              boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
              marginBottom: 24,
            }}
          >
            <h1
              className="headlinesTitle"
              style={{
                marginTop: 0,
                marginBottom: 12,
                fontSize: 34,
                lineHeight: 1.1,
                fontWeight: 900,
              }}
            >
              Market Headlines
            </h1>

            <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92, marginBottom: 0 }}>
              The latest general market headlines, straight from the news
              wire - source, first paragraph, and a link to the full story.
              No AI summaries or scoring here, just the news in
              reverse-chronological order.
            </p>
          </section>

          {headlines.length === 0 ? (
            <section
              style={{
                background: "#0b1220",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 16,
                padding: 32,
                textAlign: "center",
                opacity: 0.75,
                fontSize: 15,
                boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
              }}
            >
              No headlines available right now. Check back shortly.
            </section>
          ) : (
            <div style={headlinesGridStyle}>
              {headlines.map((item, index) => (
                <HeadlineCard
                  key={`${item.url}-${index}`}
                  item={item}
                  art={headlineArt[index]}
                />
              ))}
            </div>
          )}

          <p style={{ fontSize: 12.5, opacity: 0.55, marginTop: 16 }}>
            Data source: financialmodelingprep.com. Headlines and excerpts
            are shown as provided by the news feed - read the full article
            at the source for complete context before making any decisions.
          </p>
        </div>

        <style>{`
          @media (max-width: 640px) {
            .headlinesMain {
              padding: 24px 14px !important;
            }
            .headlinesIntroCard {
              padding: 18px !important;
            }
            .headlinesTitle {
              font-size: 26px !important;
            }
          }
        `}</style>
      </main>
    </>
  );
}

function HeadlineCard({ item, art }: { item: GeneralHeadline; art: CardArt }) {
  return (
    <article style={headlineCardStyle}>
      {/*
        HIDDEN, NOT DELETED — the site had no right to display publisher
        thumbnails passed through by FMP, who were never the rights holder.
        lib/news-image-policy.ts has the reasoning and the single flag.

        THE `: null` HERE IS WHAT BROKE THE PAGE. With the flag false this was
        the whole of the branch, so every card rendered no picture at all.

        AND NO CHECK WAS MISSING — one was asserting the opposite. This file sat
        in check-news-art's IMAGELESS_BY_DESIGN list, whose stated reason was
        "5% wire-to-universe match — no per-item symbol to reach a bucket with
        and no price data for a generated card". Both halves are TRUE, and
        neither rules out library art: bucketForItem(eventType, null) reaches an
        event bucket from a TITLE ALONE. A reason sound for the generated card
        was read as a reason for nothing at all — the identical mistake recorded
        against the sector page one step earlier.
      */}
      {SHOW_PUBLISHER_IMAGES && item.image ? (
        <div style={headlineThumbWrapStyle}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.image} alt="" loading="lazy" style={headlineThumbImgStyle} />
        </div>
      ) : art.kind === "none" ? null : (
        /* A headline whose title matches no pattern still renders nothing, and
           that is the designed outcome rather than a gap: with no symbol and no
           sector there is no honest picture to put here. The wrapper is only
           mounted when there IS art, so an imageless card keeps exactly the
           layout it has today instead of gaining an empty box. */
        <div style={headlineThumbWrapStyle}>
          <NewsCardArt
            plan={art}
            symbol=""
            changePct={null}
            points={[]}
            sizes="(max-width: 640px) 100vw, 380px"
            style={headlineThumbImgStyle}
          />
        </div>
      )}

      <div style={headlineMetaRowStyle}>
        <span style={headlineSourcePillStyle}>{compactSource(item.source)}</span>
        <span style={headlineDateStyle}>{formatDate(item.publishedDate)}</span>
      </div>

      <h2 style={headlineTitleStyle}>{item.title}</h2>

      {item.excerpt ? <p style={headlineExcerptStyle}>{item.excerpt}</p> : null}

      <a href={item.url} target="_blank" rel="noopener noreferrer" style={readArticleLinkStyle}>
        Read full article →
      </a>
    </article>
  );
}

const headlinesGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
  gap: 16,
};

const headlineCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: 16,
  background: "rgba(255,255,255,0.028)",
  display: "flex",
  flexDirection: "column",
};

const headlineThumbWrapStyle: CSSProperties = {
  width: "100%",
  aspectRatio: "16 / 9",
  borderRadius: 12,
  overflow: "hidden",
  marginBottom: 12,
  background: "rgba(255,255,255,0.04)",
};

const headlineThumbImgStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};

const headlineMetaRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const headlineSourcePillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "6px 10px",
  borderRadius: 999,
  background: "rgba(59,130,246,0.12)",
  border: "1px solid rgba(59,130,246,0.22)",
  color: "#dbeafe",
  fontSize: 12,
  fontWeight: 800,
};

const headlineDateStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "rgba(241,245,249,0.58)",
};

const headlineTitleStyle: CSSProperties = {
  margin: "12px 0 0 0",
  fontSize: 19,
  lineHeight: 1.32,
  letterSpacing: "-0.01em",
  color: "#f8fafc",
  flexGrow: 0,
};

const headlineExcerptStyle: CSSProperties = {
  margin: "10px 0 0 0",
  fontSize: 14,
  lineHeight: 1.65,
  color: "rgba(241,245,249,0.78)",
  flexGrow: 1,
};

const readArticleLinkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  marginTop: 14,
  padding: "8px 12px",
  borderRadius: 999,
  border: "1px solid rgba(59,130,246,0.30)",
  background: "rgba(59,130,246,0.10)",
  color: "#bfdbfe",
  textDecoration: "none",
  fontWeight: 900,
  fontSize: 12.5,
  whiteSpace: "nowrap",
  alignSelf: "flex-start",
};
