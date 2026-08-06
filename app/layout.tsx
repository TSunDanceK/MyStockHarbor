import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import SiteHeader from "./components/SiteHeader";
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
  const footerColumns: {
    heading: string;
    links: { href: string; label: string }[];
  }[] = [
    {
      heading: "Explore",
      links: [
        { href: "/dashboard", label: "Dashboard" },
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

              @media (max-width: 720px) {
                .site-footer {
                  padding-left: 16px !important;
                  padding-right: 16px !important;
                }

                .site-footer-main-grid {
                  grid-template-columns: 1fr 1fr;
                  gap: 18px !important;
                }
              }

              @media (max-width: 480px) {
                .site-footer {
                  padding: 20px 14px 14px !important;
                }

                .site-footer-main-grid {
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
                {footerColumns.map((column) => (
                  <div
                    key={column.heading}
                    style={{
                      display: "grid",
                      gap: 6,
                      alignContent: "start",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#e2e8f0",
                      }}
                    >
                      {column.heading}
                    </div>

                    <div style={{ display: "grid", gap: 4 }}>
                      {column.links.map((link) => (
                        <Link key={link.href} href={link.href} style={footerLinkStyle}>
                          {link.label}
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

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

          <a
            href="/api/internal/feed-index"
            aria-hidden="true"
            tabIndex={-1}
            rel="nofollow"
            style={trapLinkStyle}
          >
            resource index
          </a>
        </div>
      </body>
    </html>
  );
}
