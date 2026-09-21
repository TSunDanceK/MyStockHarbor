import Link from "next/link";
import type { Metadata } from "next";
import { getIpoTables, ipoProvider } from "@/lib/server/ipoCalendar";
import IpoList from "./IpoList";
import { refuseToCacheDegradedRender } from "@/lib/server/degradedRender";

const PAGE_TITLE = "Upcoming IPOs This Month | Confirmed IPO Calendar | MyStockHarbor";

// ── THE DESCRIPTION LISTS THE COLUMNS, SO IT HAS TO LOSE THE ONE THAT GOES ─
//
// NOT ON THE BRIEF'S LIST, and changed anyway, because the flip makes it false:
// it advertises "market cap for each listing" and the SEC path has no market
// cap to give. The whole argument for this migration is that the page stops
// claiming what it cannot deliver, and a meta description is a claim Google
// quotes.
//
// MINIMAL ON PURPOSE. The title is untouched, the <h1> is untouched, and the
// only edit is dropping the column that no longer exists — reverting is
// deleting one branch. The FMP branch keeps the original string verbatim so
// nothing changes while the flag is unflipped.
const PAGE_DESCRIPTION_FMP =
  "Confirmed, priced IPOs expected in the next 30 days - ticker, exchange, price range, shares offered, deal size and market cap for each listing.";
const PAGE_DESCRIPTION_SEC =
  "Companies that have filed to list on Nasdaq and NYSE and set terms - ticker, exchange, price range, shares offered and deal size for each, from SEC filings.";
const PAGE_URL = "https://www.mystockharbor.com/upcoming-ipos";
const OG_IMAGE_URL = "https://www.mystockharbor.com/og-image-v2.png";

// Evaluated where the page renders, which for an ISR route is the build and
// each revalidation -- both server-side, so process.env is readable. This is
// the same seam the body uses; it is read twice rather than threaded through,
// because `metadata` is a module export and cannot take an argument.
const PAGE_DESCRIPTION =
  ipoProvider() === "sec" ? PAGE_DESCRIPTION_SEC : PAGE_DESCRIPTION_FMP;

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
        alt: "MyStockHarbor upcoming IPO calendar",
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

// 86400s (daily), and this number is NOT independently chosen -- it is
// IPO_REVALIDATE_SECONDS from lib/server/ipoCalendar.ts, which is also the
// freshness readFeed is given and the next: { revalidate } on the FMP fetch.
// All three have to agree, and scripts/check-ipo-cadence.mjs is what proves
// they do. It is written out as a literal only because Next requires a segment
// config to be statically analysable and will not follow an import.
//
// Next takes the MINIMUM of a route's revalidate and any fetch revalidate
// reached during its render, so a fetch-level value silently overrides a larger
// page constant. This page previously declared 14400 (four hours) and shipped
// as "30m" in the route table, and nothing in the source said why. See
// claude/traps/fetch-revalidate-caps-the-page.md. Raising this without raising
// the fetch would put it straight back in that state -- the route table would
// still read 30m and this constant would again describe a cadence the page
// does not have.
//
// Daily rather than the previous 1800s: an IPO calendar changes at most once a
// day, and 48 revalidations a day were spending FMP bandwidth against a cap
// whose penalty is suspension.
//
// Was force-dynamic purely because a failed read used to be unsafe to cache;
// refuseToCacheDegradedRender() below is what removes that.
export const revalidate = 86400;

export default async function UpcomingIposPage() {
  // ONE READ, BOTH TABLES. Was a Promise.all of two feeds with two upstream
  // calls; membership now travels on each row, so one cache entry answers both
  // halves and they can never disagree about which table a company is in.
  const feed = await getIpoTables();

  // A degraded read refuses the artefact: this page renders both lists from one
  // feed, so a failed read would bake "we couldn't load it" into a cached page
  // and serve that claim to every visitor and every crawler for the whole
  // revalidate window. (Was "EITHER feed" when there were two.) Safe here because /upcoming-ipos
  // is a PARAMLESS STATIC route -- on a generateStaticParams route the same
  // call returns a 500. See lib/server/degradedRender.ts.
  if (!feed.ok) {
    await refuseToCacheDegradedRender("/upcoming-ipos");
  }

  const ipos = feed.upcoming;
  const recentIpos = feed.recent;

  // ── WHICH SOURCE IS ANSWERING, DECIDED SERVER-SIDE ───────────────────────
  // IpoList is a client component, so it cannot read IPO_PROVIDER: a
  // server-only var is not in the bundle, and NEXT_PUBLIC_ would inline it at
  // BUILD time so a provider flip needed a rebuild to show. This page is a
  // server component and already knows, so it resolves the question once and
  // passes booleans and strings down.
  const provider = ipoProvider();
  const isSec = provider === "sec";

  // Only claim an ItemList when the read actually succeeded. On a failed read
  // `ipos` is [] and means nothing, and emitting an ItemList with zero items
  // asserts to Google that this page's entire subject does not exist -- a
  // stronger negative signal than the visible copy, on a page whose ranking
  // case IS the list. Asserting nothing is the correct degradation.
  const hasItemList = feed.ok;

  const ipoJsonLd = {
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
        name: "Upcoming IPOs",
        description: PAGE_DESCRIPTION,
        isPartOf: {
          "@type": "WebSite",
          "@id": "https://www.mystockharbor.com/#website",
          name: "MyStockHarbor",
          url: "https://www.mystockharbor.com",
        },
        publisher: { "@id": "https://www.mystockharbor.com/#organization" },
        // Omitted alongside the ItemList itself, so this never dangles.
        ...(hasItemList ? { mainEntity: { "@id": `${PAGE_URL}#itemlist` } } : {}),
      },
      ...(hasItemList
        ? [
            {
              "@type": "ItemList",
              "@id": `${PAGE_URL}#itemlist`,
              itemListElement: ipos.map((ipo, index) => ({
                "@type": "ListItem",
                position: index + 1,
                // NEVER `${company} (${symbol})` UNGUARDED. A company that has
                // filed but not priced has no ticker, and the template literal
                // renders that as the string "(null)" -- straight into the
                // structured data on a page whose entire ranking case IS this
                // list. Same failure the hasItemList guard above exists to
                // prevent in its other form.
                name: ipo.symbol ? `${ipo.company} (${ipo.symbol})` : ipo.company,
              })),
            },
          ]
        : []),
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
            name: "Upcoming IPOs",
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ipoJsonLd) }}
      />

      <main
        className="ipoCalendarMain"
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
            className="ipoCalendarIntroCard"
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
              className="ipoCalendarTitle"
              style={{
                marginTop: 0,
                marginBottom: 12,
                fontSize: 34,
                lineHeight: 1.1,
                fontWeight: 900,
              }}
            >
              Upcoming IPOs
            </h1>

            {/* ── THE COPY IS WHERE THE LOSS BECOMES HONEST ──────────────
                THERE IS NO EXPECTED LISTING DATE IN ANY FILING. Measured: the
                amendment carrying terms lands a median of 7 days before pricing
                and carries NO date; the final prospectus carries one but lands a
                median of 2 days before trading. The date is an underwriter
                convention, not a filed fact.

                So the upper table is UNDATED BY CONSTRUCTION, and the house rule
                on hedged language applies — describe what is known, do not
                forecast. No "expected soon", no "coming weeks", nothing that
                implies a timing the page does not have. That is the finding, and
                this is where it stops being hidden.

                The FMP branch keeps its original wording: its date genuinely IS
                a forward expected listing date, so "expected over the next 30
                days" was true there and would be false here. */}
            <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92, marginBottom: 0 }}>
              {isSec
                ? "These companies have filed to list and set terms. The listing date is not announced until pricing, which is typically a few days before trading begins."
                : "Confirmed, priced IPOs expected over the next 30 days. Listings are shown once underwriters have finalized the price range and share count — not every rumored or filed IPO, only the ones that are actually locked in."}
            </p>
          </section>

          <section
            style={{
              background: "#0b1220",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 16,
              overflow: "hidden",
              boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
              marginBottom: 32,
            }}
          >
            <IpoList
              ipos={ipos}
              // "Terms set", NOT "IPO Date", and this is the honest half of the
              // whole migration. On the SEC path this column is the AMENDMENT
              // date -- the day terms were filed -- and it is always in the
              // past. There is no expected listing date in any filing: the
              // amendment that carries terms lands a median of 7 days before
              // pricing and carries no date at all. Calling it "IPO Date" would
              // be the page stating something it does not know.
              dateColumnLabel={isSec ? "Terms set" : "IPO Date"}
              showMarketCap={!isSec}
              emptyMessage={
                feed.ok
                  ? "No confirmed IPOs are currently scheduled in the next 30 days. Check back soon — this list updates as new deals are priced."
                  : "We couldn't load the IPO calendar just now. This is a temporary problem on our side, not an empty calendar — please refresh in a moment."
              }
            />
          </section>

          <section
            className="ipoCalendarIntroCard"
            style={{
              background: "#0b1220",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 16,
              padding: 24,
              boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
              marginBottom: 24,
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: 12,
                fontSize: 26,
                lineHeight: 1.1,
                fontWeight: 900,
              }}
            >
              Recent IPOs
            </h2>

            <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92, marginBottom: 0 }}>
              Confirmed IPOs that listed within the last 30 days, most recent
              first.
            </p>
          </section>

          <section
            style={{
              background: "#0b1220",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 16,
              overflow: "hidden",
              boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
            }}
          >
            <IpoList
              ipos={recentIpos}
              // "Listed" on the SEC path: this date IS the final prospectus's,
              // which is the listing, so the shorter word is simply the
              // accurate one beside "Terms set" above.
              dateColumnLabel={isSec ? "Listed" : "Listing Date"}
              showMarketCap={!isSec}
              emptyMessage={
                feed.ok
                  ? "No confirmed IPOs listed in the last 30 days."
                  : "We couldn't load recent IPO listings just now. This is a temporary problem on our side — please refresh in a moment."
              }
            />
          </section>

          {/* THE SOURCE LINE IS FALSE THE MOMENT THE FLAG FLIPS, which is why
              it moves with the provider rather than being rewritten once. The
              hedge is unchanged in both branches: it was right before and is
              right now. */}
          <p style={{ fontSize: 12.5, opacity: 0.55, marginTop: 16 }}>
            {isSec
              ? "Data source: SEC EDGAR filings (public domain) — compiled from S-1/A, F-1/A, 424B and 8-A12B filings. "
              : "Data source: financialmodelingprep.com. "}
            IPO terms can change before listing day — treat this as a starting
            point for further research, not investment advice.
          </p>

          <p style={{ fontSize: 14, marginTop: 24 }}>
            Continue exploring:{" "}
            <Link
              href="/earnings-calendar"
              style={{ color: "#93c5fd", textDecoration: "none", fontWeight: 700 }}
            >
              Earnings Calendar →
            </Link>
          </p>
        </div>

        <style>{`
          @media (max-width: 640px) {
            .ipoCalendarMain {
              padding: 24px 14px !important;
            }
            .ipoCalendarIntroCard {
              padding: 18px !important;
            }
            .ipoCalendarTitle {
              font-size: 26px !important;
            }
          }
        `}</style>
      </main>
    </>
  );
}
