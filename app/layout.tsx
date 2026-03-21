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
              padding: "28px 20px",
            }}
          >
            <div
              style={{
                maxWidth: 1200,
                margin: "0 auto",
                display: "grid",
                gap: 20,
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 14 }}>MyStockHarbor</div>

              <div style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 760 }}>
                MyStockHarbor is designed for educational purposes and general
                market research. Please do your own research before making
                financial decisions.
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 20,
                }}
              >
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>
                    Platform
                  </div>

                  <Link href="/" style={{ color: "#93c5fd", textDecoration: "none" }}>
                    Dashboard
                  </Link>
                  <Link href="/pickers" style={{ color: "#93c5fd", textDecoration: "none" }}>
                    Stock Pickers
                  </Link>
                  <Link href="/insights" style={{ color: "#93c5fd", textDecoration: "none" }}>
                    Insights
                  </Link>
                  <Link href="/learn" style={{ color: "#93c5fd", textDecoration: "none" }}>
                    Learn
                  </Link>
                  <Link href="/platforms" style={{ color: "#93c5fd", textDecoration: "none" }}>
                    Platforms
                  </Link>
                  <Link href="/utilities" style={{ color: "#93c5fd", textDecoration: "none" }}>
                    Utilities
                  </Link>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>
                    Popular Pages
                  </div>

                  <Link
                    href="/breakout-stocks"
                    style={{ color: "#93c5fd", textDecoration: "none" }}
                  >
                    Breakout Stocks
                  </Link>
                  <Link
                    href="/oversold-stocks"
                    style={{ color: "#93c5fd", textDecoration: "none" }}
                  >
                    Oversold Stocks
                  </Link>
                  <Link
                    href="/buy-the-dip-stocks"
                    style={{ color: "#93c5fd", textDecoration: "none" }}
                  >
                    Buy The Dip Stocks
                  </Link>
                  <Link
                    href="/bullish-divergence-stocks"
                    style={{ color: "#93c5fd", textDecoration: "none" }}
                  >
                    Bullish Divergence Stocks
                  </Link>
                  <Link
                    href="/bearish-divergence-stocks"
                    style={{ color: "#93c5fd", textDecoration: "none" }}
                  >
                    Bearish Divergence Stocks
                  </Link>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>
                    Company
                  </div>

                  <Link href="/about" style={{ color: "#93c5fd", textDecoration: "none" }}>
                    About
                  </Link>
                  <Link href="/contact" style={{ color: "#93c5fd", textDecoration: "none" }}>
                    Contact
                  </Link>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>
                    Legal
                  </div>

                  <Link
                    href="/risk-disclaimer"
                    style={{ color: "#93c5fd", textDecoration: "none" }}
                  >
                    Risk Disclaimer
                  </Link>
                  <Link
                    href="/affiliate-disclosure"
                    style={{ color: "#93c5fd", textDecoration: "none" }}
                  >
                    Affiliate Disclosure
                  </Link>
                  <Link
                    href="/privacy-policy"
                    style={{ color: "#93c5fd", textDecoration: "none" }}
                  >
                    Privacy Policy
                  </Link>
                </div>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
