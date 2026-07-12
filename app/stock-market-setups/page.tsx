import type { Metadata } from "next";
import Link from "next/link";
import LearnShell from "@/app/learn/LearnShell";
import GuideJsonLd from "@/app/components/GuideJsonLd";

const TITLE = "Stock Market Setups Explained";
const DESC = "Learn the most common stock market setups traders look for, including breakouts, pullbacks, oversold bounces, and divergence signals, with examples.";
const PATH = "/stock-market-setups";

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

const setups = [
  { title: "Oversold Stocks", href: "/oversold-stocks", description: "Learn how traders identify oversold stocks and potential rebound setups when price becomes stretched downward.", tint: "blue" as const },
  { title: "Overbought Stocks", href: "/overbought-stocks", description: "Understand how traders identify overbought conditions and stretched upside momentum.", tint: "amber" as const },
  { title: "Breakout Stocks", href: "/breakout-stocks", description: "Learn how traders spot stocks breaking above resistance or moving into strong momentum.", tint: "red" as const },
  { title: "Buy The Dip Stocks", href: "/buy-the-dip-stocks", description: "Explore how investors and traders review pullbacks in strong stocks and look for potential dip opportunities.", tint: "green" as const },
  { title: "Stocks Down From Highs", href: "/stocks-down-from-highs", description: "Understand how traders review stocks that have fallen from recent highs.", tint: "purple" as const },
  { title: "Bullish Divergence", href: "/bullish-divergence-stocks", description: "Learn how bullish divergence can signal fading downside momentum and possible reversal setups.", tint: "green" as const },
  { title: "Bearish Divergence", href: "/bearish-divergence-stocks", description: "Understand how bearish divergence may highlight weakening upside momentum in rising stocks.", tint: "red" as const },
];

export default function StockMarketSetupsPage() {
  return (
    <>
      <GuideJsonLd path={PATH} title={TITLE} description={DESC} />
      <LearnShell activeHref="/stock-market-setups">
          <div style={{ maxWidth: 760 }}>
            <div style={{ display: "inline-flex", alignItems: "center", padding: "7px 12px", borderRadius: 999, background: "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(127,29,29,0.12))", border: "1px solid rgba(239,68,68,0.34)", color: "#fee2e2", fontWeight: 950, letterSpacing: "0.08em", fontSize: 12 }}>TRADING SETUPS</div>
            <h1 style={{ margin: "14px 0 0 0", fontSize: 42, lineHeight: 1.08, letterSpacing: "-0.6px" }}>Common Stock Market Setups</h1>
            <p style={{ margin: "12px 0 0 0", fontSize: 17, lineHeight: 1.65, opacity: 0.84 }}>Traders often look for specific chart conditions when reviewing stocks. These setups can help highlight opportunities where momentum, trend, stretch or price structure may be changing.</p>
          </div>
          <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            {setups.map((setup) => {
              const colors: Record<string, { border: string; background: string }> = {
                blue: { border: "1px solid rgba(59,130,246,0.24)", background: "linear-gradient(180deg, rgba(10,18,34,0.96), rgba(7,12,24,0.98))" },
                green: { border: "1px solid rgba(34,197,94,0.24)", background: "linear-gradient(180deg, rgba(9,18,16,0.96), rgba(7,12,11,0.98))" },
                red: { border: "1px solid rgba(239,68,68,0.24)", background: "linear-gradient(180deg, rgba(24,12,12,0.96), rgba(14,7,7,0.98))" },
                amber: { border: "1px solid rgba(234,179,8,0.24)", background: "linear-gradient(180deg, rgba(18,16,10,0.96), rgba(12,10,7,0.98))" },
                purple: { border: "1px solid rgba(168,85,247,0.24)", background: "linear-gradient(180deg, rgba(14,11,24,0.96), rgba(9,8,16,0.98))" },
              };
              const s = colors[setup.tint];
              return (
                <Link key={setup.href} href={setup.href} style={{ ...s, borderRadius: 16, padding: 18, textDecoration: "none", color: "#f1f5f9", display: "block" }}>
                  <div style={{ fontWeight: 900, fontSize: 18 }}>{setup.title}</div>
                  <p style={{ marginTop: 8, opacity: 0.8, lineHeight: 1.6, fontSize: 14 }}>{setup.description}</p>
                </Link>
              );
            })}
          </div>
          <section style={{ marginTop: 28, padding: 20, borderRadius: 18, border: "1px solid rgba(34,197,94,0.28)", background: "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))" }}>
            <h2 style={{ margin: 0, fontWeight: 900, fontSize: 26 }}>Put these setups into practice</h2>
            <p style={{ marginTop: 10, opacity: 0.86, lineHeight: 1.6 }}>You can explore many of these setups directly using the MyStockHarbor tools.</p>
            <div style={{ marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link href="/" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "11px 15px", borderRadius: 12, border: "1px solid rgba(250,204,21,0.42)", background: "linear-gradient(135deg, rgba(250,204,21,0.22), rgba(202,138,4,0.12))", color: "#fefce8", textDecoration: "none", fontWeight: 900 }}>Open the Dashboard →</Link>
              <Link href="/pickers" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "11px 15px", borderRadius: 12, border: "1px solid rgba(239,68,68,0.38)", background: "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(127,29,29,0.10))", color: "#fef2f2", textDecoration: "none", fontWeight: 900 }}>Find Your Next Stock →</Link>
            </div>
          </section>
        </LearnShell>
    </>
  );
}
