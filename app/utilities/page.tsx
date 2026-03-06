"use client";

import Link from "next/link";
import React, { useMemo, useState } from "react";

function HelpTip({ text }: { text: string }) {
  const [open, setOpen] = React.useState(false);

  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 16,
        height: 16,
        borderRadius: "50%",
        background: "rgba(255,255,255,0.15)",
        color: "#fff",
        fontSize: 11,
        fontWeight: 900,
        cursor: "pointer",
        marginLeft: 6,
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen(!open)}
    >
      ?
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: 22,
            left: "50%",
            transform: "translateX(-50%)",
            width: 220,
            padding: 10,
            borderRadius: 10,
            background: "#0f172a",
            border: "1px solid rgba(255,255,255,0.14)",
            fontSize: 12,
            lineHeight: 1.5,
            fontWeight: 600,
            zIndex: 10,
          }}
        >
          {text}
        </div>
      )}
    </span>
  );
}

function topBtn(): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#f1f5f9",
    textDecoration: "none",
    fontWeight: 850,
    whiteSpace: "nowrap",
  };
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    height: 44,
    padding: "0 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#f1f5f9",
    outline: "none",
    fontSize: 14,
    fontWeight: 700,
    boxSizing: "border-box",
  };
}

function selectStyle(): React.CSSProperties {
  return {
    width: "100%",
    height: 44,
    padding: "0 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "#161b22",
    color: "#f1f5f9",
    outline: "none",
    fontSize: 14,
    fontWeight: 700,
    boxSizing: "border-box",
  };
}

function resultBoxStyle(): React.CSSProperties {
  return {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    padding: 14,
  };
}

function toNum(v: string) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function fmtMoney(v: number | null) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

function fmtPct(v: number | null) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}%`;
}

function fmtNum(v: number | null) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}`;
}

export default function UtilitiesPage() {
  const [marginSide, setMarginSide] = useState<"long" | "short">("long");
  const [marginEntry, setMarginEntry] = useState("1000");
  const [marginPositionSize, setMarginPositionSize] = useState("4000");
  const [marginLeverage, setMarginLeverage] = useState("2");
  const [marginMaintenance, setMarginMaintenance] = useState("25");

  const [riskAmount, setRiskAmount] = useState("100");
  const [riskEntry, setRiskEntry] = useState("4000");
  const [riskStop, setRiskStop] = useState("3900");
  const [riskTarget, setRiskTarget] = useState("4300");

  const marginCalc = useMemo(() => {
    const entry = toNum(marginEntry);
    const positionSize = toNum(marginPositionSize);
    const leverage = toNum(marginLeverage);
    const maintenancePct = toNum(marginMaintenance);

    if (
      !Number.isFinite(entry) ||
      !Number.isFinite(positionSize) ||
      !Number.isFinite(leverage) ||
      !Number.isFinite(maintenancePct) ||
      entry <= 0 ||
      positionSize <= 0 ||
      leverage <= 0 ||
      maintenancePct < 0
    ) {
      return {
        liquidationPrice: null as number | null,
        distancePct: null as number | null,
      };
    }

    const marginUsed = positionSize / leverage;
    const maintenanceRequirement = positionSize * (maintenancePct / 100);
    const maxLossBeforeLiquidation = marginUsed - maintenanceRequirement;

    if (maxLossBeforeLiquidation <= 0) {
      return {
        liquidationPrice: null as number | null,
        distancePct: null as number | null,
      };
    }

    const qty = positionSize / entry;
    if (!Number.isFinite(qty) || qty <= 0) {
      return {
        liquidationPrice: null as number | null,
        distancePct: null as number | null,
      };
    }

    const moveAgainstYou = maxLossBeforeLiquidation / qty;

    let liquidationPrice: number;
    if (marginSide === "long") {
      liquidationPrice = entry - moveAgainstYou;
    } else {
      liquidationPrice = entry + moveAgainstYou;
    }

    if (!Number.isFinite(liquidationPrice) || liquidationPrice <= 0) {
      return {
        liquidationPrice: null as number | null,
        distancePct: null as number | null,
      };
    }

    const distancePct =
      marginSide === "long"
        ? ((entry - liquidationPrice) / entry) * 100
        : ((liquidationPrice - entry) / entry) * 100;

    return {
      liquidationPrice,
      distancePct,
    };
  }, [marginEntry, marginPositionSize, marginLeverage, marginMaintenance, marginSide]);

  const riskCalc = useMemo(() => {
    const risk = toNum(riskAmount);
    const entry = toNum(riskEntry);
    const stop = toNum(riskStop);
    const target = toNum(riskTarget);

    if (
      !Number.isFinite(risk) ||
      !Number.isFinite(entry) ||
      !Number.isFinite(stop) ||
      risk <= 0 ||
      entry <= 0 ||
      stop <= 0
    ) {
      return {
        shares: null as number | null,
        positionSize: null as number | null,
        dollarRisk: null as number | null,
        rr: null as number | null,
      };
    }

    const riskPerShare = Math.abs(entry - stop);
    if (!Number.isFinite(riskPerShare) || riskPerShare <= 0) {
      return {
        shares: null as number | null,
        positionSize: null as number | null,
        dollarRisk: null as number | null,
        rr: null as number | null,
      };
    }

    const shares = risk / riskPerShare;
    const positionSize = shares * entry;
    const dollarRisk = shares * riskPerShare;

    let rr: number | null = null;
    if (Number.isFinite(target) && target > 0) {
      const rewardPerShare = Math.abs(target - entry);
      rr = rewardPerShare > 0 ? rewardPerShare / riskPerShare : null;
    }

    return {
      shares,
      positionSize,
      dollarRisk,
      rr,
    };
  }, [riskAmount, riskEntry, riskStop, riskTarget]);

  return (
    <main
      style={{
        padding: 0,
        fontFamily: "system-ui, Arial",
        background: "#06080d",
        color: "#f1f5f9",
        minHeight: "100vh",
      }}
    >
      <div className="wrap">
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 800 }}>
              TRADING UTILITIES
            </div>

            <h1 style={{ margin: "6px 0 0", fontSize: 34, letterSpacing: "-0.4px" }}>
              Risk Tools & Calculators
            </h1>

            <div style={{ marginTop: 8, opacity: 0.78, lineHeight: 1.55, maxWidth: 860 }}>
              Practical tools to help you manage risk, size positions properly, and avoid costly trading mistakes.
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/" style={topBtn()}>
              ← Dashboard
            </Link>
            <Link href="/learn" style={topBtn()}>
              Learn →
            </Link>
          </div>
        </div>

        <div style={{ marginTop: 22 }} className="grid2">
          {/* LEFT CARD */}
          <section
            style={{
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 18,
              padding: 18,
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                borderRadius: 999,
                background: "rgba(59,130,246,0.14)",
                border: "1px solid rgba(59,130,246,0.22)",
                fontSize: 12,
                fontWeight: 900,
                letterSpacing: "0.3px",
              }}
            >
              MARGIN TOOL
            </div>

            <h2 style={{ margin: "12px 0 0", fontSize: 28, letterSpacing: "-0.3px" }}>
              Margin / Liquidation Calculator
            </h2>

            <p style={{ margin: "10px 0 0", opacity: 0.84, lineHeight: 1.6 }}>
              Estimate where your trade could be liquidated if the market moves against you while using leverage.
            </p>

            <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 850, opacity: 0.85, marginBottom: 6 }}>
                  Trade Direction
                  <HelpTip text="Choose Long if you expect price to rise, Short if you expect price to fall." />
                </div>
                <select
                  value={marginSide}
                  onChange={(e) => setMarginSide(e.target.value as "long" | "short")}
                  style={selectStyle()}
                >
                  <option value="long">Long</option>
                  <option value="short">Short</option>
                </select>
              </div>

              <div>
                <div style={{ fontSize: 12, fontWeight: 850, opacity: 0.85, marginBottom: 6 }}>
                  Entry Price ($)
                  <HelpTip text="The price where you enter the trade." />
                </div>
                <input
                  value={marginEntry}
                  onChange={(e) => setMarginEntry(e.target.value)}
                  style={inputStyle()}
                />
              </div>

              <div>
                <div style={{ fontSize: 12, fontWeight: 850, opacity: 0.85, marginBottom: 6 }}>
                  Position Size ($)
                  <HelpTip text="Total dollar value of the trade. Example: buying $4000 worth of stock." />
                </div>
                <input
                  value={marginPositionSize}
                  onChange={(e) => setMarginPositionSize(e.target.value)}
                  style={inputStyle()}
                />
              </div>

              <div>
                <div style={{ fontSize: 12, fontWeight: 850, opacity: 0.85, marginBottom: 6 }}>
                  Leverage
                  <HelpTip text="How much borrowed money is used. 2× leverage means you control double your capital." />
                </div>
                <input
                  value={marginLeverage}
                  onChange={(e) => setMarginLeverage(e.target.value)}
                  style={inputStyle()}
                />
              </div>

              <div>
                <div style={{ fontSize: 12, fontWeight: 850, opacity: 0.85, marginBottom: 6 }}>
                  Maintenance Margin (%)
                  <HelpTip text="Minimum equity your broker requires to keep the trade open. Higher % means liquidation happens sooner." />
                </div>
                <input
                  value={marginMaintenance}
                  onChange={(e) => setMarginMaintenance(e.target.value)}
                  style={inputStyle()}
                />
              </div>
            </div>

            <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
              <div style={resultBoxStyle()}>
                <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 850 }}>Liquidation Price</div>
                <div style={{ marginTop: 6, fontSize: 24, fontWeight: 950 }}>
                  {fmtMoney(marginCalc.liquidationPrice)}
                </div>
              </div>

              <div style={resultBoxStyle()}>
                <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 850 }}>Distance to Liquidation</div>
                <div style={{ marginTop: 6, fontSize: 24, fontWeight: 950 }}>
                  {fmtPct(marginCalc.distancePct)}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 18, ...resultBoxStyle() }}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>What this tool does</div>
              <div style={{ opacity: 0.84, lineHeight: 1.6 }}>
                This calculator estimates the price at which your broker could automatically close your position due
                to insufficient margin.
              </div>
            </div>

            <div style={{ marginTop: 14, ...resultBoxStyle() }}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Why it matters</div>
              <div style={{ opacity: 0.84, lineHeight: 1.6 }}>
                If you use leverage without understanding liquidation, even a relatively small move against your trade
                can cause forced selling. This tool helps you understand how close danger may be before entering a trade.
              </div>
            </div>
          </section>

          {/* RIGHT CARD */}
          <section
            style={{
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 18,
              padding: 18,
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                borderRadius: 999,
                background: "rgba(34,197,94,0.14)",
                border: "1px solid rgba(34,197,94,0.22)",
                fontSize: 12,
                fontWeight: 900,
                letterSpacing: "0.3px",
              }}
            >
              RISK TOOL
            </div>

            <h2 style={{ margin: "12px 0 0", fontSize: 28, letterSpacing: "-0.3px" }}>
              Position Size / Stop Loss Calculator
            </h2>

            <p style={{ margin: "10px 0 0", opacity: 0.84, lineHeight: 1.6 }}>
              Work out how many shares you can buy while keeping your loss within a sensible risk limit.
            </p>

            <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 850, opacity: 0.85, marginBottom: 6 }}>
                  Risk Amount ($)
                  <HelpTip text="Maximum dollar amount you are willing to lose if your stop loss is hit." />
                </div>
                <input
                  value={riskAmount}
                  onChange={(e) => setRiskAmount(e.target.value)}
                  style={inputStyle()}
                />
              </div>

              <div>
                <div style={{ fontSize: 12, fontWeight: 850, opacity: 0.85, marginBottom: 6 }}>
                  Entry Price ($)
                  <HelpTip text="The price where you plan to enter the trade." />
                </div>
                <input
                  value={riskEntry}
                  onChange={(e) => setRiskEntry(e.target.value)}
                  style={inputStyle()}
                />
              </div>

              <div>
                <div style={{ fontSize: 12, fontWeight: 850, opacity: 0.85, marginBottom: 6 }}>
                  Stop Loss Price ($)
                  <HelpTip text="The price where you will exit the trade to limit losses." />
                </div>
                <input
                  value={riskStop}
                  onChange={(e) => setRiskStop(e.target.value)}
                  style={inputStyle()}
                />
              </div>

              <div>
                <div style={{ fontSize: 12, fontWeight: 850, opacity: 0.85, marginBottom: 6 }}>
                  Target Price ($)
                  <HelpTip text="Optional price where you plan to take profit." />
                </div>
                <input
                  value={riskTarget}
                  onChange={(e) => setRiskTarget(e.target.value)}
                  style={inputStyle()}
                />
              </div>
            </div>

            <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
              <div style={resultBoxStyle()}>
                <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 850 }}>Max Shares</div>
                <div style={{ marginTop: 6, fontSize: 24, fontWeight: 950 }}>
                  {fmtNum(riskCalc.shares)}
                </div>
              </div>

              <div style={resultBoxStyle()}>
                <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 850 }}>Total Position Size</div>
                <div style={{ marginTop: 6, fontSize: 24, fontWeight: 950 }}>
                  {fmtMoney(riskCalc.positionSize)}
                </div>
              </div>

              <div style={resultBoxStyle()}>
                <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 850 }}>Dollar Risk</div>
                <div style={{ marginTop: 6, fontSize: 24, fontWeight: 950 }}>
                  {fmtMoney(riskCalc.dollarRisk)}
                </div>
              </div>

              <div style={resultBoxStyle()}>
                <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 850 }}>Risk / Reward</div>
                <div style={{ marginTop: 6, fontSize: 24, fontWeight: 950 }}>
                  {riskCalc.rr == null ? "—" : `1 : ${riskCalc.rr.toFixed(2)}`}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 18, ...resultBoxStyle() }}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>What this tool does</div>
              <div style={{ opacity: 0.84, lineHeight: 1.6 }}>
                This calculator helps you decide how many shares to buy based on the amount you are prepared to lose if
                your stop loss is hit.
              </div>
            </div>

            <div style={{ marginTop: 14, ...resultBoxStyle() }}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Why it matters</div>
              <div style={{ opacity: 0.84, lineHeight: 1.6 }}>
                Good traders control their risk before entering a trade. Position sizing helps prevent one bad trade
                from doing serious damage to your account and keeps your trading more disciplined over time.
              </div>
            </div>
          </section>
        </div>
      </div>

      <style>{`
        .wrap { max-width: 1180px; margin: 0 auto; padding: 24px; }
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

        @media (max-width: 900px) {
          .grid2 { grid-template-columns: 1fr !important; }
        }

        @media (max-width: 760px) {
          .wrap { padding: 16px !important; }
        }
      `}</style>
    </main>
  );
}
