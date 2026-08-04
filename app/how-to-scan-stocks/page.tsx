import type { Metadata } from "next";
import Link from "next/link";
import GuideJsonLd from "@/app/components/GuideJsonLd";

const TITLE = "How to Scan Stocks";
const DESC = "Learn how traders scan stocks for trading ideas, what criteria they look for, and how to explore stock opportunities using MyStockHarbor.";
const PATH = "/how-to-scan-stocks";

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

export default function HowToScanStocksPage() {
  return (
    <>
      <GuideJsonLd path={PATH} title={TITLE} description={DESC} />
      <main style={{ minHeight: "100vh", background: "#06080d", color: "#f1f5f9", fontFamily: "system-ui, Arial" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "28px 20px 40px" }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
            <Link href="/" style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#f1f5f9", textDecoration: "none", fontWeight: 850 }}>← Dashboard</Link>
            <Link href="/pickers" style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#f1f5f9", textDecoration: "none", fontWeight: 850 }}>Find Your Next Stock →</Link>
          </div>
          <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 800 }}>STOCK SCANNING GUIDE</div>
          <h1 style={{ margin: "8px 0 0", fontSize: 36, lineHeight: 1.15 }}>How to Scan Stocks</h1>
          <p style={{ marginTop: 14, lineHeight: 1.7, opacity: 0.86 }}>Stock scanning is the process of searching the market for stocks that meet specific criteria. Instead of manually reviewing thousands of charts, traders use scanners or idea platforms to narrow the market down to stocks that may be showing interesting behaviour.</p>
          <section style={{ marginTop: 28 }}>
            <h2>1. Decide what type of setup you want</h2>
            <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>The first step in scanning stocks is deciding what type of opportunity you are looking for: <Link href="/breakout-stocks" style={{ color: "#93c5fd", textDecoration: "underline" }}>breakouts</Link>, <Link href="/oversold-stocks" style={{ color: "#93c5fd", textDecoration: "underline" }}>oversold stocks</Link>, or <Link href="/stocks-down-20-from-all-time-highs" style={{ color: "#93c5fd", textDecoration: "underline" }}>buy-the-dip setups</Link>.</p>
          </section>
          <section style={{ marginTop: 28 }}>
            <h2>2. Use screening tools to narrow the market</h2>
            <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>A scanner applies filters to a large universe of stocks and returns a smaller list that meets your criteria.</p>
          </section>
          <section style={{ marginTop: 28 }}>
            <h2>3. Review the charts carefully</h2>
            <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>Once you have a shortlist, the next step is chart analysis. If you are new to chart reading, this guide on <Link href="/how-to-read-stock-charts" style={{ color: "#93c5fd", textDecoration: "underline" }}>how to read stock charts</Link> can help.</p>
          </section>
          <section style={{ marginTop: 28 }}>
            <div style={{ padding: 18, borderRadius: 16, border: "1px solid rgba(34,197,94,0.28)", background: "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))" }}>
              <div style={{ fontWeight: 900, fontSize: 20 }}>Explore stock ideas</div>
              <p style={{ marginTop: 10, lineHeight: 1.6, opacity: 0.86 }}>Use the MyStockHarbor stock pickers to explore potential stock setups.</p>
              <div style={{ marginTop: 14 }}>
                <Link href="/pickers" style={{ padding: "12px 18px", borderRadius: 14, border: "1px solid rgba(34,197,94,0.45)", background: "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.18))", color: "#f8fafc", textDecoration: "none", fontWeight: 900 }}>Open Stock Pickers →</Link>
              </div>
            </div>
          </section>
          <section style={{ marginTop: 32 }}>
            <h2>Related guides</h2>
            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              <Link href="/trading-setups">Trading Setups</Link>
              <Link href="/stock-screener-for-breakouts">Stock Screener for Breakouts</Link>
              <Link href="/stock-screener-for-oversold-stocks">Stock Screener for Oversold Stocks</Link>
              <Link href="/stock-screener">Best Free Stock Screener</Link>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
