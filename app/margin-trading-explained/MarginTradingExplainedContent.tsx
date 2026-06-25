"use client";
import Link from "next/link";

export default function MarginTradingExplainedPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#06080d", color: "#f1f5f9", fontFamily: "system-ui, Arial" }}>
      <div className="wrap">
        <div style={{ maxWidth: 780 }}>
          <div style={{ display: "inline-flex", alignItems: "center", padding: "7px 12px", borderRadius: 999, background: "linear-gradient(135deg, rgba(168,85,247,0.20), rgba(139,92,246,0.10))", border: "1px solid rgba(168,85,247,0.34)", color: "#f3e8ff", fontWeight: 950, letterSpacing: "0.08em", fontSize: 12 }}>MARGIN TRADING GUIDE</div>
          <h1 style={{ margin: "14px 0 0 0", fontSize: 42, lineHeight: 1.08, letterSpacing: "-0.6px" }}>Margin Trading Explained for Beginners</h1>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>Margin trading allows traders to control a larger position than their own cash would normally allow. It can increase gains when a trade works, but it also increases losses when price moves the wrong way.</p>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>That is why margin should never be treated as free extra buying power. It is borrowed exposure, which means risk builds faster, liquidation can become a real issue, and small mistakes can do far more damage than beginners expect.</p>
        </div>
        <section style={{ marginTop: 24, padding: 20, borderRadius: 18, border: "1px solid rgba(168,85,247,0.28)", background: "linear-gradient(135deg, rgba(168,85,247,0.14), rgba(59,130,246,0.08))" }}>
          <div style={{ marginTop: 12, fontSize: 28, fontWeight: 950 }}>Margin makes your position bigger. It also makes your risk bigger.</div>
        </section>
        {[{n:"1",t:"What is margin trading?",body:"Margin trading means borrowing funds from a broker so you can open a larger trade than your own capital would normally allow. For example, 2x leverage means you can control roughly twice as much position value as your own committed capital."},{n:"2",t:"How leverage works",body:"Leverage increases exposure. If you have $1,000 and use 2x leverage, you may be able to control a $2,000 position. If the trade rises, gains on your own capital are amplified. If it falls, losses are amplified too."},{n:"3",t:"Why margin trading is riskier",body:"Losses increase faster because the position is larger. A smaller move against you can cause meaningful damage. Liquidation risk becomes part of trade planning. Emotion usually gets worse when leverage is involved."},{n:"4",t:"What is liquidation?",body:"Liquidation is when a broker forces a position to close because the trade has moved too far against you and there is no longer enough margin to support it."},{n:"5",t:"Common beginner mistakes",body:"Using leverage before learning basic risk management. Trading too large because the broker allows it. Ignoring liquidation distance. Treating borrowed buying power as if it were their own cash."},{n:"6",t:"A better beginner approach",body:"Beginners are usually better off learning chart structure, stop placement, and position sizing before using margin. Margin should sit on top of a solid risk framework, not replace one."}].map((s) => (
          <section key={s.n} style={{ marginTop: 24, border: "1px solid rgba(59,130,246,0.22)", borderRadius: 18, padding: 20 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 26 }}>{s.t}</h2>
            <p style={{ margin: 0, opacity: 0.86, lineHeight: 1.7 }}>{s.body}</p>
          </section>
        ))}
        <section style={{ marginTop: 28, padding: 20, borderRadius: 18, border: "1px solid rgba(34,197,94,0.28)", background: "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))" }}>
          <h2 style={{ margin: "0 0 10px", fontSize: 26 }}>Use MyStockHarbor to estimate liquidation risk</h2>
          <p style={{ margin: 0, opacity: 0.86, lineHeight: 1.6 }}>The MyStockHarbor margin calculator helps you estimate liquidation price and distance so you can think more clearly about risk before opening a leveraged trade.</p>
          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/utilities" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "13px 18px", borderRadius: 14, border: "1px solid rgba(168,85,247,0.42)", background: "linear-gradient(135deg, rgba(168,85,247,0.22), rgba(59,130,246,0.18))", color: "#f8fafc", textDecoration: "none", fontWeight: 900, minHeight: 48, whiteSpace: "nowrap" }}>Open the Margin Calculator →</Link>
            <Link href="/risk-reward-ratio" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "13px 18px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#f8fafc", textDecoration: "none", fontWeight: 900, minHeight: 48, whiteSpace: "nowrap" }}>Read Risk Reward Guide →</Link>
          </div>
        </section>
      </div>
      <style>{`.wrap { max-width: 900px; margin: 0 auto; padding: 28px 20px 40px; } a:hover { filter: brightness(1.05); transform: translateY(-1px); } @media (max-width: 760px) { .wrap { padding: 18px 16px 34px !important; } }`}</style>
    </main>
  );
}
