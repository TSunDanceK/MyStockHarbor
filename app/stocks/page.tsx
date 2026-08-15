import type { Metadata } from "next";
import Link from "next/link";

import { priorityStocks, uniqueEtfs } from "@/lib/curatedSymbols";
import { getCompanyNameMap } from "@/lib/server/companyNames";

// Why this page exists
// --------------------
// The 2026-08-15 Search Console audit found 594 URLs sitting in "Discovered -
// currently not indexed" with `Last crawled: N/A` -- Google knew about them
// from the sitemap but had never fetched a single one. The largest single
// cluster was 322 /stock/{sym}/news and /stock/{sym}/earnings URLs, which had
// exactly one inbound internal link each (their own parent /stock/{sym} page)
// and no hub, index or listing page anywhere on the site pointing at them.
// RelatedStocks.tsx -- the module built specifically to fix stock-page
// internal linking -- only ever emits the bare /stock/{sym} URL.
//
// A sitemap entry is a suggestion. An internal link is a path. With ~33 crawl
// requests a day across the whole site, Google was never going to work its
// way down to a page nothing linked to.
//
// This is that path: one crawlable page carrying a direct link to all three
// routes for every symbol in the curated universe, itself linked from the
// site-wide footer so it is never more than one hop from anywhere.
//
// See claude/seo-recovery-plan-2026-08-15.md (Phase 2.2).

export const runtime = "nodejs";

// The company-name lookup behind this page caches for 24h at the fetch layer
// (lib/server/companyNames.ts), and the curated symbol lists are edited by
// hand, so there is nothing here that changes faster than daily. Deliberately
// `revalidate` rather than `force-dynamic`: a directory whose whole job is to
// be crawled should be cheap to re-crawl.
export const revalidate = 86400;

const SITE = "https://www.mystockharbor.com";
const PAGE_URL = `${SITE}/stocks`;
const PAGE_TITLE = "Stock Directory — Every Stock & ETF We Cover | MyStockHarbor";
const PAGE_DESCRIPTION =
  "Full A-Z directory of every stock and ETF covered on MyStockHarbor. Jump straight to technical analysis, latest news or earnings history for any ticker.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  robots: { index: true, follow: true },
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: PAGE_URL,
    siteName: "MyStockHarbor",
    type: "website",
    images: [
      {
        url: `${SITE}/og-image-v2.png`,
        width: 1200,
        height: 630,
        alt: "MyStockHarbor stock directory",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [`${SITE}/og-image-v2.png`],
  },
};

type DirectoryEntry = {
  symbol: string;
  name: string | null;
};

// Group by first character, so BRK.B files under B and 3-prefixed tickers
// don't create a stray bucket. Anything non-alphabetic lands in "#".
function groupByInitial(entries: DirectoryEntry[]) {
  const groups = new Map<string, DirectoryEntry[]>();

  for (const entry of entries) {
    const first = entry.symbol.charAt(0).toUpperCase();
    const key = /[A-Z]/.test(first) ? first : "#";
    const bucket = groups.get(key);
    if (bucket) bucket.push(entry);
    else groups.set(key, [entry]);
  }

  return Array.from(groups.entries())
    .map(([letter, items]) => ({
      letter,
      items: items.sort((a, b) => a.symbol.localeCompare(b.symbol)),
    }))
    .sort((a, b) => {
      if (a.letter === "#") return 1;
      if (b.letter === "#") return -1;
      return a.letter.localeCompare(b.letter);
    });
}

const cardStyle = {
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.18)",
  background: "rgba(15,23,42,0.55)",
  padding: "14px 16px",
} as const;

const subLinkStyle = {
  fontSize: 12,
  color: "rgba(148,163,184,0.95)",
  textDecoration: "none",
  borderBottom: "1px solid rgba(148,163,184,0.25)",
} as const;

function DirectorySection({
  id,
  heading,
  blurb,
  entries,
  showEarnings,
}: {
  id: string;
  heading: string;
  blurb: string;
  entries: DirectoryEntry[];
  showEarnings: boolean;
}) {
  const groups = groupByInitial(entries);

  return (
    <section id={id} style={{ marginTop: 44 }}>
      <h2 style={{ fontSize: 24, margin: "0 0 6px" }}>{heading}</h2>
      <p
        style={{
          margin: "0 0 18px",
          color: "rgba(203,213,225,0.85)",
          fontSize: 15,
          maxWidth: 720,
        }}
      >
        {blurb}
      </p>

      {groups.map((group) => (
        <div key={group.letter} style={{ marginBottom: 26 }}>
          <h3
            style={{
              fontSize: 13,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              color: "rgba(148,163,184,0.9)",
              margin: "0 0 10px",
              paddingBottom: 6,
              borderBottom: "1px solid rgba(148,163,184,0.15)",
            }}
          >
            {group.letter}
          </h3>

          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 10,
            }}
          >
            {group.items.map((entry) => (
              <li key={entry.symbol} style={cardStyle}>
                <Link
                  href={`/stock/${encodeURIComponent(entry.symbol)}`}
                  style={{
                    color: "#f8fafc",
                    textDecoration: "none",
                    fontWeight: 600,
                    fontSize: 15,
                  }}
                >
                  {entry.symbol}
                  {entry.name ? (
                    <span
                      style={{
                        display: "block",
                        fontWeight: 400,
                        fontSize: 12.5,
                        color: "rgba(148,163,184,0.9)",
                        marginTop: 2,
                      }}
                    >
                      {entry.name}
                    </span>
                  ) : null}
                </Link>

                <div style={{ display: "flex", gap: 12, marginTop: 9 }}>
                  <Link
                    href={`/stock/${encodeURIComponent(entry.symbol)}/news`}
                    style={subLinkStyle}
                  >
                    News
                  </Link>
                  {showEarnings ? (
                    <Link
                      href={`/stock/${encodeURIComponent(entry.symbol)}/earnings`}
                      style={subLinkStyle}
                    >
                      Earnings
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

export default async function StockDirectoryPage() {
  // Best-effort: any symbol the Nasdaq Trader directory doesn't carry (some
  // ETFs, a few ADRs) simply renders as the bare ticker. Never let a failed
  // name lookup take the whole directory down -- the links are the point,
  // the names are decoration.
  let nameMap: Map<string, string>;
  try {
    nameMap = await getCompanyNameMap();
  } catch {
    nameMap = new Map();
  }

  const toEntries = (symbols: string[]): DirectoryEntry[] =>
    symbols.map((symbol) => ({
      symbol,
      name: nameMap.get(symbol) ?? null,
    }));

  const companies = toEntries(priorityStocks);
  // ETFs deliberately get Analysis + News but no Earnings link: a fund has no
  // earnings report, so /stock/{etf}/earnings is an empty page by definition.
  // Those URLs are currently still submitted in app/sitemap.ts, which is
  // worth revisiting separately -- there is no sense spending crawl budget on
  // a page that can never have content.
  const etfs = toEntries(uniqueEtfs);

  const totalPages = companies.length * 3 + etfs.length * 2;

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(37,99,235,0.18), transparent 22%), radial-gradient(circle at top right, rgba(34,197,94,0.10), transparent 22%), #06080d",
        color: "#f1f5f9",
        fontFamily: "system-ui, Arial",
      }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: "Stock Directory",
            url: PAGE_URL,
            description: PAGE_DESCRIPTION,
            isPartOf: {
              "@type": "WebSite",
              name: "MyStockHarbor",
              url: SITE,
            },
          }),
        }}
      />

      <div style={{ maxWidth: 1140, margin: "0 auto", padding: "40px 20px 80px" }}>
        <Link
          href="/dashboard"
          style={{
            fontSize: 13,
            color: "rgba(148,163,184,0.95)",
            textDecoration: "none",
          }}
        >
          &larr; Dashboard
        </Link>

        <h1 style={{ fontSize: 34, margin: "18px 0 10px" }}>Stock Directory</h1>

        <p
          style={{
            margin: "0 0 8px",
            fontSize: 16.5,
            lineHeight: 1.6,
            color: "rgba(226,232,240,0.92)",
            maxWidth: 760,
          }}
        >
          Every stock and ETF with a dedicated page on MyStockHarbor, listed
          A&ndash;Z. Each entry links straight through to that ticker&rsquo;s
          technical analysis, its latest news, and&nbsp;&mdash;&nbsp;for
          individual companies&nbsp;&mdash;&nbsp;its earnings history.
        </p>

        <p
          style={{
            margin: "0 0 4px",
            fontSize: 14,
            color: "rgba(148,163,184,0.9)",
          }}
        >
          {companies.length} companies and {etfs.length} ETFs, covering{" "}
          {totalPages} pages.
        </p>

        <nav
          aria-label="Directory sections"
          style={{ display: "flex", gap: 16, marginTop: 18 }}
        >
          <a href="#companies" style={subLinkStyle}>
            Companies
          </a>
          <a href="#etfs" style={subLinkStyle}>
            ETFs &amp; Funds
          </a>
        </nav>

        <DirectorySection
          id="companies"
          heading="Companies"
          blurb="Mega caps, widely held mid caps and the names retail traders follow most closely. Analysis, news and earnings history for each."
          entries={companies}
          showEarnings
        />

        <DirectorySection
          id="etfs"
          heading="ETFs & Funds"
          blurb="Major index, sector and thematic funds. Analysis and news for each — funds don't report earnings, so there's no earnings page for these."
          entries={etfs}
          showEarnings={false}
        />

        <p
          style={{
            marginTop: 44,
            fontSize: 13.5,
            color: "rgba(148,163,184,0.85)",
            maxWidth: 760,
          }}
        >
          Looking for something not listed here? The{" "}
          <Link href="/stock-screener" style={{ color: "#93c5fd" }}>
            full screener
          </Link>{" "}
          searches the entire market universe, and{" "}
          <Link href="/pickers" style={{ color: "#93c5fd" }}>
            the pickers
          </Link>{" "}
          surface names currently matching a technical setup.
        </p>
      </div>
    </main>
  );
}
