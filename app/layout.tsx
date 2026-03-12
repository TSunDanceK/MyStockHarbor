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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
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
              padding: "18px 20px",
            }}
          >
            <div
              style={{
                maxWidth: 1200,
                margin: "0 auto",
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 14 }}>MyStockHarbor</div>

<div style={{ fontSize: 13, lineHeight: 1.6 }}>
  MyStockHarbor is designed for educational purposes and general
  market research. Please do your own research before making
  financial decisions.
</div>

              <div
                style={{
                  display: "flex",
                  gap: 14,
                  flexWrap: "wrap",
                  fontSize: 13,
                }}
              >
                <Link
                  href="/about"
                  style={{ color: "#93c5fd", textDecoration: "none" }}
                >
                  About
                </Link>

                <Link
                  href="/contact"
                  style={{ color: "#93c5fd", textDecoration: "none" }}
                >
                  Contact
                </Link>

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
          </footer>
        </div>
      </body>
    </html>
  );
}
