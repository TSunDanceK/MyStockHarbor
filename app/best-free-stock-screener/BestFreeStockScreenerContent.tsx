"use client";
import Link from "next/link";
import GuideJsonLd from "@/app/components/GuideJsonLd";

const TITLE = "Best Free Stock Screener";
const DESC = "Find the best free stock screener for traders and investors. Compare screeners for technical analysis, momentum, breakouts, and fundamental filters.";
const PATH = "/best-free-stock-screener";

export default function BestFreeStockScreenerPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#06080d", color: "#f1f5f9", fontFamily: "system-ui, Arial" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "28px 20px 40px" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
          <Link href="/" style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#f1f5f9", textDecoration: "none", fontWeight: 850 }}>← Dashboard</Link>
          <Link href="/pickers" style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#f1f5f9", textDecoration: "none", fontWeight: 850 }}>Find Your Next Stock →</Link>
        </div>
        <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 800, letterSpacing: "0.3px" }}>STOCK SCREENER GUIDE</div>
        <h1 style={{ margin: "8px 0 0", fontSize: 36, lineHeight: 1.15, letterSpacing: "-0.5px" }}>Best Free Stock Screener: What Traders Should Look For</h1>
        <p style={{ marginTop: 14, fontSize: 17, lineHeight: 1.7, opacity: 0.86 }}>The best free stock screener is not just the one with the most filters. It is the one that helps you narrow the market down quickly, understand what you are looking at, and move from screening into proper chart review without adding too much friction.</p>
        <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>Different traders want different things. Some want breakout scans. Some want oversold names. Some want a quick way to surface stock ideas and then study the chart. That is why the best free stock screener depends less on hype and more on how well the tool fits your process.</p>
        <div style={{ marginTop: 18, padding: 18, borderRadius: 16, border: "1px solid rgba(59,130,246,0.28)", background: "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(168,85,247,0.08))" }}>
          <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.78 }}>SIMPLE WAY TO THINK ABOUT IT</div>
          <div style={{ marginTop: 6, fontSize: 24, fontWeight: 900 }}>A good free stock screener should help you find ideas fast and judge them clearly.</div>
        </div>
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>1. What makes a free stock screener useful?</h2>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>A useful free stock screener helps traders reduce a huge universe of stocks into a smaller list of names worth investigating. The main point is not to generate endless lists. The point is to surface relevant candidates and make it easier to decide which charts deserve more attention.</p>
        </section>
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>2. Features traders often want</h2>
          <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
            {[{t:"Easy setup filtering",d:"Traders often want a simple way to explore themes like breakouts, oversold stocks, pullbacks or momentum names without building overly complex scans from scratch."},{t:"Clean chart follow-up",d:"Screening only gets you part of the way. A good screener should make it easy to follow up with chart review."},{t:"Clear signal, less clutter",d:"The best tools help you focus on what matters. Too many columns, menus and settings can actually slow traders down."},{t:"Useful educational context",d:"A strong screener experience is even better when it helps users understand what a setup means, not just where to click."}].map((item) => (
              <div key={item.t} style={{ borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", padding: 16 }}>
                <div style={{ fontWeight: 900 }}>{item.t}</div>
                <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>{item.d}</div>
              </div>
            ))}
          </div>
        </section>
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>3. Why "best" depends on your strategy</h2>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>The best free stock screener for a breakout trader may not be the best one for someone looking for oversold rebounds. A tool feels useful when it helps you find the kinds of ideas you actually want to trade.</p>
        </section>
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>4. Using MyStockHarbor as a free stock screener</h2>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>MyStockHarbor helps you explore stock ideas through setup-based stock pickers and chart review tools. Instead of forcing you to build every search from scratch, it helps you start from the kind of setup you are interested in and then review candidates more closely.</p>
          <div style={{ marginTop: 16, padding: 18, borderRadius: 16, border: "1px solid rgba(34,197,94,0.28)", background: "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))" }}>
            <div style={{ fontWeight: 900, fontSize: 21 }}>Explore stock ideas with MyStockHarbor</div>
            <p style={{ marginTop: 10, opacity: 0.86, lineHeight: 1.6 }}>Use the MyStockHarbor stock pickers to explore live market ideas, review charts and research common setup types in one place.</p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
              <Link href="/pickers" style={{ padding: "13px 18px", borderRadius: 14, border: "1px solid rgba(34,197,94,0.45)", background: "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.18))", color: "#f8fafc", textDecoration: "none", fontWeight: 900 }}>Open Stock Pickers →</Link>
            </div>
          </div>
        </section>
        <section style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>Related guides</h2>
          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            {[{href:"/stock-screener-for-breakouts",title:"Stock Screener for Breakouts"},{href:"/stock-screener-for-oversold-stocks",title:"Stock Screener for Oversold Stocks"},{href:"/trading-setups",title:"Trading Setups"},{href:"/best-stock-indicators-for-beginners",title:"Best Stock Indicators for Beginners"}].map((item) => (
              <Link key={item.href} href={item.href} style={{ borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", padding: 16, textDecoration: "none", color: "#f1f5f9", display: "block" }}>
                <div style={{ fontWeight: 900 }}>{item.title}</div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
