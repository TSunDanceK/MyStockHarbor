import LearnShell from "@/app/learn/LearnShell";
import Link from "next/link";

export default function TradingRiskManagementPage() {
  return (
    <LearnShell activeHref="/trading-risk-management">
        <div style={{ maxWidth: 780 }}>
          <div style={{ display: "inline-flex", alignItems: "center", padding: "7px 12px", borderRadius: 999, background: "linear-gradient(135deg, rgba(34,197,94,0.20), rgba(16,185,129,0.10))", border: "1px solid rgba(34,197,94,0.34)", color: "#dcfce7", fontWeight: 950, letterSpacing: "0.08em", fontSize: 12 }}>RISK MANAGEMENT GUIDE</div>
          <h1 style={{ margin: "14px 0 0 0", fontSize: 42, lineHeight: 1.08, letterSpacing: "-0.6px" }}>Trading Risk Management for Beginners</h1>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>Risk management is the part of trading that protects your account when a trade does not work. Most beginners spend too much time looking for entries and not enough time deciding how much they can lose if they are wrong.</p>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>Good traders are not just trying to find winning trades. They are also trying to keep losses controlled, position sizes sensible, and risk consistent enough to survive over time.</p>
        </div>
        {[{n:"1",t:"What is trading risk management?",body:"Trading risk management is the process of controlling how much you could lose on any one trade or across a series of trades. It includes stop losses, position sizing, risk reward, and deciding how much of your capital is exposed at once."},{n:"2",t:"Why risk management matters more than beginners expect",body:"Even strong setups fail sometimes. A few oversized losses can undo many smaller wins. Consistent risk makes trading easier to evaluate. Protecting capital gives you more chances to improve."},{n:"3",t:"The basic building blocks",body:"Stop loss: defines where the trade is wrong and where losses should be limited. Position size: controls how large the trade should be based on your risk amount. Risk reward: helps compare whether the upside is attractive enough versus the downside."},{n:"4",t:"Why stop losses matter",body:"A stop loss gives structure to your downside. It tells you where the setup has failed and where the trade should be exited before damage becomes much larger."},{n:"5",t:"Why position sizing matters",body:"Position sizing decides how many shares or how much capital should go into a trade. A better approach is to decide your maximum acceptable dollar risk first, then size the trade according to the stop loss distance."},{n:"6",t:"Why risk reward matters",body:"Risk reward helps you compare the possible upside of a trade against the downside you are accepting. The key is to keep targets realistic."},{n:"7",t:"A simple beginner framework",body:"Start with chart structure and identify where the setup fails. Place the stop where the trade idea is clearly invalidated. Choose a fixed dollar amount you are willing to risk. Size the position from the stop distance, not from emotion. Check whether the reward justifies the risk before entering."}].map((s) => (
          <section key={s.n} style={{ marginTop: 24, border: "1px solid rgba(59,130,246,0.22)", borderRadius: 18, padding: 20 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 26 }}>{s.t}</h2>
            <p style={{ margin: 0, opacity: 0.86, lineHeight: 1.7 }}>{s.body}</p>
          </section>
        ))}
        <section style={{ marginTop: 28, padding: 20, borderRadius: 18, border: "1px solid rgba(59,130,246,0.28)", background: "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(168,85,247,0.08))" }}>
          <h2 style={{ margin: "0 0 10px", fontSize: 26 }}>Use MyStockHarbor to plan risk before entering a trade</h2>
          <p style={{ margin: 0, opacity: 0.86, lineHeight: 1.6 }}>The MyStockHarbor calculators can help you estimate position size, risk reward, and liquidation distance before taking a trade.</p>
          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/utilities" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "13px 18px", borderRadius: 14, border: "1px solid rgba(34,197,94,0.42)", background: "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.18))", color: "#f8fafc", textDecoration: "none", fontWeight: 900, minHeight: 48, whiteSpace: "nowrap" }}>Open the Calculators →</Link>
            <Link href="/position-sizing-guide" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "13px 18px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#f8fafc", textDecoration: "none", fontWeight: 900, minHeight: 48, whiteSpace: "nowrap" }}>Read Position Sizing Guide →</Link>
          </div>
        </section>
      </LearnShell>
  );
}
