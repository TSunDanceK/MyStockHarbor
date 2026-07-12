"use client";
import LearnShell from "@/app/learn/LearnShell";
import Link from "next/link";

export default function RiskRewardRatioPage() {
  return (
    <LearnShell activeHref="/risk-reward-ratio">
        <div style={{ maxWidth: 780 }}>
          <div style={{ display: "inline-flex", alignItems: "center", padding: "7px 12px", borderRadius: 999, background: "linear-gradient(135deg, rgba(234,179,8,0.20), rgba(202,138,4,0.10))", border: "1px solid rgba(234,179,8,0.34)", color: "#fef3c7", fontWeight: 950, letterSpacing: "0.08em", fontSize: 12 }}>RISK REWARD GUIDE</div>
          <h1 style={{ margin: "14px 0 0 0", fontSize: 42, lineHeight: 1.08, letterSpacing: "-0.6px" }}>Risk Reward Ratio Explained for Beginners</h1>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>Risk reward ratio compares how much you could lose on a trade with how much you could potentially make. Traders use it to judge whether a setup offers enough upside compared with the downside they are accepting.</p>
        </div>
        {[{n:"1",t:"What is risk reward ratio?",body:"Risk reward ratio measures the relationship between your potential loss and your potential gain on a trade. For example, if you are risking $2 per share to potentially make $6 per share, that is a 1:3 risk reward ratio."},{n:"2",t:"Why traders use risk reward",body:"It helps compare trade ideas more objectively. It encourages better planning before entry. It can improve long-term discipline. It helps avoid low-quality setups with poor upside."},{n:"3",t:"How to calculate risk reward ratio",body:"First, work out your entry price, stop loss, and target price. The distance from entry to stop is your risk. The distance from entry to target is your reward. Then divide reward by risk."},{n:"4",t:"What is considered good or bad?",body:"There is no single perfect number, but many traders prefer setups where reward is clearly larger than risk. Ratios such as 1:2 or 1:3 are often seen as more attractive than 1:1 or worse."},{n:"5",t:"Common mistakes with risk reward",body:"Using unrealistic profit targets just to make the ratio look better. Ignoring chart structure when placing stops and targets. Focusing only on the ratio and ignoring setup quality."},{n:"6",t:"How risk reward fits with stop losses",body:"Risk reward is most useful when paired with a clear stop loss and sensible position sizing. The stop defines the downside, the target defines the upside, and the position size keeps total account risk under control."}].map((s) => (
          <section key={s.n} style={{ marginTop: 24, border: "1px solid rgba(59,130,246,0.22)", borderRadius: 18, padding: 20 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 26 }}>{s.t}</h2>
            <p style={{ margin: 0, opacity: 0.86, lineHeight: 1.7 }}>{s.body}</p>
          </section>
        ))}
        <section style={{ marginTop: 28, padding: 20, borderRadius: 18, border: "1px solid rgba(34,197,94,0.28)", background: "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))" }}>
          <h2 style={{ margin: "0 0 10px", fontSize: 26 }}>Use MyStockHarbor to calculate risk reward</h2>
          <p style={{ margin: 0, opacity: 0.86, lineHeight: 1.6 }}>The MyStockHarbor calculators help you estimate risk reward, position size, and stop loss planning before committing capital.</p>
          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/utilities" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "13px 18px", borderRadius: 14, border: "1px solid rgba(168,85,247,0.42)", background: "linear-gradient(135deg, rgba(168,85,247,0.22), rgba(59,130,246,0.18))", color: "#f8fafc", textDecoration: "none", fontWeight: 900, minHeight: 48, whiteSpace: "nowrap" }}>Open the Risk Calculators →</Link>
            <Link href="/stop-loss-strategy" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "13px 18px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#f8fafc", textDecoration: "none", fontWeight: 900, minHeight: 48, whiteSpace: "nowrap" }}>Read Stop Loss Guide →</Link>
          </div>
        </section>
      </LearnShell>
  );
}
