"use client";
import Link from "next/link";

export default function StopLossStrategyPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#06080d", color: "#f1f5f9", fontFamily: "system-ui, Arial" }}>
      <div className="wrap">
        <div style={{ maxWidth: 780 }}>
          <div style={{ display: "inline-flex", alignItems: "center", padding: "7px 12px", borderRadius: 999, background: "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(127,29,29,0.10))", border: "1px solid rgba(239,68,68,0.34)", color: "#fee2e2", fontWeight: 950, letterSpacing: "0.08em", fontSize: 12 }}>STOP LOSS GUIDE</div>
          <h1 style={{ margin: "14px 0 0 0", fontSize: 42, lineHeight: 1.08, letterSpacing: "-0.6px" }}>Stop Loss Strategy for Beginners</h1>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>A stop loss is one of the simplest risk management tools in trading. It helps you define where you will exit a trade if price moves against you, rather than hoping the market turns around.</p>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>Many beginners spend too much time thinking about entry and not enough time planning the downside. A good stop loss strategy helps protect capital, reduce emotional decision making, and keep losses controlled.</p>
        </div>
        {[{n:"1",t:"What is a stop loss?",body:"A stop loss is a predefined exit level used to limit risk if a trade moves the wrong way. In practical terms, a stop loss is the level where you accept that the trade is not behaving as expected and you want to protect your account from larger damage."},{n:"2",t:"Why stop losses matter",body:"They protect capital from large unexpected losses. They help traders stay disciplined under pressure. They make position sizing possible. They reduce emotional decision making after entry."},{n:"3",t:"Where traders place stop losses",body:"Traders usually place stop losses at levels where the setup would no longer make sense — below support, below a recent swing low, above resistance on a short trade, or beyond a volatility-based level. The key idea is that the stop should reflect the structure of the chart."},{n:"4",t:"Common stop loss mistakes",body:"Placing stops too tight with no regard for normal volatility. Placing stops too far away and taking oversized risk. Moving stops further away once price moves against the trade. Using the same stop style for every stock and market condition."},{n:"5",t:"How stop losses connect to position sizing",body:"Stop losses and position sizing work together. Once you know where your stop loss is, you can work out how many shares fit your acceptable dollar risk. This is why stop placement comes before position size, not after."},{n:"6",t:"A simple beginner approach",body:"Before entering a trade, ask yourself: where would this setup be clearly wrong? That level is often a better stop loss candidate than a random percentage or emotional guess. Then calculate position size so that the loss stays small and manageable if the stop is hit."}].map((s) => (
          <section key={s.n} style={{ marginTop: 24, border: "1px solid rgba(59,130,246,0.22)", borderRadius: 18, padding: 20 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 26 }}>{s.t}</h2>
            <p style={{ margin: 0, opacity: 0.86, lineHeight: 1.7 }}>{s.body}</p>
          </section>
        ))}
        <section style={{ marginTop: 28, padding: 20, borderRadius: 18, border: "1px solid rgba(34,197,94,0.28)", background: "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))" }}>
          <h2 style={{ margin: "0 0 10px", fontSize: 26 }}>Use MyStockHarbor to plan your stop loss and trade risk</h2>
          <p style={{ margin: 0, opacity: 0.86, lineHeight: 1.6 }}>The MyStockHarbor calculators help you work out position size, risk, and trade planning before you enter a setup.</p>
          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/utilities" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "13px 18px", borderRadius: 14, border: "1px solid rgba(168,85,247,0.42)", background: "linear-gradient(135deg, rgba(168,85,247,0.22), rgba(59,130,246,0.18))", color: "#f8fafc", textDecoration: "none", fontWeight: 900, minHeight: 48, whiteSpace: "nowrap" }}>Open the Risk Calculators →</Link>
            <Link href="/position-sizing-guide" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "13px 18px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#f8fafc", textDecoration: "none", fontWeight: 900, minHeight: 48, whiteSpace: "nowrap" }}>Read Position Sizing Guide →</Link>
          </div>
        </section>
      </div>
      <style>{`.wrap { max-width: 900px; margin: 0 auto; padding: 28px 20px 40px; } a:hover { filter: brightness(1.05); transform: translateY(-1px); } @media (max-width: 760px) { .wrap { padding: 18px 16px 34px !important; } }`}</style>
    </main>
  );
}
