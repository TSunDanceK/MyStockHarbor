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
  title: "MyStockHarbor | Free Trading Dashboard, Market Signals & Technical Analysis",
  description:
    "MyStockHarbor helps traders track stocks, analyse technical indicators, monitor market benchmarks, and learn trading strategies with free educational tools and market insights.",
  icons: {
    icon: "/icon.png",
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
              padding: "32px 20px 22px",
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
                  gap: 10,
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
                    fontSize: 13,
                    lineHeight: 1.6,
                  }}
                >
                  MyStockHarbor is designed for educational purposes and general
                  market research. Please do your own research before making
                  financial decisions.
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                  gap: "24px 28px",
                  alignItems: "start",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gap: 10,
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
                    Platform
                  </div>

                  <div style={{ display: "grid", gap: 6 }}>
                    <Link href="/" style={footerLinkStyle}>
                      Dashboard
                    </Link>
                    <Link href="/pickers" style={footerLinkStyle}>
                      Stock Pickers
                    </Link>
                    <Link href="/insights" style={footerLinkStyle}>
                      Insights
                    </Link>
                    <Link href="/learn" style={footerLinkStyle}>
                      Learn
                    </Link>
                    <Link href="/platforms" style={footerLinkStyle}>
                      Platforms
                    </Link>
                    <Link href="/utilities" style={footerLinkStyle}>
                      Utilities
                    </Link>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: 10,
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
                    Popular Pages
                  </div>

                  <div style={{ display: "grid", gap: 6 }}>
                    <Link href="/breakout-stocks" style={footerLinkStyle}>
                      Breakout Stocks
                    </Link>
                    <Link href="/oversold-stocks" style={footerLinkStyle}>
                      Oversold Stocks
                    </Link>
                    <Link href="/buy-the-dip-stocks" style={footerLinkStyle}>
                      Buy The Dip Stocks
                    </Link>
                    <Link
                      href="/bullish-divergence-stocks"
                      style={footerLinkStyle}
                    >
                      Bullish Divergence Stocks
                    </Link>
                    <Link
                      href="/bearish-divergence-stocks"
                      style={footerLinkStyle}
                    >
                      Bearish Divergence Stocks
                    </Link>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: 10,
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

                  <div style={{ display: "grid", gap: 6 }}>
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
                    gap: 10,
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

                  <div style={{ display: "grid", gap: 6 }}>
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
                  paddingTop: 14,
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
