import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
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
  title: "MyStockHarbor (My Stock Harbor) | Free Trading Dashboard, Market Signals & Technical Analysis",
  description:
    "MyStockHarbor (My Stock Harbor) helps traders track stocks, analyse technical indicators, monitor market benchmarks, and learn trading strategies with free educational tools, stock screeners, and market insights.",
  icons: {
    icon: "/icon.png",
    shortcut: "/icon.png",
    apple: "/icon.png",
  },

  openGraph: {
    title:
      "MyStockHarbor (My Stock Harbor) | Free Trading Dashboard, Market Signals & Technical Analysis",
    description:
      "MyStockHarbor (My Stock Harbor) helps traders track stocks, analyse technical indicators, monitor market benchmarks, and learn trading strategies with free educational tools, stock screeners, and market insights.",
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
      "MyStockHarbor (My Stock Harbor) | Free Trading Dashboard, Market Signals & Technical Analysis",
    description:
      "MyStockHarbor (My Stock Harbor) helps traders track stocks, analyse technical indicators, monitor market benchmarks, and learn trading strategies with free educational tools, stock screeners, and market insights.",
    images: ["https://www.mystockharbor.com/og-image-v2.png"],
  },
  other: {
    "impact-site-verification": "cfd647ce-ddd8-4f2a-921f-3763ef298b2a",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const footerLinkStyle: React.CSSProperties = {
    color: "rgba(241,245,249,0.68)",
    textDecoration: "none",
  };

  const footerSmallLinkStyle: React.CSSProperties = {
    color: "rgba(241,245,249,0.58)",
    textDecoration: "none",
  };

  return (
    <html lang="en">
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
          <div style={{ flex: 1 }}>{children}</div>

          <footer
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
                gap: 16,
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
                  MyStockHarbor (My Stock Harbor) is designed for educational purposes and general
                  market research. Please do your own research before making
                  financial decisions.
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(280px, 2fr) minmax(140px, 1fr) minmax(180px, 1fr)",
                  gap: "16px 28px",
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
                    Platforms
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(120px, max-content))",
                      gap: "4px 28px",
                    }}
                  >
                    <Link href="/" style={footerLinkStyle}>
                      Dashboard
                    </Link>
                    <Link href="/learn" style={footerLinkStyle}>
                      Learn
                    </Link>
                    <Link href="/pickers" style={footerLinkStyle}>
                      Stock Pickers
                    </Link>
                    <Link href="/platforms" style={footerLinkStyle}>
                      Platforms
                    </Link>
                    <Link href="/insights" style={footerLinkStyle}>
                      Insights
                    </Link>
                    <Link href="/utilities" style={footerLinkStyle}>
                      Utilities
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
                    Company
                  </div>

                  <div style={{ display: "grid", gap: 4 }}>
                    <Link href="/about" style={footerLinkStyle}>
                      About
                    </Link>
                    <Link href="/contact" style={footerLinkStyle}>
                      Contact
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
                © {new Date().getFullYear()} MyStockHarbor (My Stock Harbor). All rights reserved.
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
