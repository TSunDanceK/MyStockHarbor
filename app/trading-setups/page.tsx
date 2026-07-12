import type { Metadata } from "next";
import Link from "next/link";
import LearnShell from "@/app/learn/LearnShell";
import GuideJsonLd from "@/app/components/GuideJsonLd";

const TITLE = "Trading Setups";
const DESC = "Explore common trading setups including breakouts, oversold reversals, buy the dip ideas and bullish or bearish divergence.";
const PATH = "/trading-setups";

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

const cards = [
  { href: "/breakout-stocks", title: "Breakout Stocks", desc: "Stocks pushing above resistance with strong momentum and price expansion.", tint: "red" },
  { href: "/oversold-stocks", title: "Oversold Stocks", desc: "Stocks that may be stretched to the downside after heavy selling.", tint: "blue" },
  { href: "/overbought-stocks", title: "Overbought Stocks", desc: "Stocks that may be stretched after strong upside moves and fast rallies.", tint: "amber" },
  { href: "/buy-the-dip-stocks", title: "Buy The Dip", desc: "Pullback opportunities within stronger trends where buyers may step back in.", tint: "green" },
  { href: "/stocks-down-from-highs", title: "Stocks Down From Highs", desc: "Stocks that have pulled back significantly from recent highs.", tint: "purple" },
  { href: "/bullish-divergence-stocks", title: "Bullish Divergence", desc: "When momentum starts improving even while price still looks weak.", tint: "green" },
  { href: "/bearish-divergence-stocks", title: "Bearish Divergence", desc: "When momentum starts weakening during rising prices.", tint: "red" },
];

export default function TradingSetupsPage() {
  return (
    <>
      <GuideJsonLd path={PATH} title={TITLE} description={DESC} />
      <LearnShell activeHref="/trading-setups">
          <div style={{ maxWidth: 760 }}>
            <div style={{ display: "inline-flex", alignItems: "center", padding: "7px 12px", borderRadius: 999, background: "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(127,29,29,0.12))", border: "1px solid rgba(239,68,68,0.34)", color: "#fee2e2", fontWeight: 950, letterSpacing: "0.08em", fontSize: 12 }}>TRADING SETUPS</div>
            <h1 style={{ margin: "14px 0 0 0", fontSize: 42, lineHeight: 1.08, letterSpacing: "-0.6px" }}>Trading Setups</h1>
            <p style={{ margin: "12px 0 0 0", opacity: 0.8, lineHeight: 1.6, fontSize: 17 }}>Trading setups help traders spot repeatable opportunities in the stock market. Explore common setups like breakouts, oversold reversals, buy the dip ideas and bullish or bearish divergence.</p>
          </div>
          <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
            {cards.map((card) => {
              const colors: Record<string, { border: string; background: string }> = {
                blue: { border: "1px solid rgba(59,130,246,0.24)", background: "linear-gradient(180deg, rgba(10,18,34,0.96), rgba(7,12,24,0.98))" },
                green: { border: "1px solid rgba(34,197,94,0.24)", background: "linear-gradient(180deg, rgba(9,18,16,0.96), rgba(7,12,11,0.98))" },
                red: { border: "1px solid rgba(239,68,68,0.24)", background: "linear-gradient(180deg, rgba(24,12,12,0.96), rgba(14,7,7,0.98))" },
                amber: { border: "1px solid rgba(234,179,8,0.24)", background: "linear-gradient(180deg, rgba(18,16,10,0.96), rgba(12,10,7,0.98))" },
                purple: { border: "1px solid rgba(168,85,247,0.24)", background: "linear-gradient(180deg, rgba(14,11,24,0.96), rgba(9,8,16,0.98))" },
              };
              const s = colors[card.tint];
              return (
                <Link key={card.href} href={card.href} style={{ ...s, borderRadius: 16, padding: 16, textDecoration: "none", color: "#f1f5f9", display: "block" }}>
                  <div style={{ fontWeight: 900, fontSize: 17 }}>{card.title}</div>
                  <div style={{ marginTop: 7, fontSize: 13, opacity: 0.78, lineHeight: 1.55 }}>{card.desc}</div>
                </Link>
              );
            })}
          </div>
          <section style={{ marginTop: 24, border: "1px solid rgba(34,197,94,0.22)", borderRadius: 18, padding: 20, background: "linear-gradient(180deg, rgba(8,20,16,0.96), rgba(7,12,11,0.98))" }}>
            <h2 style={{ margin: "0 0 10px", fontSize: 26 }}>Turn these lessons into live chart practice</h2>
            <p style={{ margin: 0, opacity: 0.82, lineHeight: 1.6 }}>Use the Dashboard to inspect charts and use Stock Pickers to search for ideas that match the setup you are learning.</p>
            <div style={{ marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link href="/" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "11px 15px", borderRadius: 12, border: "1px solid rgba(250,204,21,0.42)", background: "linear-gradient(135deg, rgba(250,204,21,0.22), rgba(202,138,4,0.12))", color: "#fefce8", textDecoration: "none", fontWeight: 900 }}>Open the Dashboard →</Link>
              <Link href="/pickers" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "11px 15px", borderRadius: 12, border: "1px solid rgba(239,68,68,0.38)", background: "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(127,29,29,0.10))", color: "#fef2f2", textDecoration: "none", fontWeight: 900 }}>Explore Stock Pickers →</Link>
            </div>
          </section>
        </LearnShell>
    </>
  );
}
