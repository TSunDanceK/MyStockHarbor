"use client";
import Link from "next/link";

export default function PositionSizingGuidePage() {
  return (
    <main style={{ minHeight: "100vh", background: "#06080d", color: "#f1f5f9", fontFamily: "system-ui, Arial" }}>
      <div className="wrap">
        <div style={{ maxWidth: 780 }}>
          <div style={{ display: "inline-flex", alignItems: "center", padding: "7px 12px", borderRadius: 999, background: "linear-gradient(135deg, rgba(168,85,247,0.20), rgba(139,92,246,0.10))", border: "1px solid rgba(168,85,247,0.34)", color: "#f3e8ff", fontWeight: 950, letterSpacing: "0.08em", fontSize: 12 }}>POSITION SIZING GUIDE</div>
          <h1 style={{ margin: "14px 0 0", fontSize: 42, lineHeight: 1.08, letterSpacing: "-0.6px" }}>Position Sizing in Trading: How to Control Risk</h1>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>Position sizing is one of the most important ideas in trading risk management. It determines how much capital you commit to a trade based on the amount you are prepared to lose if the trade goes wrong.</p>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>Many beginners focus only on finding the right stock, but experienced traders focus just as much on controlling risk. Position sizing ensures that one bad trade cannot damage your account.</p>
        </div>
        {[{n:"1",t:"What is position sizing?",body:"Position sizing means deciding how large a trade should be based on your risk tolerance and stop loss distance. For example, if you are willing to risk $100 on a trade and your stop loss is $2 away from your entry price, you would buy about 50 shares."},{n:"2",t:"Why position sizing matters",body:"It protects your account from large losses. Keeps risk consistent across different trades. Prevents emotional decision making. Helps traders survive losing streaks."},{n:"3",t:"How traders calculate position size",body:"Most traders start with a maximum dollar risk per trade — for example, 1% of their account. They then divide that risk amount by the distance between their entry price and stop loss."},{n:"4",t:"Position sizing and stop losses",body:"Position sizing only works properly when combined with a clear stop loss. Without a stop loss, traders cannot control their downside risk effectively."}].map((s) => (
          <section key={s.n} style={{ marginTop: 24, border: "1px solid rgba(59,130,246,0.22)", borderRadius: 18, padding: 20 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 26 }}>{s.t}</h2>
            <p style={{ margin: 0, opacity: 0.86, lineHeight: 1.7 }}>{s.body}</p>
          </section>
        ))}
        <section style={{ marginTop: 28, padding: 20, borderRadius: 18, border: "1px solid rgba(34,197,94,0.28)", background: "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))" }}>
          <h2 style={{ margin: "0 0 10px", fontSize: 22 }}>Calculate your trade size with MyStockHarbor</h2>
          <p style={{ margin: 0, opacity: 0.86, lineHeight: 1.6 }}>Use the MyStockHarbor risk calculator to estimate position size, stop loss risk and risk-reward before entering a trade.</p>
          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/utilities" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "13px 18px", borderRadius: 14, border: "1px solid rgba(168,85,247,0.42)", background: "linear-gradient(135deg, rgba(168,85,247,0.22), rgba(59,130,246,0.18))", color: "#f8fafc", textDecoration: "none", fontWeight: 900, minHeight: 48, whiteSpace: "nowrap" }}>Open the Risk Calculators →</Link>
          </div>
        </section>
      </div>
      <style>{`.wrap { max-width: 900px; margin: 0 auto; padding: 28px 20px 40px; } a:hover { filter: brightness(1.05); transform: translateY(-1px); }`}</style>
    </main>
  );
}
