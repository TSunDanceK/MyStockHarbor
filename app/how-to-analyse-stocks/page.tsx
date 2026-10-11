import type { Metadata } from "next";
import Link from "next/link";
import GuideJsonLd from "@/app/components/GuideJsonLd";

const TITLE = "How to Analyse Stocks";
const DESC = "Learn how traders analyse stocks using charts, indicators, and market context, and explore tools for researching stock ideas.";
const PATH = "/how-to-analyse-stocks";

export const metadata: Metadata = {
  title: `${TITLE} | MyStockHarbor`,
  description: DESC,
  alternates: { canonical: `https://www.mystockharbor.com${PATH}` },
  openGraph: {
    title: `${TITLE} | MyStockHarbor`,
    description: DESC,
    url: `https://www.mystockharbor.com${PATH}`,
    siteName: "MyStockHarbor",
    type: "article",
    locale: "en_GB",
    images: [{ url: "https://www.mystockharbor.com/og-image-v2.png", width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${TITLE} | MyStockHarbor`,
    description: DESC,
    images: ["https://www.mystockharbor.com/og-image-v2.png"],
  },
};

export default function HowToAnalyseStocksPage() {
  return (
    <>
      <GuideJsonLd path={PATH} title={TITLE} description={DESC} />
      <main style={{ minHeight: "100vh", background: "#06080d", color: "#f1f5f9", fontFamily: "system-ui, Arial" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "28px 20px 40px" }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
            <Link href="/" style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#f1f5f9", textDecoration: "none", fontWeight: 850 }}>← Dashboard</Link>
            <Link href="/pickers" style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#f1f5f9", textDecoration: "none", fontWeight: 850 }}>Explore Stock Ideas →</Link>
          </div>
          <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 800 }}>STOCK ANALYSIS GUIDE</div>
          <h1 style={{ margin: "8px 0 0", fontSize: 36, lineHeight: 1.15 }}>How to Analyse Stocks</h1>
          <p style={{ marginTop: 14, lineHeight: 1.7, opacity: 0.86 }}>Analysing stocks is the process of evaluating whether a stock may be attractive to trade or invest in. Most traders combine charts, indicators, and market scanning methods to build a clearer picture of what a stock might do next.</p>
          <section style={{ marginTop: 28 }}>
            <h2>1. Understanding price charts</h2>
            <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>Price charts are the starting point for many traders. If you are new to chart analysis, this guide on <Link href="/how-to-read-stock-charts" style={{ color: "#93c5fd", textDecoration: "underline" }}>how to read stock charts</Link> explains the basic concepts traders watch.</p>
          </section>
          <section style={{ marginTop: 28 }}>
            <h2>2. Using technical indicators</h2>
            <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>Technical indicators help measure aspects of price movement. Useful ones include <Link href="/learn/rsi" style={{ color: "#93c5fd", textDecoration: "underline" }}>RSI</Link>, <Link href="/learn/macd" style={{ color: "#93c5fd", textDecoration: "underline" }}>MACD</Link>, and <Link href="/what-is-vwap-indicator" style={{ color: "#93c5fd", textDecoration: "underline" }}>VWAP</Link>.</p>
          </section>
          <section style={{ marginTop: 28 }}>
            <h2>3. Identifying stock setups</h2>
            <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>Traders often look for specific patterns including <Link href="/breakout-stocks" style={{ color: "#93c5fd", textDecoration: "underline" }}>breakouts</Link>, <Link href="/oversold-stocks" style={{ color: "#93c5fd", textDecoration: "underline" }}>oversold setups</Link>, and <Link href="/stocks-down-20-from-all-time-highs" style={{ color: "#93c5fd", textDecoration: "underline" }}>buy-the-dip setups</Link>.</p>
          </section>
          <section style={{ marginTop: 28 }}>
            <h2>4. Scanning the market for ideas</h2>
            <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>This guide on <Link href="/how-to-scan-stocks" style={{ color: "#93c5fd", textDecoration: "underline" }}>how to scan stocks</Link> explains how traders narrow the market down to a shortlist of charts worth analysing.</p>
          </section>
          <section style={{ marginTop: 28 }}>
            <div style={{ marginTop: 16, padding: 18, borderRadius: 16, border: "1px solid rgba(34,197,94,0.28)", background: "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))" }}>
              <div style={{ fontWeight: 900, fontSize: 20 }}>Explore stock ideas</div>
              <p style={{ marginTop: 10, lineHeight: 1.6, opacity: 0.86 }}>Use the MyStockHarbor stock pickers to explore potential setups and review charts across multiple strategies.</p>
              <div style={{ marginTop: 14 }}>
                <Link href="/pickers" style={{ padding: "12px 18px", borderRadius: 14, border: "1px solid rgba(34,197,94,0.45)", background: "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.18))", color: "#f8fafc", textDecoration: "none", fontWeight: 900 }}>Open Stock Pickers →</Link>
              </div>
            </div>
          </section>
          <section style={{ marginTop: 32 }}>
            <h2>Related guides</h2>
            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              <Link href="/how-to-read-stock-charts">How to Read Stock Charts</Link>
              <Link href="/best-indicators-for-swing-trading">Best Indicators for Swing Trading</Link>
              <Link href="/trading-setups">Trading Setups</Link>
              <Link href="/best-charting-platforms">Best Charting Platforms</Link>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
