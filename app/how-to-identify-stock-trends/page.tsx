import type { Metadata } from "next";
import Link from "next/link";
import GuideJsonLd from "@/app/components/GuideJsonLd";

const TITLE = "How to Identify Stock Trends";
const DESC = "Learn how to identify stock trends using moving averages, price structure, and momentum indicators so you can trade in the direction of the market.";
const PATH = "/how-to-identify-stock-trends";

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

export default function HowToIdentifyStockTrendsPage() {
  return (
    <>
      <GuideJsonLd path={PATH} title={TITLE} description={DESC} />
      <main
        style={{
          minHeight: "100vh",
          background: "#06080d",
          color: "#f1f5f9",
          fontFamily: "system-ui, Arial",
        }}
      >
        <div
          className="wrap"
          style={{ maxWidth: 940, margin: "0 auto", padding: "28px 20px 40px" }}
        >
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>Trend Guide</div>
            <h1 style={{ margin: 0, fontSize: 36, lineHeight: 1.15, letterSpacing: "-0.5px", maxWidth: 760 }}>How to Identify Stock Trends</h1>
            <p style={{ margin: 0, fontSize: 17, lineHeight: 1.7, opacity: 0.86, maxWidth: 760 }}>Identifying trend is one of the most important skills in chart reading. Before using indicators, traders should first understand whether price is moving up, moving down, or simply drifting sideways.</p>
            <p style={{ margin: 0, opacity: 0.82, lineHeight: 1.7, maxWidth: 760 }}>A clear trend gives context to everything else on the chart. It helps you judge whether momentum is healthy, whether pullbacks are normal, and whether signals should be treated as continuation or reversal risk.</p>
          </div>

          <section style={{ marginTop: 20, padding: 20, borderRadius: 18, border: "1px solid rgba(59,130,246,0.28)", background: "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(168,85,247,0.08))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Simple trend idea</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <div style={heroInfoCard()}><div style={{ fontWeight: 900, fontSize: 15 }}>Uptrend</div><div style={{ marginTop: 6, opacity: 0.88, lineHeight: 1.6 }}>Price keeps making higher highs and higher lows.</div></div>
              <div style={heroInfoCard()}><div style={{ fontWeight: 900, fontSize: 15 }}>Downtrend</div><div style={{ marginTop: 6, opacity: 0.88, lineHeight: 1.6 }}>Price keeps making lower highs and lower lows.</div></div>
              <div style={heroInfoCard()}><div style={{ fontWeight: 900, fontSize: 15 }}>Sideways</div><div style={{ marginTop: 6, opacity: 0.88, lineHeight: 1.6 }}>Price moves in a range without clear direction.</div></div>
            </div>
          </section>

          <section style={contentSectionStyle()}>
            <h2 style={sectionHeadingStyle()}>1. Start with price structure</h2>
            <p style={bodyTextStyle()}>The simplest way to identify trend is by looking at structure. Ask whether price is making:</p>
            <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
              <div style={bulletCardStyle()}><strong>Higher highs and higher lows</strong> → usually an uptrend</div>
              <div style={bulletCardStyle()}><strong>Lower highs and lower lows</strong> → usually a downtrend</div>
              <div style={bulletCardStyle()}><strong>Repeated failed breakouts in both directions</strong> → often a range</div>
            </div>
            <p style={bodyTextStyle()}>This should always come before indicators. Trend begins with price.</p>
          </section>

          <section style={contentSectionStyle()}>
            <h2 style={sectionHeadingStyle()}>2. Use moving averages to simplify the chart</h2>
            <p style={bodyTextStyle()}>Moving averages are one of the easiest ways for beginners to confirm trend direction. The 50-day and 200-day moving averages are especially useful.</p>
            <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
              <div style={bulletCardStyle()}>Price above MA50 and MA200 often suggests strength</div>
              <div style={bulletCardStyle()}>MA50 above MA200 often suggests stronger long-term structure</div>
              <div style={bulletCardStyle()}>Price below those averages often suggests a weaker trend</div>
            </div>
          </section>

          <section style={contentSectionStyle()}>
            <h2 style={sectionHeadingStyle()}>3. Check whether momentum agrees</h2>
            <p style={bodyTextStyle()}>A healthy trend usually has momentum behind it. This is where indicators like RSI and MACD can help.</p>
            <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
              <div style={bulletCardStyle()}>Strong bullish trends often keep RSI firm and MACD positive</div>
              <div style={bulletCardStyle()}>Weakening trends often show fading MACD or bearish divergence</div>
              <div style={bulletCardStyle()}>Choppy trends often produce mixed and unreliable momentum signals</div>
            </div>
          </section>

          <section style={contentSectionStyle()}>
            <h2 style={sectionHeadingStyle()}>4. Recognise pullbacks versus reversals</h2>
            <p style={bodyTextStyle()}>One of the hardest parts of trend reading is knowing whether price is simply pulling back or actually reversing.</p>
            <p style={bodyTextStyle()}>In a healthy uptrend, price often pulls back without breaking the larger structure. In a real reversal, price starts breaking key lows, losing moving-average support, and showing weaker momentum.</p>
          </section>

          <section style={contentSectionStyle()}>
            <h2 style={sectionHeadingStyle()}>5. Use market context</h2>
            <p style={bodyTextStyle()}>A stock trend is easier to trust when the wider market supports it. A stock trying to trend higher in a weak market often faces more resistance than one moving with a strong broader market.</p>
          </section>

          <section style={contentSectionStyle()}>
            <h2 style={sectionHeadingStyle()}>Simple beginner checklist</h2>
            <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <div style={heroInfoCard()}><div style={{ fontWeight: 900 }}>Step 1</div><div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>Look at price structure first.</div></div>
              <div style={heroInfoCard()}><div style={{ fontWeight: 900 }}>Step 2</div><div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>Check where price is relative to MA50 and MA200.</div></div>
              <div style={heroInfoCard()}><div style={{ fontWeight: 900 }}>Step 3</div><div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>Use RSI or MACD to confirm momentum.</div></div>
              <div style={heroInfoCard()}><div style={{ fontWeight: 900 }}>Step 4</div><div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>Check whether the wider market supports the move.</div></div>
            </div>
          </section>

          <section style={{ marginTop: 30, padding: 20, borderRadius: 18, border: "1px solid rgba(34,197,94,0.28)", background: "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}>
            <div style={{ fontWeight: 900, fontSize: 20 }}>Use MyStockHarbor to check trend faster</div>
            <p style={{ marginTop: 10, opacity: 0.86, lineHeight: 1.6 }}>MyStockHarbor helps you quickly assess trend, stretch, momentum, divergence, and market context so you can understand whether a stock is moving strongly or simply drifting.</p>
            <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>If you want to explore real examples, visit the <Link href="/pickers" style={{ color: "#60a5fa", fontWeight: 800, textDecoration: "none" }}>Find Your Next Stock</Link> page for live stocks grouped by setup type.</p>
            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/" style={ctaPrimaryStyle()}>Open the Dashboard →</Link>
              <Link href="/pickers" style={ctaSecondaryStyle()}>Browse Stock Ideas →</Link>
              <Link href="/how-to-read-stock-charts" style={ctaSecondaryStyle()}>Read Chart Guide →</Link>
            </div>
          </section>
        </div>

        <style>{`a:hover{filter:brightness(1.05);transform:translateY(-1px)}@media(max-width:900px){.wrap{padding:22px 18px 36px!important}}@media(max-width:760px){.wrap{padding:16px!important}}`}</style>
      </main>
    </>
  );
}

function heroInfoCard(): React.CSSProperties {
  return { borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", padding: 14 };
}
function bulletCardStyle(): React.CSSProperties {
  return { borderRadius: 14, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)", padding: 14, lineHeight: 1.6, opacity: 0.9 };
}
function contentSectionStyle(): React.CSSProperties {
  return { marginTop: 28, padding: 18, borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)" };
}
function sectionHeadingStyle(): React.CSSProperties {
  return { fontSize: 24, margin: 0, lineHeight: 1.2 };
}
function bodyTextStyle(): React.CSSProperties {
  return { marginTop: 12, opacity: 0.86, lineHeight: 1.7 };
}
function ctaPrimaryStyle(): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "13px 18px", borderRadius: 14, border: "1px solid rgba(34,197,94,0.45)", background: "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.18))", color: "#f8fafc", textDecoration: "none", fontWeight: 900, minHeight: 48, whiteSpace: "nowrap" };
}
function ctaSecondaryStyle(): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "13px 18px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#f8fafc", textDecoration: "none", fontWeight: 900, minHeight: 48, whiteSpace: "nowrap" };
}
