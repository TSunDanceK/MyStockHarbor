import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About MyStockHarbor | Free Stock Screeners & Market Education",
  description:
    "MyStockHarbor is a free stock screening and market research site — no account, no paywall. Screeners across 260 analysed companies, chart-pattern plays, an earnings calendar and 19 trading lessons.",
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
    body: "Every analysed company in one sortable table, with 33 filterable fields across valuation, dividends, financials, performance and analyst data. Combine any conditions you like; the filters live in the URL, so a screen you build is a link you can share or bookmark.",
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
    href: "/earnings-calendar",
    title: "Earnings calendar",
    body: "A rolling calendar showing how many companies report each day, with EPS and revenue estimates, price and market cap for any date you open.",
  },
  {
    href: "/dashboard",
    title: "Charting dashboard",
    body: "Three chart modes — a fast built-in chart, a full interactive chart with drawing tools and indicators, and a TradingView embed — plus trend and momentum scoring for context.",
  },
  {
    href: "/learn",
    title: "Lessons",
    body: "Nineteen lessons covering RSI, MACD, moving averages, volume, divergence and market structure, written for people who want to understand an indicator rather than just switch it on.",
  },
  {
    href: "/insights",
    title: "Insights and market notes",
    body: "Daily written analysis, video breakdowns, an S&P 500 overview, IPO tracking and market headlines.",
  },
];

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

          {/*
            TO WRITE — the personal paragraph.

            This is the one part of an About page a reader genuinely wants and
            the one part that cannot be written from the codebase: who built
            this, and why they bothered. The paragraph below is a neutral
            stand-in that claims nothing unverified -- it deliberately does NOT
            say who runs the site, how many people are involved, or anything
            about their background, because none of that is knowable from here
            and a wrong guess on an About page is worse than a vague one.

            Replace it with your own words. A few sentences is plenty. Worth
            covering: what you were doing before this, what frustrated you
            enough to build it, and who you had in mind while doing so. A named
            human is the single biggest credibility gain available on this page.

            Delete this comment once it is written.
          */}
          <p style={paraStyle}>
            It grew out of wanting a faster way to answer everyday questions
            about a stock — is it stretched, when does it report, what does the
            balance sheet look like — without paying for several different
            tools to do it.
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
            provider, not scraped from other websites. A universe of 260
            companies is re-analysed every morning, and prices for the whole of
            that universe refresh on a rolling basis so no quote on the site is
            more than about fifteen minutes old during market hours.
          </p>

          <p style={paraStyle}>
            Company profiles, financial statements and analyst figures refresh
            on their own slower schedules, since they change far less often
            than a price does. Every screener page shows when its data was last
            updated at the bottom of the results, so you can always see how
            fresh the list you are reading actually is.
          </p>

          <p style={paraStyle}>
            The analysed universe is a fixed size rather than the whole market.
            That is a deliberate trade: a smaller set that is genuinely kept
            current is more useful than a larger one where half the figures are
            stale. It also means a stock you are looking for may not appear in
            a screen — absence from a list is not a judgement about the
            company.
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
            Questions, corrections and feature suggestions are all welcome — if
            a number looks wrong somewhere on the site, that is worth knowing
            about.
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
