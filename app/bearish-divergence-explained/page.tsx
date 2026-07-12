import type { Metadata } from "next";
import Link from "next/link";
import GuideJsonLd from "@/app/components/GuideJsonLd";

const TITLE = "Bearish Divergence Explained: What Traders Look For";
const DESC = "Learn what bearish divergence means in trading, how traders identify bearish divergence signals, and how to explore setups using MyStockHarbor.";
const PATH = "/bearish-divergence-explained";

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

export default function BearishDivergenceExplainedPage() {
  return (
    <>
      <GuideJsonLd path={PATH} title={TITLE} description={DESC} breadcrumbs={[{ name: "Learn", href: "/learn" }]} />
      <main style={{ minHeight: "100vh", background: "#06080d", color: "#f1f5f9", fontFamily: "system-ui, Arial" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "28px 20px 40px" }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
            <Link href="/" style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#f1f5f9", textDecoration: "none", fontWeight: 850 }}>← Dashboard</Link>
            <Link href="/pickers" style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#f1f5f9", textDecoration: "none", fontWeight: 850 }}>Find Your Next Stock →</Link>
          </div>
          <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 800 }}>DIVERGENCE GUIDE</div>
          <h1 style={{ margin: "8px 0 0", fontSize: 36, lineHeight: 1.15 }}>Bearish Divergence Explained</h1>
          <p style={{ marginTop: 14, lineHeight: 1.7, opacity: 0.86 }}>Bearish divergence is a technical signal traders watch for when evaluating whether upside momentum may be fading. It occurs when price continues to rise but a momentum indicator begins to fall or flatten instead.</p>
          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>This disconnect between price and momentum can suggest that buying pressure is weakening, which may create conditions where a pullback becomes more likely.</p>
          <div style={{ marginTop: 18, padding: 18, borderRadius: 16, border: "1px solid rgba(239,68,68,0.28)", background: "linear-gradient(135deg, rgba(239,68,68,0.12), rgba(168,85,247,0.06))" }}>
            <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.78 }}>SIMPLE EXPLANATION</div>
            <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900 }}>Price makes higher highs, but momentum makes lower highs.</div>
          </div>
          <section style={{ marginTop: 28 }}><h2>1. What causes bearish divergence?</h2><p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>Bearish divergence appears when buying momentum begins to slow even though price has not yet turned lower. When momentum indicators fail to confirm new price highs, traders sometimes read this as a warning that the move may be losing its foundation.</p></section>
          <section style={{ marginTop: 28 }}><h2>2. Indicators used to spot bearish divergence</h2><p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>The same oscillators used for bullish divergence apply here:</p><ul style={{ marginTop: 10 }}><li><Link href="/what-is-rsi-indicator" style={{ color: "#93c5fd", textDecoration: "underline" }}>RSI</Link></li><li><Link href="/what-is-macd-indicator" style={{ color: "#93c5fd", textDecoration: "underline" }}>MACD</Link></li></ul></section>
          <section style={{ marginTop: 28 }}><h2>3. Why traders watch for it</h2><p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>Bearish divergence does not guarantee a reversal. It is a warning sign, not a sell signal on its own. Traders often combine it with resistance levels, trend structure, and volume to judge whether a setup is worth acting on.</p></section>
          <section style={{ marginTop: 28 }}><h2>4. Finding bearish divergence setups</h2><div style={{ marginTop: 16, padding: 18, borderRadius: 16, border: "1px solid rgba(34,197,94,0.28)", background: "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))" }}><div style={{ fontWeight: 900, fontSize: 20 }}>Explore divergence ideas</div><p style={{ marginTop: 10, lineHeight: 1.6, opacity: 0.86 }}>Use the MyStockHarbor stock pickers to surface stocks showing bearish divergence behaviour.</p><div style={{ marginTop: 14 }}><Link href="/pickers" style={{ padding: "12px 18px", borderRadius: 14, border: "1px solid rgba(34,197,94,0.45)", background: "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.18))", color: "#f8fafc", textDecoration: "none", fontWeight: 900 }}>Open Stock Pickers →</Link></div></div></section>
          <section style={{ marginTop: 32 }}><h2>Related guides</h2><div style={{ marginTop: 12, display: "grid", gap: 12 }}><Link href="/bearish-divergence-stocks">Bearish Divergence Stocks</Link><Link href="/bullish-divergence-explained">Bullish Divergence Explained</Link><Link href="/trading-setups">Trading Setups</Link><Link href="/best-stock-indicators-for-beginners">Best Stock Indicators for Beginners</Link></div></section>
        </div>
      </main>
    </>
  );
}
