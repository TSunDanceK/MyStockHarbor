import type { Metadata } from "next";
import Link from "next/link";
import PickersClient from "./PickersClient";
import BookmarkPromptButton from "./BookmarkPromptButton";

const pickersJsonLd = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "Stock Pickers",
  url: "https://www.mystockharbor.com/pickers",
  description: "Browse screened stock ideas including oversold stocks, overbought stocks, breakout setups, stocks near the 200-day moving average, divergence setups, unusual volume stocks, and pullback setups.",
  mainEntity: {
    "@type": "ItemList",
    itemListElement: [
      { "@type": "ListItem", position: 1, item: { "@type": "Thing", name: "Oversold Stocks", url: "https://www.mystockharbor.com/oversold-stocks" } },
      { "@type": "ListItem", position: 2, item: { "@type": "Thing", name: "Overbought Stocks", url: "https://www.mystockharbor.com/overbought-stocks" } },
      { "@type": "ListItem", position: 3, item: { "@type": "Thing", name: "Breakout Setups", url: "https://www.mystockharbor.com/breakout-stocks" } },
      { "@type": "ListItem", position: 4, item: { "@type": "Thing", name: "Pullback Setups", url: "https://www.mystockharbor.com/buy-the-dip-stocks" } },
      { "@type": "ListItem", position: 5, item: { "@type": "Thing", name: "Stocks Near 200-Day Moving Average", url: "https://www.mystockharbor.com/stocks-above-200-day-moving-average" } },
      { "@type": "ListItem", position: 6, item: { "@type": "Thing", name: "Pullback Setups (From Highs)", url: "https://www.mystockharbor.com/stocks-down-from-highs" } },
      { "@type": "ListItem", position: 7, item: { "@type": "Thing", name: "Bullish Divergence Setups", url: "https://www.mystockharbor.com/bullish-divergence-stocks" } },
      { "@type": "ListItem", position: 8, item: { "@type": "Thing", name: "Bearish Divergence Setups", url: "https://www.mystockharbor.com/bearish-divergence-stocks" } },
    ],
  },
  breadcrumb: { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: "https://www.mystockharbor.com/" }, { "@type": "ListItem", position: 2, name: "Stock Pickers", item: "https://www.mystockharbor.com/pickers" }] },
};

export const metadata: Metadata = {
  title: "Stock Pickers, Breakouts & Oversold Setups | MyStockHarbor (My Stock Harbor)",
  description: "Find screened stock ideas using breakout, oversold, divergence and dip-buy setup filters. Open any stock in the MyStockHarbor dashboard for deeper chart analysis.",
  alternates: { canonical: "https://www.mystockharbor.com/pickers" },
  openGraph: { title: "Stock Pickers, Breakouts & Oversold Setups | MyStockHarbor", description: "Explore screened stock ideas using breakout, oversold, divergence and dip-buy setup filters.", url: "https://www.mystockharbor.com/pickers", siteName: "MyStockHarbor", type: "website" },
  twitter: { card: "summary_large_image", title: "Stock Pickers, Breakouts & Oversold Setups | MyStockHarbor", description: "Explore screened stock ideas using breakout, oversold, divergence and dip-buy setup filters." },
};

const bundleGridStyle: React.CSSProperties = { marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 };
const compactLinkStyle: React.CSSProperties = { display: "block", textDecoration: "none", color: "#f1f5f9", borderRadius: 14, padding: 14, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)", transition: "transform 120ms ease, filter 120ms ease", minWidth: 0, boxSizing: "border-box" };
const supportCardStyle: React.CSSProperties = { border: "1px solid rgba(255,255,255,0.10)", borderRadius: 16, padding: 16, background: "rgba(255,255,255,0.03)", textDecoration: "none", color: "#f1f5f9", display: "block", transition: "transform 120ms ease, filter 120ms ease", minWidth: 0, boxSizing: "border-box" };
const smallLinkTextStyle: React.CSSProperties = { marginTop: 8, fontSize: 13, opacity: 0.72, lineHeight: 1.6 };
const midCardTextStyle: React.CSSProperties = { marginTop: 8, fontSize: 14, opacity: 0.74, lineHeight: 1.6 };

const SETUP_LINKS: { label: string; href: string }[] = [
  { label: "Ascending Triangle Plays", href: "/plays" },
  { label: "Descending Triangle Plays", href: "/plays/descending-triangles" },
  { label: "Bull Flag Plays", href: "/plays/bull-flags" },
  { label: "Macro Support / Resistance Plays", href: "/macro-support-resistance-stocks" },
  { label: "Top Stocks With Buy Signals", href: "/top-stocks-with-buy-signals" },
  { label: "Stocks Down 20% From All-Time Highs", href: "/stocks-down-20-from-all-time-highs" },
  { label: "All-Time High Breakout Stocks", href: "/all-time-high-breakout-stocks" },
  { label: "3-Month High Breakout Stocks", href: "/3-month-high-breakout-stocks" },
  { label: "Top Stocks With Sell Signals", href: "/top-stocks-with-sell-signals" },
  { label: "Oversold Stocks Today", href: "/oversold-stocks-today" },
  { label: "Overbought Stocks Today", href: "/overbought-stocks-today" },
  { label: "Best Trend Score Stocks", href: "/best-trend-score-stocks" },
  { label: "MA200 Proximity", href: "/stocks-near-200-day-moving-average" },
  { label: "Bullish & Bearish Divergence", href: "/bullish-bearish-divergence-stocks" },
  { label: "Stocks With Positive Last Earnings", href: "/stocks-with-positive-last-earnings" },
  { label: "Stocks With Strong Earnings Growth", href: "/stocks-with-strong-earnings-growth" },
];

export default function PickersPage() {
  return (
    <main style={{ padding: 0, fontFamily: "system-ui, Arial", background: "#06080d", color: "#f1f5f9", minHeight: "100vh" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pickersJsonLd) }} />

      <div className="wrap">
        <div style={{ display: "grid", gap: 14 }}>
          <div className="heroGrid">

            {/* Left panel */}
            <section className="heroPanel" style={{ border: "1px solid rgba(59,130,246,0.18)", borderRadius: 22, padding: 18, background: "linear-gradient(135deg, rgba(10,16,32,0.98), rgba(7,11,22,0.98))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 14px 34px rgba(0,0,0,0.28)", minWidth: 0, width: "100%", boxSizing: "border-box", overflow: "hidden" }}>
              <div className="pickersHeroPills" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 11px", borderRadius: 999, border: "1px solid rgba(59,130,246,0.28)", background: "rgba(59,130,246,0.10)", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#93c5fd", maxWidth: "100%", boxSizing: "border-box" }}>
                  Stock Pickers
                </div>
                <BookmarkPromptButton compact />
              </div>
              <h1 className="pickersHeroTitle" style={{ margin: "12px 0 0 0", fontSize: 30, lineHeight: 1.08, letterSpacing: "-0.035em", fontWeight: 800 }}>
                Stock Pickers &amp; Technical Setup Ideas
              </h1>
              <p className="pickersHeroText" style={{ marginTop: 8, fontSize: 14, lineHeight: 1.6, opacity: 0.72, maxWidth: 480 }}>
                Screened ideas across oversold, breakouts, divergence, 200-day MA tests and more. Starting points for chart analysis — not buy or sell recommendations.
              </p>
            </section>

            {/* Right panel — 3-col bullet list — desktop only */}
            <section className="heroPanel mobile-hide-screened-setups" style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 22, padding: "18px 20px", background: "rgba(10,14,24,0.96)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 14px 34px rgba(0,0,0,0.28)", minWidth: 0, width: "100%", boxSizing: "border-box", overflow: "hidden" }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "rgba(148,163,184,0.70)", marginBottom: 12 }}>All screened setups on this page</div>
              <div className="hero-bullet-grid">
                {SETUP_LINKS.map((s) => (
                  <Link key={s.href} href={s.href} className="hero-bullet-item" style={{ display: "flex", alignItems: "center", gap: 7, textDecoration: "none", color: "#cbd5e1", fontSize: 12, fontWeight: 500, lineHeight: 1.3, padding: "3px 0", transition: "color 120ms ease" }}>
                    <span style={{ width: 5, height: 5, borderRadius: 999, background: "#22c55e", boxShadow: "0 0 6px rgba(34,197,94,0.70)", flex: "0 0 auto" }} />
                    {s.label}
                  </Link>
                ))}
              </div>
            </section>
          </div>
        </div>

        {/* Main screened results panel */}
        <section style={{ marginTop: 24, width: "100%", borderRadius: 18, border: "1px solid rgba(255,255,255,0.10)", background: "#08101e", overflow: "hidden", position: "relative", boxSizing: "border-box" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}>
            <div style={{ display: "inline-block", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(148,163,184,0.65)", marginBottom: 8 }}>Screened Results</div>
            <h2 style={{ margin: "0 0 6px", fontSize: 24, lineHeight: 1.12, letterSpacing: "-0.025em", fontWeight: 700 }}>Screened setups across the market</h2>
            <p className="pickers-mobile-hide" style={{ margin: 0, fontSize: 14, lineHeight: 1.6, opacity: 0.62, maxWidth: 720 }}>
              These lists are filtered and ranked to surface cleaner, more relevant setups first. Starting points for chart review — not financial advice.
            </p>
          </div>
          <div style={{ padding: 18, boxSizing: "border-box" }}>
            <PickersClient />
          </div>
        </section>

        {/* Learn more */}
        <section style={{ marginTop: 22, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 20, background: "rgba(9,13,20,0.92)", boxSizing: "border-box", width: "100%" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(148,163,184,0.65)", marginBottom: 10 }}>Learn more</div>
          <h2 style={{ margin: "0 0 8px", fontSize: 22, lineHeight: 1.15, letterSpacing: "-0.025em", fontWeight: 700 }}>Learn the setups and indicators behind these ideas</h2>
          <p style={{ margin: "0", lineHeight: 1.65, opacity: 0.68, maxWidth: 760, fontSize: 14 }}>Start with the Trading Setups Hub, Indicators Hub or Stock Scanners Hub.</p>
          <div style={bundleGridStyle}>
            <Link href="/trading-setups" style={{ ...compactLinkStyle, border: "1px solid rgba(239,68,68,0.18)", background: "rgba(239,68,68,0.05)" }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Trading Setups Hub</div>
              <div style={smallLinkTextStyle}>Breakouts, oversold setups, pullbacks and divergence.</div>
            </Link>
            <Link href="/stock-indicators" style={{ ...compactLinkStyle, border: "1px solid rgba(34,197,94,0.18)", background: "rgba(34,197,94,0.05)" }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Indicators Hub</div>
              <div style={smallLinkTextStyle}>RSI, MACD, volume and moving average signals explained.</div>
            </Link>
            <Link href="/stock-scanners" style={{ ...compactLinkStyle, border: "1px solid rgba(168,85,247,0.18)", background: "rgba(168,85,247,0.05)" }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Stock Scanners Hub</div>
              <div style={smallLinkTextStyle}>How traders scan for ideas and compare tools.</div>
            </Link>
          </div>
        </section>

        {/* Support cards */}
        <section style={{ marginTop: 22, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, width: "100%", boxSizing: "border-box" }}>
          <Link href="/" style={{ ...supportCardStyle, border: "1px solid rgba(250,204,21,0.18)", background: "rgba(24,20,8,0.60)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 8, border: "1px solid rgba(250,204,21,0.24)", background: "rgba(250,204,21,0.08)", fontSize: 14, flex: "0 0 auto" }}>📈</span>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#fefce8" }}>Open the dashboard</div>
            </div>
            <div style={midCardTextStyle}>Review price structure, overlays and indicators for any symbol on this page.</div>
          </Link>
          <Link href="/learn" style={{ ...supportCardStyle, border: "1px solid rgba(59,130,246,0.18)", background: "rgba(8,16,30,0.60)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 8, border: "1px solid rgba(59,130,246,0.24)", background: "rgba(59,130,246,0.08)", fontSize: 14, flex: "0 0 auto" }}>📘</span>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#eff6ff" }}>Visit the Learn hub</div>
            </div>
            <div style={midCardTextStyle}>Chart concepts, setups and beginner-friendly guides.</div>
          </Link>
          <Link href="/platforms" style={{ ...supportCardStyle, border: "1px solid rgba(34,197,94,0.18)", background: "rgba(8,20,16,0.60)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 8, border: "1px solid rgba(34,197,94,0.24)", background: "rgba(34,197,94,0.08)", fontSize: 14, flex: "0 0 auto" }}>🏦</span>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#f0fdf4" }}>Compare platforms</div>
            </div>
            <div style={midCardTextStyle}>Review charting and broker options after narrowing down your ideas.</div>
          </Link>
        </section>

        {/* FAQ */}
        <section style={{ marginTop: 22, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 20, background: "rgba(9,13,20,0.92)", boxSizing: "border-box", width: "100%" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(148,163,184,0.65)", marginBottom: 10 }}>FAQ</div>
          <h2 style={{ margin: "0 0 14px", fontSize: 22, lineHeight: 1.15, letterSpacing: "-0.025em", fontWeight: 700 }}>Frequently asked questions</h2>
          <div style={{ display: "grid", gap: 14 }}>
            <div><h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Is this a stock screener?</h3><p style={{ margin: "6px 0 0", lineHeight: 1.7, opacity: 0.72, fontSize: 14 }}>Yes. It works like a stock idea screener built around technical setups such as oversold conditions, divergence, pullback setups and breakouts.</p></div>
            <div><h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Are these buy or sell recommendations?</h3><p style={{ margin: "6px 0 0", lineHeight: 1.7, opacity: 0.72, fontSize: 14 }}>No. These are idea filters only. They help you narrow down charts to review, but they are not personal financial advice.</p></div>
            <div><h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Why are some stocks ranked higher than others?</h3><p style={{ margin: "6px 0 0", lineHeight: 1.7, opacity: 0.72, fontSize: 14 }}>The lists are filtered and ranked to surface cleaner, more relevant setups first.</p></div>
            <div><h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>What should I do after clicking a stock?</h3><p style={{ margin: "6px 0 0", lineHeight: 1.7, opacity: 0.72, fontSize: 14 }}>Open it in the dashboard, review the chart structure, check key indicators and confirm whether the setup still makes sense before acting.</p></div>
          </div>
        </section>
      </div>

      <style>{`
        .wrap { max-width: 1240px; margin: 0 auto; padding: 28px 20px 40px; box-sizing: border-box; }
        /* Left wider (title), right narrower (bullet list still fits 3 cols) */
        .heroGrid { display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr); gap: 14px; align-items: stretch; min-width: 0; width: 100%; }
        /* 3 tight columns */
        .hero-bullet-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px 10px; }
        .hero-bullet-item:hover { color: #e2e8f0 !important; }
        a:hover { filter: brightness(1.05); transform: translateY(-1px); }
        .msh-site-nav { position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:8px;padding:12px 24px;background:rgba(10,15,26,0.90);backdrop-filter:blur(14px);border-bottom:1px solid #1a2336; }
        .msh-site-nav-logo { display:flex;align-items:center;margin-right:4px;text-decoration:none;flex:0 0 auto; }
        .msh-site-nav-logo img { height:38px;width:auto;display:block; }
        .msh-site-navlinks { display:flex;align-items:center;gap:2px;margin-left:auto;min-width:0; }
        .msh-site-navlink { color:#8a97ad;font-size:13.5px;font-weight:600;text-decoration:none;padding:7px 12px;border-radius:8px;transition:color .15s,background .15s,transform .15s,filter .15s;white-space:nowrap; }
        .msh-site-navlink:hover { color:#eaf0fa;background:#141b2b; }
        .msh-site-navlink.active { color:#eaf0fa;background:#141b2b;border:1px solid #222c40; }
        .pickers-desktop-only { display: block; }
        @media (max-width: 1000px) {
          .heroGrid { grid-template-columns: 1fr !important; }
          .hero-bullet-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
        @media (max-width: 900px) { .wrap { padding: 18px 16px 34px !important; } }
        @media (max-width: 640px) {
          .wrap { padding-left: 12px !important; padding-right: 12px !important; }
          .pickers-desktop-only { display: none !important; }
          .mobile-hide-screened-setups { display: none !important; }
          .pickers-mobile-hide { display: none !important; }
          .heroPanel { padding: 14px !important; border-radius: 16px !important; }
          .pickersHeroTitle { font-size: 24px !important; line-height: 1.08 !important; }
          .pickersHeroText { font-size: 14px !important; margin-top: 8px !important; }
          .pickersHeroPills { align-items: stretch !important; }
          .msh-site-nav { padding: 10px 12px 8px; gap: 8px; align-items: stretch; flex-direction: column; }
          .msh-site-nav-logo { align-self: flex-start; }
          .msh-site-nav-logo img { height: 34px; }
          .msh-site-navlinks { margin-left: 0; overflow-x: auto; gap: 4px; padding-bottom: 2px; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
          .msh-site-navlinks::-webkit-scrollbar { display: none; }
          .msh-site-navlink { flex: 0 0 auto; font-size: 12.5px; padding: 8px 10px; }
        }
        @media (max-width: 420px) {
          .wrap { padding-left: 10px !important; padding-right: 10px !important; }
          .pickersHeroTitle { font-size: 20px !important; }
          .heroPanel { padding: 12px !important; }
        }
      `}</style>
    </main>
  );
}

function MiniStat({ label, value, tint }: { label: string; value: string; tint: "green" | "amber" }) {
  const styles = tint === "green"
    ? { border: "1px solid rgba(34,197,94,0.24)", background: "rgba(9,18,16,0.94)", labelColor: "#bbf7d0" }
    : { border: "1px solid rgba(234,179,8,0.24)", background: "rgba(18,16,10,0.94)", labelColor: "#fde68a" };
  return (
    <div style={{ border: styles.border, background: styles.background, borderRadius: 14, padding: 14, minWidth: 0, boxSizing: "border-box" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: styles.labelColor }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 15, fontWeight: 700, lineHeight: 1.35 }}>{value}</div>
    </div>
  );
}
