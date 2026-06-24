import type { Metadata } from "next";
import Link from "next/link";
import GuideJsonLd from "@/app/components/GuideJsonLd";

const TITLE = "How to Read Stock Charts";
const DESC = "Learn how to read stock charts as a beginner, including trend, support and resistance, indicators, and how to understand price action more clearly.";
const PATH = "/how-to-read-stock-charts";

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

export default function HowToReadStockChartsPage() {
  return (
    <>
      <GuideJsonLd path={PATH} title={TITLE} description={DESC} breadcrumbs={[{ name: "Learn", href: "/learn" }]} />
      <main style={{ minHeight: "100vh", background: "#06080d", color: "#f1f5f9", fontFamily: "system-ui, Arial" }}>
        <div className="wrap" style={{ maxWidth: 940, margin: "0 auto", padding: "28px 20px 40px" }}>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "nowrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 800, letterSpacing: "0.08em" }}>BEGINNER CHART GUIDE</div>
                <h1 style={{ margin: "8px 0 0", fontSize: 36, lineHeight: 1.15, letterSpacing: "-0.5px" }}>How to Read Stock Charts</h1>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: 17, lineHeight: 1.7, opacity: 0.86, maxWidth: 760 }}>Learning how to read stock charts is one of the most useful skills for any trader or investor. A stock chart helps you see trend, momentum, support and resistance, and whether price is becoming stretched or weak.</p>
          </div>
          <section style={{ marginTop: 20, padding: 20, borderRadius: 18, border: "1px solid rgba(59,130,246,0.28)", background: "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(168,85,247,0.08))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}>
            <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.78, letterSpacing: "0.08em" }}>SIMPLE WAY TO THINK ABOUT IT</div>
            <div style={{ marginTop: 8, fontSize: 24, fontWeight: 900 }}>A chart tells you three things:</div>
            <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, padding: 14, background: "rgba(255,255,255,0.05)" }}><div style={{ fontWeight: 900, fontSize: 15 }}>Direction</div><div style={{ marginTop: 6, opacity: 0.84, lineHeight: 1.6 }}>Is price moving up, down, or sideways?</div></div>
              <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, padding: 14, background: "rgba(255,255,255,0.05)" }}><div style={{ fontWeight: 900, fontSize: 15 }}>Strength</div><div style={{ marginTop: 6, opacity: 0.84, lineHeight: 1.6 }}>Is momentum improving or weakening?</div></div>
              <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, padding: 14, background: "rgba(255,255,255,0.05)" }}><div style={{ fontWeight: 900, fontSize: 15 }}>Location</div><div style={{ marginTop: 6, opacity: 0.84, lineHeight: 1.6 }}>Is price near support, resistance, or stretched away from value?</div></div>
            </div>
          </section>
          <section style={{ marginTop: 28, padding: 18, borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)" }}><h2 style={{ margin: 0, fontSize: 24, lineHeight: 1.2 }}>1. Start with trend</h2><p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>The first thing to read on any stock chart is trend. Ask whether price is making higher highs and higher lows, lower highs and lower lows, or moving sideways in a range.</p><p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>Beginners often make charts too complicated too early. In most cases, trend should come first before you look at any indicator.</p></section>
          <section style={{ marginTop: 28, padding: 18, borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)" }}><h2 style={{ margin: 0, fontSize: 24, lineHeight: 1.2 }}>2. Find support and resistance</h2><p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>Support is an area where price has previously held up. Resistance is an area where price has previously struggled to move higher. These areas help traders judge whether a stock is near a level where buyers or sellers may react again.</p></section>
          <section style={{ marginTop: 28, padding: 18, borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)" }}><h2 style={{ margin: 0, fontSize: 24, lineHeight: 1.2 }}>3. Use indicators to confirm, not to lead</h2><p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>Indicators are most useful when they support what price is already showing. For example, RSI can help identify whether momentum is stretched, MACD can help show whether momentum is strengthening or fading, and moving averages can help define the bigger trend.</p></section>
          <section style={{ marginTop: 28, padding: 18, borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)" }}><h2 style={{ margin: 0, fontSize: 24, lineHeight: 1.2 }}>4. Learn to recognise stretch</h2><p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>A stock can be trending well and still become stretched in the short term. This is where tools like RSI, Stochastic, Bollinger Bands, VWAP, and moving-average distance can help. They show whether price is becoming overbought, oversold, or extended away from a more normal range.</p></section>
          <section style={{ marginTop: 28, padding: 18, borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)" }}><h2 style={{ margin: 0, fontSize: 24, lineHeight: 1.2 }}>5. Read market context, not just the stock</h2><p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>A stock chart does not exist in isolation. It helps to know whether the wider market is strong or weak, whether volatility is rising, and whether the move is happening with real participation. That is why market context and benchmark tracking matter.</p></section>
          <section style={{ marginTop: 28, padding: 20, borderRadius: 18, border: "1px solid rgba(34,197,94,0.28)", background: "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}>
            <div style={{ fontWeight: 900, fontSize: 20 }}>Use MyStockHarbor to practise</div>
            <p style={{ margin: "10px 0 0", opacity: 0.86, lineHeight: 1.65 }}>MyStockHarbor was built to make chart reading easier for beginner and intermediate users. You can quickly check trend, stretch, momentum, divergence, and market context in one place.</p>
            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "13px 18px", borderRadius: 14, border: "1px solid rgba(34,197,94,0.45)", background: "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.18))", color: "#f8fafc", textDecoration: "none", fontWeight: 900, minHeight: 48, boxShadow: "0 10px 24px rgba(0,0,0,0.22)", whiteSpace: "nowrap" }}>Open the Dashboard →</Link>
              <Link href="/learn" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "13px 18px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#f8fafc", textDecoration: "none", fontWeight: 900, minHeight: 48, whiteSpace: "nowrap" }}>Explore Learn Page →</Link>
            </div>
          </section>
        </div>
        <style>{`a:hover{filter:brightness(1.05);transform:translateY(-1px)}@media(max-width:900px){.wrap{padding:22px 18px 36px!important}}@media(max-width:760px){.wrap{padding:16px!important}}`}</style>
      </main>
    </>
  );
}
