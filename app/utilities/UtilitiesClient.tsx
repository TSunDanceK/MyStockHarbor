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
        flex: "0 0 auto",
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((v) => !v)}
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
            backgroundColor: "#0f172a",
            border: "1px solid rgba(255,255,255,0.14)",
            fontSize: 12,
            lineHeight: 1.5,
            fontWeight: 600,
            color: "#f1f5f9",
            zIndex: 50,
            boxShadow: "0 10px 24px rgba(0,0,0,0.45)",
            opacity: 1,
            pointerEvents: "none",
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

function baseResultBoxStyle(): React.CSSProperties {
  return {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    padding: 14,
  };
}

function labelStyle(): React.CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 850,
    color: "rgba(241,245,249,0.85)",
    marginBottom: 6,
    display: "flex",
    alignItems: "center",
    gap: 2,
    flexWrap: "wrap",
  };
}

function resultLabelStyle(): React.CSSProperties {
  return {
    fontSize: 12,
    color: "rgba(241,245,249,0.75)",
    fontWeight: 850,
    display: "flex",
    alignItems: "center",
    gap: 2,
    flexWrap: "wrap",
  };
}

function guideCardStyle(): React.CSSProperties {
  return {
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 14,
    padding: 14,
    background: "rgba(255,255,255,0.04)",
    color: "#f1f5f9",
    textDecoration: "none",
    display: "block",
  };
}

function infoSectionStyle(): React.CSSProperties {
  return {
    marginTop: 24,
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 18,
    padding: 18,
    background: "rgba(255,255,255,0.03)",
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

function getLiquidationColor(distance: number | null) {
  if (distance == null || !Number.isFinite(distance)) return "neutral";
  if (distance >= 50) return "green";
  if (distance >= 31) return "yellow";
  return "red";
}

function getRRColor(rr: number | null) {
  if (rr == null || !Number.isFinite(rr)) return "neutral";
  if (rr >= 2.5) return "green";
  if (rr >= 1.5) return "yellow";
  return "red";
}

function tintBox(type: "neutral" | "green" | "yellow" | "red", emphasize = false): React.CSSProperties {
  const base = baseResultBoxStyle();

  if (type === "green") {
    return {
      ...base,
      border: "1px solid rgba(34,197,94,0.32)",
      background: "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(255,255,255,0.04))",
      boxShadow: emphasize ? "0 0 0 1px rgba(34,197,94,0.10) inset" : "none",
    };
  }

  if (type === "yellow") {
    return {
      ...base,
      border: "1px solid rgba(234,179,8,0.32)",
      background: "linear-gradient(135deg, rgba(234,179,8,0.12), rgba(255,255,255,0.04))",
    };
  }

  if (type === "red") {
    return {
      ...base,
      border: "1px solid rgba(239,68,68,0.34)",
      background: "linear-gradient(135deg, rgba(239,68,68,0.14), rgba(255,255,255,0.04))",
    };
  }

  return base;
}

export default function UtilitiesClientPage() {
  const [marginSide, setMarginSide] = useState<"long" | "short">("long");
  const [marginEntry, setMarginEntry] = useState("100");
  const [marginPositionSize, setMarginPositionSize] = useState("100");
  const [marginLeverage, setMarginLeverage] = useState("2");

  const [riskAmount, setRiskAmount] = useState("100");
  const [riskEntry, setRiskEntry] = useState("100");
  const [riskStop, setRiskStop] = useState("90");
  const [riskTarget, setRiskTarget] = useState("110");

  const marginCalc = useMemo(() => {
    const entry = toNum(marginEntry);
    const positionSize = toNum(marginPositionSize);
    const leverage = toNum(marginLeverage);

    if (
      !Number.isFinite(entry) ||
      !Number.isFinite(positionSize) ||
      !Number.isFinite(leverage) ||
      entry <= 0 ||
      positionSize <= 0 ||
      leverage <= 0
    ) {
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

    const marginUsed = positionSize / leverage;
    const moveAgainstYou = marginUsed / qty;

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
  }, [marginEntry, marginPositionSize, marginLeverage, marginSide]);

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

  const liquidationColor = getLiquidationColor(marginCalc.distancePct) as "neutral" | "green" | "yellow" | "red";
  const rrColor = getRRColor(riskCalc.rr) as "neutral" | "green" | "yellow" | "red";

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

  <Link href="/pickers" style={topBtn()}>
    Find Stocks →
  </Link>

  <Link href="/learn" style={topBtn()}>
    Learn →
  </Link>
</div>
        </div>

        <section style={infoSectionStyle()}>
          <h2 style={{ margin: 0, fontSize: 24, lineHeight: 1.2 }}>
            Free trading calculators for risk management
          </h2>

          <p style={{ margin: "10px 0 0", opacity: 0.84, lineHeight: 1.7, maxWidth: 980 }}>
            These trading calculators are designed to help you manage risk before you enter a position. Use the
            liquidation calculator to estimate where leverage could become dangerous, and use the position size
            calculator to work out how many shares fit your stop loss and risk amount.
          </p>

          <p style={{ margin: "10px 0 0", opacity: 0.84, lineHeight: 1.7, maxWidth: 980 }}>
            Traders often focus too much on entries and not enough on downside control. These tools help you plan trade
            size, stop distance and risk-reward more clearly before putting capital at risk.
          </p>
        </section>

        <div style={{ marginTop: 22 }} className="grid2">
          <section
<section
  style={{
    border: "1px solid rgba(59,130,246,0.35)",
    borderRadius: 18,
    padding: 18,
    background:
      "linear-gradient(135deg, rgba(59,130,246,0.16), rgba(15,23,42,0.92))",
    boxShadow: "0 0 0 1px rgba(59,130,246,0.10) inset",
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
                <div style={labelStyle()}>
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
                <div style={labelStyle()}>
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
                <div style={labelStyle()}>
                  Position Size ($)
                  <HelpTip text="Total dollar value of the trade. Example: buying $100 worth of stock." />
                </div>
                <input
                  value={marginPositionSize}
                  onChange={(e) => setMarginPositionSize(e.target.value)}
                  style={inputStyle()}
                />
              </div>

              <div>
                <div style={labelStyle()}>
                  Leverage
                  <HelpTip text="How much borrowed money is used. 2× leverage means you control double your capital." />
                </div>
                <input
                  value={marginLeverage}
                  onChange={(e) => setMarginLeverage(e.target.value)}
                  style={inputStyle()}
                />
              </div>
            </div>

            <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
              <div style={tintBox(liquidationColor)}>
                <div style={resultLabelStyle()}>
                  Liquidation Price
                  <HelpTip text="Estimated liquidation price only. Some brokers may calculate liquidation differently." />
                  {liquidationColor === "red" ? (
                    <span style={{ marginLeft: "auto", color: "#ef4444", fontWeight: 900 }}>⚠</span>
                  ) : null}
                </div>
                <div style={{ marginTop: 6, fontSize: 24, fontWeight: 950 }}>
                  {fmtMoney(marginCalc.liquidationPrice)}
                </div>
              </div>

              <div style={tintBox(liquidationColor)}>
                <div style={resultLabelStyle()}>
                  Distance to Liquidation
                  <HelpTip text="Shows how far price can move against your trade before estimated liquidation. Some brokers may calculate liquidation differently." />
                  {liquidationColor === "red" ? (
                    <span style={{ marginLeft: "auto", color: "#ef4444", fontWeight: 900 }}>⚠</span>
                  ) : null}
                </div>
                <div style={{ marginTop: 6, fontSize: 24, fontWeight: 950 }}>
                  {fmtPct(marginCalc.distancePct)}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 18, ...baseResultBoxStyle() }}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>What this tool does</div>
              <div style={{ opacity: 0.84, lineHeight: 1.6 }}>
                This calculator estimates the price at which your broker could automatically close your position due to
                insufficient margin.
              </div>
            </div>

            <div style={{ marginTop: 14, ...baseResultBoxStyle() }}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Why it matters</div>
              <div style={{ opacity: 0.84, lineHeight: 1.6 }}>
                If you use leverage without understanding liquidation, even a relatively small move against your trade
                can cause forced selling. This tool helps you understand how close danger may be before entering a
                trade.
              </div>
            </div>
          </section>

<section
  style={{
    border: "1px solid rgba(59,130,246,0.35)",
    borderRadius: 18,
    padding: 18,
    background:
      "linear-gradient(135deg, rgba(59,130,246,0.16), rgba(15,23,42,0.92))",
    boxShadow: "0 0 0 1px rgba(59,130,246,0.10) inset",
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
                <div style={labelStyle()}>
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
                <div style={labelStyle()}>
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
                <div style={labelStyle()}>
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
                <div style={labelStyle()}>
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
              <div style={baseResultBoxStyle()}>
                <div style={resultLabelStyle()}>Max Shares</div>
                <div style={{ marginTop: 6, fontSize: 24, fontWeight: 950 }}>
                  {fmtNum(riskCalc.shares)}
                </div>
              </div>

              <div style={tintBox("green", true)}>
                <div style={resultLabelStyle()}>
                  Total Position Size
                  <HelpTip text="This is the suggested trade size based on your chosen risk amount and stop loss distance." />
                </div>
                <div style={{ marginTop: 6, fontSize: 24, fontWeight: 950 }}>
                  {fmtMoney(riskCalc.positionSize)}
                </div>
              </div>

              <div style={baseResultBoxStyle()}>
                <div style={resultLabelStyle()}>Dollar Risk</div>
                <div style={{ marginTop: 6, fontSize: 24, fontWeight: 950 }}>
                  {fmtMoney(riskCalc.dollarRisk)}
                </div>
              </div>

              <div style={tintBox(rrColor)}>
                <div style={resultLabelStyle()}>
                  Risk / Reward
                  <HelpTip text="Compares your potential reward to your potential loss. Higher is usually better." />
                  {rrColor === "red" ? (
                    <span style={{ marginLeft: "auto", color: "#ef4444", fontWeight: 900 }}>⚠</span>
                  ) : null}
                </div>
                <div style={{ marginTop: 6, fontSize: 24, fontWeight: 950 }}>
                  {riskCalc.rr == null ? "—" : `1 : ${riskCalc.rr.toFixed(2)}`}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 18, ...baseResultBoxStyle() }}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>What this tool does</div>
              <div style={{ opacity: 0.84, lineHeight: 1.6 }}>
                This calculator helps you decide how many shares to buy based on the amount you are prepared to lose if
                your stop loss is hit.
              </div>
            </div>

            <div style={{ marginTop: 14, ...baseResultBoxStyle() }}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Why it matters</div>
              <div style={{ opacity: 0.84, lineHeight: 1.6 }}>
                Good traders control their risk before entering a trade. Position sizing helps prevent one bad trade
                from doing serious damage to your account and keeps your trading more disciplined over time.
              </div>
            </div>
          </section>
        </div>

        <section style={infoSectionStyle()}>
          <h2 style={{ margin: 0, fontSize: 24, lineHeight: 1.2 }}>
            Related trading guides
          </h2>

          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            <Link href="/how-to-read-stock-charts" style={guideCardStyle()}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>How to Read Stock Charts</div>
              <div style={{ marginTop: 6, opacity: 0.76, lineHeight: 1.55, fontSize: 13 }}>
                Learn the chart basics before using stop losses and trade planning tools.
              </div>
            </Link>

            <Link href="/best-indicators-for-swing-trading" style={guideCardStyle()}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>Best Indicators for Swing Trading</div>
              <div style={{ marginTop: 6, opacity: 0.76, lineHeight: 1.55, fontSize: 13 }}>
                See how traders combine indicators with risk planning and position sizing.
              </div>
            </Link>

            <Link href="/how-to-analyse-stocks" style={guideCardStyle()}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>How to Analyse Stocks</div>
              <div style={{ marginTop: 6, opacity: 0.76, lineHeight: 1.55, fontSize: 13 }}>
                Understand the wider process of reviewing stocks before entering trades.
              </div>
            </Link>

            <Link href="/pickers" style={guideCardStyle()}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>Find Stock Ideas</div>
              <div style={{ marginTop: 6, opacity: 0.76, lineHeight: 1.55, fontSize: 13 }}>
                Use the stock pickers to find setups, then come back here to plan risk properly.
              </div>
            </Link>
          </div>
        </section>

        <section style={infoSectionStyle()}>
          <h2 style={{ margin: 0, fontSize: 24, lineHeight: 1.2 }}>
            FAQ
          </h2>

          <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                What is a liquidation calculator?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.82 }}>
                A liquidation calculator estimates the price where a leveraged position may be forcibly closed if price
                moves too far against you.
              </p>
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                What is a position size calculator?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.82 }}>
                A position size calculator helps you work out how many shares to buy based on your entry, stop loss and
                maximum acceptable dollar risk.
              </p>
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                Why does risk-reward matter?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.82 }}>
                Risk-reward helps traders compare the possible upside of a trade with the downside they are accepting.
                It is one of the basic ways to judge whether a setup is worth taking.
              </p>
            </div>
          </div>
        </section>
      </div>

      <style jsx>{`
        .wrap {
          max-width: 1180px;
          margin: 0 auto;
          padding: 24px;
        }

        .grid2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        @media (max-width: 900px) {
          .grid2 {
            grid-template-columns: 1fr !important;
          }
        }

        @media (max-width: 760px) {
          .wrap {
            padding: 16px !important;
          }
        }
      `}</style>
    </main>
  );
}
