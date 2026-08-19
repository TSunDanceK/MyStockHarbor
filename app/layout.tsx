import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import SiteHeader from "./components/SiteHeader";
import CrawlableNav from "./components/CrawlableNav";
import BottomNav from "./components/BottomNav";
import PageViewTracker from "./components/PageViewTracker";
import { getLatestYouTubeVideos } from "@/lib/youtube";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MyStockHarbor — Stock Screeners, Swing Trade Setups & Daily Market Insights",
  description:
    "Free stock screeners for breakouts, oversold stocks & bullish divergence. Daily insight posts, live dashboards, chart pattern plays, and swing trade setups. No login needed.",
  icons: {
    icon: "/icon.png",
    shortcut: "/icon.png",
    apple: "/icon.png",
  },

  openGraph: {
    title:
      "MyStockHarbor — Stock Screeners, Swing Trade Setups & Daily Market Insights",
    description:
      "Free stock screeners for breakouts, oversold stocks & bullish divergence. Daily insight posts, live dashboards, chart pattern plays, and swing trade setups. No login needed.",
    url: "https://www.mystockharbor.com",
    siteName: "MyStockHarbor",
    images: [
      {
        url: "https://www.mystockharbor.com/og-image-v2.png",
        width: 1200,
        height: 630,
        alt: "MyStockHarbor trading dashboard",
      },
    ],
    locale: "en_GB",
    type: "website",
  },

  twitter: {
    card: "summary_large_image",
    title:
      "MyStockHarbor — Stock Screeners, Swing Trade Setups & Daily Market Insights",
    description:
      "Free stock screeners for breakouts, oversold stocks & bullish divergence. Daily insight posts, live dashboards, chart pattern plays, and swing trade setups. No login needed.",
    images: ["https://www.mystockharbor.com/og-image-v2.png"],
  },
  other: {
    "impact-site-verification": "cfd647ce-ddd8-4f2a-921f-3763ef298b2a",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Fetched here (Server Component, cached hourly via unstable_cache inside
  // getLatestYouTubeVideos — see lib/youtube.ts) so the global header's
  // "Video Breakdowns" nav link always points at whichever video is
  // currently newest, without any client-side fetch or hardcoded video ID.
  const [latestVideo] = await getLatestYouTubeVideos(1);
  const latestVideoId = latestVideo?.id ?? null;

  const footerLinkStyle: React.CSSProperties = {
    color: "rgba(241,245,249,0.68)",
    textDecoration: "none",
  };

  // Footer columns.
  //
  // Deliberately small: 14 links across four columns, and the count is the
  // design decision rather than an accident of what would fit.
  //
  // An earlier pass at this ran to 29 links across five columns, justified on
  // internal linking being the binding constraint on getting the screener
  // pages indexed. That reasoning was half right and led somewhere wrong.
  // Contextual links inside page content do carry weight; site-wide footer
  // links are boilerplate and are discounted precisely because they appear on
  // every page. So the extra fifteen links bought a modest crawler gain at a
  // real cost in readability -- an overcrowded footer that a visitor scans
  // past.
  //
  // The clearest symptom: a whole "Popular Screens" column duplicated links
  // that already exist in the Pickers dropdown AND the Select Screener
  // sidebar. A third copy helped nobody. Those pages keep both of their real
  // navigation routes; they just do not need a third here.
  //
  // What is left is what a footer is actually for -- orientation (where am I,
  // what does this site do) and the legal obligations. Discovery is the
  // header's job, and the header does it well.
  //
  // 2026-08-15: "Stock Directory" (/stocks) added, which is a deliberate
  // exception to the paragraph above rather than a quiet walking-back of it.
  // The reasoning that removed fifteen links still holds -- site-wide footer
  // links are discounted boilerplate, and none of those fifteen pages needed a
  // third navigation route. /stocks is different on both counts: it is a hub
  // with no other route into it at all, and the point is not the weight the
  // link passes but that the page exists one hop from everywhere so a crawler
  // reaches it early. One link, opening a path to 483 pages that previously
  // had none. See app/stocks/page.tsx for the full reasoning.
  //
  // 2026-08-18: the sentence above -- "Discovery is the header's job, and the
  // header does it well" -- was wrong, and expensively so. The header renders
  // every dropdown through createPortal and only while open, so it does that
  // job for humans and not at all for crawlers. See CrawlableNav below and
  // claude/header-nav-not-crawlable-2026-08-17.md. The four columns here are
  // still deliberately small; the fix went into a collapsed block rather than
  // into this list precisely so the readability argument above survives it.
  const footerColumns: {
    heading: string;
    links: { href: string; label: string }[];
  }[] = [
    {
      heading: "Explore",
      links: [
        { href: "/dashboard", label: "Dashboard" },
        { href: "/stocks", label: "Stock Directory" },
        { href: "/stock-screener", label: "Advanced Screener" },
        { href: "/earnings-calendar", label: "Earnings Calendar" },
        { href: "/insights", label: "Insights" },
      ],
    },
    {
      heading: "Learn",
      links: [
        { href: "/learn", label: "All Lessons" },
        { href: "/how-to-read-stock-charts", label: "How To Read Charts" },
        { href: "/trading-setups", label: "Trading Setups" },
      ],
    },
    {
      heading: "Company",
      links: [
        { href: "/about", label: "About" },
        { href: "/contact", label: "Contact" },
      ],
    },
    {
      heading: "Legal",
      links: [
        { href: "/risk-disclaimer", label: "Risk Disclaimer" },
        { href: "/affiliate-disclosure", label: "Affiliate Disclosure" },
        { href: "/privacy-policy", label: "Privacy Policy" },
      ],
    },
  ];

  // Honeypot trap link (see app/api/internal/feed-index/route.ts and
  // lib/server/trapBlock.ts). Deliberately a plain <a>, NOT next/link's
  // <Link> -- Link's viewport-prefetch would fire this route from real
  // visitors' own browsers just by scrolling it into view, self-inflicting
  // the exact block this exists to apply to bots. That exact prefetch
  // false-positive already bit this site once elsewhere; see
  // claude/list-link-prefetch-disable-2026-07-21.md.
  //
  // Hidden three separate ways so no real human can land here through
  // normal use: clipped to a 1x1px box off-canvas (sighted visitors),
  // aria-hidden="true" (removed from the accessibility tree entirely, so
  // screen readers never announce it), and tabIndex={-1} (skipped by
  // keyboard Tab navigation). What's left is a completely ordinary <a
  // href> in the rendered HTML that only something parsing raw markup --
  // or crawling every anchor regardless of visibility -- would ever fetch.
  const trapLinkStyle: React.CSSProperties = {
    position: "absolute",
    width: 1,
    height: 1,
    margin: -1,
    padding: 0,
    overflow: "hidden",
    clip: "rect(0,0,0,0)",
    whiteSpace: "nowrap",
    border: 0,
    left: -9999,
    top: -9999,
  };

  return (
    <html lang="en-GB">
      <head>
        <script
          async
          src="https://www.googletagmanager.com/gtag/js?id=G-V2BD40X7H2"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', 'G-V2BD40X7H2');
              gtag('config', 'AW-18022878142');
            `,
          }}
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              .site-footer-main-grid {
                grid-template-columns: repeat(4, minmax(150px, max-content));
              }

              .site-map-grid {
                grid-template-columns: repeat(5, minmax(150px, 1fr));
              }

              .site-map-details > summary::-webkit-details-marker {
                color: rgba(241,245,249,0.56);
              }

              /* The four footer columns are <details> so a phone can collapse
                 them to four headings. The default marker is suppressed at
                 every width -- desktop never shows one because the column is
                 always open, and mobile draws its own +/- on the right, which
                 reads better in a full-width row than a triangle jammed
                 against the heading. */
              .footer-col > summary {
                list-style: none;
              }

              .footer-col > summary::-webkit-details-marker {
                display: none;
              }

              @media (min-width: 721px) {
                /* Desktop keeps all four columns open permanently, so the
                   heading must not behave like a control: no pointer cursor
                   and, more importantly, no way to click a column shut. */
                .footer-col > summary {
                  pointer-events: none;
                }
              }

              @media (max-width: 720px) {
                .site-footer {
                  padding-left: 16px !important;
                  padding-right: 16px !important;
                }

                /* One full-width row per column, not two side by side --
                   a collapsed row is a tap target and wants the whole width.
                   Gap goes to 0 because each row now carries its own rule
                   line and padding. */
                .site-footer-main-grid {
                  grid-template-columns: 1fr;
                  gap: 0 !important;
                }

                .footer-col {
                  border-bottom: 1px solid rgba(255,255,255,0.07);
                }

                .footer-col > summary {
                  cursor: pointer;
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  /* ~40px tall closed, which is the tap target rather than
                     the text. */
                  padding: 11px 0;
                }

                .footer-col > summary::after {
                  content: "+";
                  font-size: 16px;
                  font-weight: 700;
                  line-height: 1;
                  color: rgba(241,245,249,0.5);
                }

                /* U+2212 minus, not a hyphen -- a hyphen next to a 16px "+"
                   reads as a speck. */
                .footer-col[open] > summary::after {
                  content: "\\2212";
                }

                .footer-col[open] > .footer-col-links {
                  padding-bottom: 12px;
                }

                .site-map-grid {
                  grid-template-columns: 1fr 1fr;
                  gap: 18px 20px !important;
                }
              }

              @media (max-width: 480px) {
                .site-footer {
                  padding: 20px 14px 14px !important;
                }

                .site-map-grid {
                  grid-template-columns: 1fr;
                  gap: 20px !important;
                }
              }
            `,
          }}
        />
      </head>

      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#06080d",
          color: "#f1f5f9",
        }}
      >
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Site-wide real-page-view beacon. The "stock" category tracker in
              app/stock/[symbol]/layout.tsx is unchanged and still feeds the
              daily /stock/* cap in middleware.ts -- this is a separate,
              broader counter under the "site" category, used by
              app/api/go/[platform]/route.ts to tell a real visitor from a
              scraper before attaching our affiliate ID.

              Mounted here rather than per-section because affiliate links
              appear on /dashboard, /platforms, /insights/*, /markets/spx and
              every /stock/* page, and a page added later would otherwise
              silently miss coverage. Like the stock tracker, this only ever
              fires from a genuinely client-rendered navigation -- never from
              a Link prefetch, and never from a client that doesn't run JS. */}
          <PageViewTracker category="site" />
          <SiteHeader latestVideoId={latestVideoId} />
          <div style={{ flex: 1 }}>{children}</div>

          <footer
            className="site-footer"
            style={{
              borderTop: "1px solid rgba(255,255,255,0.12)",
              background: "#0b1220",
              color: "rgba(241,245,249,0.82)",
              padding: "22px 20px 16px",
            }}
          >
            <div
              style={{
                maxWidth: 1200,
                margin: "0 auto",
                display: "grid",
                gap: 24,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gap: 6,
                  maxWidth: 760,
                }}
              >
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 14,
                    color: "#f8fafc",
                  }}
                >
                  MyStockHarbor
                </div>

                <div
                  style={{
                    fontSize: 12,
                    lineHeight: 1.55,
                    color: "rgba(241,245,249,0.78)",
                  }}
                >
                  MyStockHarbor is designed for educational purposes and general
                  market research. Please do your own research before making
                  financial decisions.
                </div>
              </div>

              <div
                className="site-footer-main-grid"
                style={{
                  display: "grid",
                  gap: "16px 40px",
                  alignItems: "start",
                }}
              >
                {/* Each column is a <details> rendered OPEN, and the `open`
                    attribute here is the safe default rather than an
                    oversight. Server-rendered, this footer is byte-for-byte
                    what it has always been: four expanded columns, 14 links.
                    Crawlers, no-JS clients and every desktop visitor get
                    exactly that. The inline script after </footer> is what
                    closes them, and only below 720px.

                    Doing it that way round matters. The obvious alternative --
                    render closed, let CSS force it open on desktop -- does not
                    work: Chrome and Firefox hide a closed <details>'s children
                    through content-visibility on a shadow-DOM slot, which
                    light-DOM CSS cannot override. `details::details-content`
                    would do it, but it is too recent to rely on here. So the
                    choice was JS, or a footer that degrades closed. Degrading
                    OPEN is the version where a failure costs nothing. */}
                {footerColumns.map((column) => (
                  <details key={column.heading} className="footer-col" open>
                    <summary
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#e2e8f0",
                      }}
                    >
                      {column.heading}
                    </summary>

                    <div
                      className="footer-col-links"
                      style={{ display: "grid", gap: 4, paddingTop: 6 }}
                    >
                      {column.links.map((link) => (
                        <Link key={link.href} href={link.href} style={footerLinkStyle}>
                          {link.label}
                        </Link>
                      ))}
                    </div>
                  </details>
                ))}
              </div>

              {/* The full nav link set, server-rendered. The 14-link footer
                  above is unchanged and the reasoning behind its size still
                  stands -- this is collapsed by default and adds one row.
                  See app/components/CrawlableNav.tsx. */}
              <CrawlableNav />

              <div
                style={{
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                  paddingTop: 10,
                  fontSize: 12,
                  color: "rgba(241,245,249,0.56)",
                }}
              >
                © {new Date().getFullYear()} MyStockHarbor. All rights reserved.
              </div>
            </div>
          </footer>

          {/* Collapses the four footer columns on phones. See the comment on
              the <details> above for why this is JS and not CSS.

              Placed immediately after </footer> so it parses and runs with
              the footer already in the DOM and before first paint of it --
              no flash of an expanded footer on the way down.

              The matchMedia listener covers rotation: without it, a phone
              turned landscape past 720px would hit the desktop rule that sets
              pointer-events: none on the summary, leaving four columns closed
              and no way to open them. */}
          <script
            dangerouslySetInnerHTML={{
              __html: `
                (function(){
                  try{
                    var mq = window.matchMedia('(max-width: 720px)');
                    var sync = function(){
                      var cols = document.querySelectorAll('details.footer-col');
                      for (var i = 0; i < cols.length; i++) {
                        cols[i].open = !mq.matches;
                      }
                    };
                    sync();
                    if (mq.addEventListener) mq.addEventListener('change', sync);
                    else if (mq.addListener) mq.addListener(sync);
                  }catch(e){}
                })();
              `,
            }}
          />

          <a
            href="/api/internal/feed-index"
            aria-hidden="true"
            tabIndex={-1}
            rel="nofollow"
            style={trapLinkStyle}
          >
            resource index
          </a>

          {/* Fixed bottom navigation, phones only. Mounted last inside the
              column wrapper so it is the final thing in the DOM before
              </body> -- it is position: fixed, so its place in the flow does
              not matter visually, but keeping it after the footer means the
              reading and tab order still end with the page's own content
              rather than with site chrome.

              See app/components/BottomNav.tsx, including why it reserves
              padding on <body> and why every link is prefetch={false}. */}
          <BottomNav />
        </div>
      </body>
    </html>
  );
}
