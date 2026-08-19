import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About MyStockHarbor | Free Stock Screeners & Market Education",
  description:
    "MyStockHarbor is a free stock screening and market research site — no account, no paywall. Advanced screeners, chart-pattern plays, earnings and IPO calendars, company analysis and 19 trading lessons.",
  alternates: { canonical: "https://www.mystockharbor.com/about" },
};

const cardStyle: React.CSSProperties = {
  background: "#0b1220",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 16,
  padding: 24,
  boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
};

const paraStyle: React.CSSProperties = {
  fontSize: 16,
  lineHeight: 1.75,
  opacity: 0.92,
  marginTop: 0,
  marginBottom: 14,
};

const h2Style: React.CSSProperties = {
  marginTop: 34,
  marginBottom: 12,
  fontSize: 23,
  fontWeight: 850,
  letterSpacing: "-0.01em",
};

const linkStyle: React.CSSProperties = {
  color: "#93c5fd",
  textDecoration: "underline",
  textUnderlineOffset: 2,
  fontWeight: 700,
};

// Small labelled rows for the "what's here" section. Each one links to the
// thing it describes -- the previous version of this page described six
// features and linked to none of them, which made the one page whose whole
// job is explaining the site a dead end.
const SECTIONS: { href: string; title: string; body: string }[] = [
  {
    href: "/stock-screener",
    title: "Advanced Screener",
    body: "One sortable table with 33 filterable fields across valuation, dividends, financials, performance and analyst data. Combine any conditions you like; the filters live in the URL, so a screen you build is a link you can share or bookmark.",
  },
  {
    href: "/pickers",
    title: "Condition screeners",
    body: "Around thirty ready-made screens — oversold and overbought, buy and sell signals, moving-average proximity, breakouts, RSI and MACD divergence, earnings growth — each one a live list rather than a static article.",
  },
  {
    href: "/low-pe-stocks",
    title: "Curated screens",
    body: "Hand-written pages for the screens people actually look for: low P/E, high dividend yield, dividend growth, cash-rich value, semiconductors and cheap tech. Each explains what the screen does and does not tell you.",
  },
  {
    href: "/plays",
    title: "Chart-pattern plays",
    body: "Ascending triangles, descending triangles and bull flags, detected from price history rather than drawn by hand, with the pattern marked on each chart.",
  },
  {
    href: "/stock/AAPL",
    title: "Company pages",
    body: "Every covered company has its own page: price action and technical context, company profile, financial statements, valuation and dividend detail, plus dedicated views for its earnings history and its news. Apple’s page is linked here as an example.",
  },
  {
    href: "/dashboard",
    title: "Charting dashboard",
    body: "Three chart modes — a fast built-in chart, a full interactive chart with drawing tools and indicators, and a TradingView embed — plus trend and momentum scoring for context.",
  },
  {
    href: "/earnings-calendar",
    title: "Earnings calendar",
    body: "A rolling calendar showing how many companies report each day, with EPS and revenue estimates, price and market cap for any date you open.",
  },
  {
    href: "/upcoming-ipos",
    title: "IPO calendar",
    body: "Confirmed, priced listings expected over the next thirty days, with ticker, exchange, price range, shares offered, deal size, market cap and revenue for each one.",
  },
  {
    href: "/bottlenecks",
    title: "Bottlenecks",
    body: "Which companies a business actually depends on — its key suppliers and how concentrated its customer base is — broken down into simple charts, with a new company published each day.",
  },
  {
    href: "/headlines",
    title: "Market news",
    body: "General market headlines straight from the wire with images and excerpts, linked out to the original story. No AI commentary, just the news.",
  },
  {
    href: "/insights",
    title: "Insights and analysis",
    body: "Daily written analysis, video breakdowns, an S&P 500 overview and a running list of companies recently added to the major indices.",
  },
  {
    href: "/learn",
    title: "Lessons",
    body: "Nineteen lessons covering RSI, MACD, moving averages, volume, divergence and market structure, written for people who want to understand an indicator rather than just switch it on.",
  },
];

// Publisher identity, machine-side. The homepage already declares
// #organization and #website (see app/page.tsx); this reuses the same @ids
// rather than minting rival ones, and adds the two properties this page is
// the natural home for: what the organisation is, and where else it exists.
//
// sameAs carries the YouTube channel because it is the one place the site is
// independently corroborated -- a profile that has to be earned rather than
// asserted. With no named operator (a deliberate choice, see below), external
// corroboration is doing work a byline would otherwise do.
const ABOUT_JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://www.mystockharbor.com/#organization",
      name: "MyStockHarbor",
      url: "https://www.mystockharbor.com/",
      description:
        "A free stock screening and market research site: advanced and condition-based screeners, chart-pattern detection, company analysis, earnings and IPO calendars, and trading lessons.",
      logo: {
        "@type": "ImageObject",
        url: "https://www.mystockharbor.com/logo.png",
      },
      sameAs: ["https://www.youtube.com/@MyStockHarbor"],
    },
    {
      "@type": "AboutPage",
      "@id": "https://www.mystockharbor.com/about#webpage",
      url: "https://www.mystockharbor.com/about",
      name: "About MyStockHarbor",
      description:
        "What MyStockHarbor is, how its screens are built, where its data comes from, and how to report something that looks wrong.",
      inLanguage: "en",
      isPartOf: { "@id": "https://www.mystockharbor.com/#website" },
      mainEntity: { "@id": "https://www.mystockharbor.com/#organization" },
      breadcrumb: { "@id": "https://www.mystockharbor.com/about#breadcrumb" },
    },
    {
      "@type": "BreadcrumbList",
      "@id": "https://www.mystockharbor.com/about#breadcrumb",
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
          name: "About",
          item: "https://www.mystockharbor.com/about",
        },
      ],
    },
  ],
};

export default function AboutPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#06080d",
        color: "#f1f5f9",
        fontFamily: "system-ui, Arial",
        padding: "40px 20px",
      }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ABOUT_JSON_LD) }}
      />
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <section style={cardStyle}>
          <h1
            style={{
              marginTop: 0,
              marginBottom: 16,
              fontSize: 34,
              lineHeight: 1.1,
              fontWeight: 900,
            }}
          >
            About MyStockHarbor
          </h1>

          <p style={{ ...paraStyle, fontSize: 17 }}>
            MyStockHarbor is a free stock screening and market research site.
            There is no account to create, no trial, and nothing behind a
            paywall — every screener, chart, lesson and calendar on this site
            is open to anyone who lands on it.
          </p>

          <p style={paraStyle}>
            The idea is simple: most of the tools that help you understand what
            a stock is doing are either locked behind a subscription or buried
            in a platform built for professionals. This site tries to put the
            useful parts — screening, chart context, earnings dates and plain
            explanations — somewhere you can reach them in one click.
          </p>

          <p style={paraStyle}>
            It grew out of wanting a faster way to answer everyday questions
            about a stock — is it stretched, when does it report, what
            does the balance sheet look like — without paying for several
            different tools to do it.
          </p>

          <h2 style={h2Style}>Who runs it</h2>

          <p style={paraStyle}>
            One person, working on this alone. Not a company, not an editorial
            team, and not a group of analysts.
          </p>

          <p style={paraStyle}>
            My name is not on the site, and that is deliberate rather than an
            oversight. Nothing here is meant to be believed on the strength of
            who wrote it. A screen is worth trusting because you can see what
            went into it and when it was built, not because a person you have
            never heard of put their name underneath it — so the site
            tries to earn that a harder way: every list shows its inputs and
            the time it was last rebuilt, and the section below sets out
            exactly how the screens are put together.
          </p>

          <p style={paraStyle}>
            The honest trade-off is that you cannot look me up, and for a site
            about money that is a reasonable thing to hold against it. Treat
            what follows accordingly: check the workings rather than taking the
            conclusions on faith. That is the right way to read any screener,
            including one with a name attached.
          </p>

          <h2 style={h2Style}>How the screens are built</h2>

          <p style={paraStyle}>
            Every condition on the site is computed, not curated. Nothing is
            hand-picked into a list and no company pays to appear in one.
            Oversold, overbought, breakout, volume and volatility spikes,
            moving-average proximity, and RSI and MACD divergence are all
            derived from each company’s own price and volume history by
            the same rules applied to every symbol in the universe.
          </p>

          <p style={paraStyle}>
            Those rules run again from scratch on each rebuild rather than
            carrying yesterday’s answers forward. That is why a name can
            leave a screen overnight without anything having gone wrong: the
            condition stopped being true. It also means a screen has no memory
            — it will not tell you a stock has been oversold for three
            weeks, only that it is oversold now.
          </p>

          <p style={paraStyle}>
            The screening universe is a few hundred large, liquid, actively
            traded companies rather than every listed security, and the
            fundamental screens depend on figures that arrive on their own
            slower schedules. Where a figure is missing it is shown as missing
            rather than filled in with an estimate, and a company with no value
            for a field simply will not appear in a screen built on it. Company
            pages, the earnings calendar and the news feeds reach considerably
            wider than the screeners do.
          </p>

          <p style={paraStyle}>
            The counts beside each condition in the screener menu are live: they
            say how many of the results you are currently looking at also meet
            that condition, so a zero tells you a combination is empty before
            you spend a click finding out.
          </p>

          <h2 style={h2Style}>What&rsquo;s on the site</h2>

          <div style={{ display: "grid", gap: 16, marginTop: 4 }}>
            {SECTIONS.map((section) => (
              <div key={section.href}>
                <Link href={section.href} style={linkStyle}>
                  {section.title}
                </Link>
                <p style={{ ...paraStyle, marginTop: 4, marginBottom: 0 }}>
                  {section.body}
                </p>
              </div>
            ))}
          </div>

          <h2 style={h2Style}>Where the data comes from</h2>

          <p style={paraStyle}>
            Price and fundamental data come from a commercial market-data
            provider, not scraped from other websites. Prices refresh on a
            rolling basis throughout the trading day, so no quote on the site
            is more than about fifteen minutes old during market hours, and
            the screening data behind every list is rebuilt each morning
            before the open.
          </p>

          <p style={paraStyle}>
            Company profiles, financial statements, dividend history and
            analyst figures refresh on their own slower schedules, since they
            change far less often than a price does. Every screener page shows
            when its data was last updated at the bottom of the results, so you
            can always see how fresh the list you are reading actually is.
          </p>

          <p style={paraStyle}>
            Screening coverage focuses on large, liquid, actively traded
            companies — the names most people are actually looking up — rather
            than attempting to cover every listed security. Individual company
            pages, the earnings calendar and the news feeds reach considerably
            wider than the screeners do.
          </p>

          <h2 style={h2Style}>How to read the screens</h2>

          <p style={paraStyle}>
            Every screen on this site is a starting point, not a conclusion. A
            filter can tell you that a company trades below fifteen times
            earnings; it cannot tell you whether that is a bargain or a warning
            — for that you have to look at why. The written sections on each
            screener page are there to explain what the filter genuinely shows
            and, just as importantly, what it does not.
          </p>

          <p style={paraStyle}>
            Technical signals in particular turn over quickly. A stock that is
            oversold today may not be tomorrow, and a list built on those
            conditions is a snapshot rather than a watchlist.
          </p>

          <h2 style={h2Style}>Important notice</h2>

          <p style={paraStyle}>
            MyStockHarbor is provided for educational and informational
            purposes only. Nothing on this site is financial advice, investment
            advice, or a recommendation to buy or sell any security.
          </p>

          <p style={paraStyle}>
            Trading and investing involve risk, including the risk of losing
            money. Always do your own research and consult a qualified
            professional where appropriate before making financial decisions.
            Please read the{" "}
            <Link href="/risk-disclaimer" style={linkStyle}>
              full risk disclaimer
            </Link>{" "}
            and the{" "}
            <Link href="/affiliate-disclosure" style={linkStyle}>
              affiliate disclosure
            </Link>
            .
          </p>

          <h2 style={h2Style}>Get in touch</h2>

          <p style={paraStyle}>
            Questions, corrections and feature suggestions are all welcome. If a
            number looks wrong somewhere on the site, that is worth knowing
            about — and it is worth saying plainly what happens next:
            reported errors get checked against the source data, and where the
            site is wrong it gets fixed rather than quietly left. Sometimes the
            answer is that a figure is stale rather than wrong, in which case
            the page will say when it was last refreshed.
          </p>

          <p style={{ ...paraStyle, marginBottom: 0 }}>
            <Link href="/contact" style={linkStyle}>
              Contact MyStockHarbor &rarr;
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
