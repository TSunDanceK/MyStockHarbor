import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import SiteHeader from "./components/SiteHeader";
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

  const footerSmallLinkStyle: React.CSSProperties = {
    color: "rgba(241,245,249,0.58)",
    textDecoration: "none",
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
                grid-template-columns: minmax(140px, max-content) minmax(180px, max-content) minmax(180px, max-content);
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
                  gap: "16px 48px",
                  alignItems: "start",
                }}
              >
                <div
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
                    Company
                  </div>

                  <div style={{ display: "grid", gap: 4 }}>
                    <Link href="/about" style={footerLinkStyle}>
                      About
                    </Link>
                    <Link href="/contact" style={footerLinkStyle}>
                      Contact
                    </Link>
                    <Link href="/feedback" style={footerLinkStyle}>
                      Feedback
                    </Link>
                  </div>
                </div>

                <div
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
                    Legal
                  </div>

                  <div style={{ display: "grid", gap: 4 }}>
                    <Link href="/risk-disclaimer" style={footerLinkStyle}>
                      Risk Disclaimer
                    </Link>
                    <Link href="/affiliate-disclosure" style={footerLinkStyle}>
                      Affiliate Disclosure
                    </Link>
                    <Link href="/privacy-policy" style={footerLinkStyle}>
                      Privacy Policy
                    </Link>
                  </div>
                </div>

                <div
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
                    Learn
                  </div>

                  <div style={{ display: "grid", gap: 4 }}>
                    <Link href="/what-is-rsi-indicator" style={footerLinkStyle}>
                      What Is RSI?
                    </Link>
                    <Link href="/what-is-macd-indicator" style={footerLinkStyle}>
                      What Is MACD?
                    </Link>
                    <Link href="/how-to-read-stock-charts" style={footerLinkStyle}>
                      How To Read Charts
                    </Link>
                    <Link href="/best-free-stock-screener" style={footerLinkStyle}>
                      Free Stock Screener
                    </Link>
                    <Link href="/markets/spx" style={footerLinkStyle}>
                      S&amp;P 500 Analysis
                    </Link>
                    <Link href="/best-trading-platform-for-beginners" style={footerLinkStyle}>
                      Best Trading Platforms
                    </Link>
                  </div>
                </div>
              </div>

              <div
                style={{
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                  paddingTop: 10,
                  display: "grid",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "rgba(241,245,249,0.72)",
                    letterSpacing: 0.2,
                  }}
                >
                  Other Links
                </div>

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "6px 16px",
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  <Link href="/breakout-stocks" style={footerSmallLinkStyle}>
                    Breakout Stocks
                  </Link>
                  <Link href="/oversold-stocks" style={footerSmallLinkStyle}>
                    Oversold Stocks
                  </Link>
                  <Link href="/buy-the-dip-stocks" style={footerSmallLinkStyle}>
                    Buy The Dip Stocks
                  </Link>
                  <Link
                    href="/bullish-divergence-stocks"
                    style={footerSmallLinkStyle}
                  >
                    Bullish Divergence Stocks
                  </Link>
                  <Link
                    href="/bearish-divergence-stocks"
                    style={footerSmallLinkStyle}
                  >
                    Bearish Divergence Stocks
                  </Link>
                  <Link
                    href="/stocks-above-200-day-moving-average"
                    style={footerSmallLinkStyle}
                  >
                    Stocks Above 200 MA
                  </Link>
                  <Link
                    href="/stocks-with-unusual-volume"
                    style={footerSmallLinkStyle}
                  >
                    Unusual Volume Stocks
                  </Link>
                </div>
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
        </div>
      </body>
    </html>
  );
}
