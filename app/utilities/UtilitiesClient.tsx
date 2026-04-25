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

function topNavBtnStyle(
  type: "learn" | "pickers" | "dashboard" | "platforms" | "utilities"
): React.CSSProperties {
  if (type === "dashboard") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 42,
      padding: "9px 13px",
      borderRadius: 14,
      border: "1px solid rgba(250,204,21,0.45)",
      background:
        "linear-gradient(135deg, rgba(250,204,21,0.20), rgba(202,138,4,0.10))",
      color: "#fefce8",
      textDecoration: "none",
      fontWeight: 900,
      fontSize: 14,
      whiteSpace: "nowrap",
      boxShadow: "0 8px 18px rgba(0,0,0,0.20)",
      transition:
        "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, filter 120ms ease",
    };
  }

  if (type === "pickers") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 42,
      padding: "9px 13px",
      borderRadius: 14,
      border: "1px solid rgba(239,68,68,0.45)",
      background:
        "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(127,29,29,0.10))",
      color: "#fef2f2",
      textDecoration: "none",
      fontWeight: 900,
      fontSize: 14,
      whiteSpace: "nowrap",
      boxShadow: "0 8px 18px rgba(0,0,0,0.20)",
      transition:
        "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, filter 120ms ease",
    };
  }

  if (type === "platforms") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 42,
      padding: "9px 13px",
      borderRadius: 14,
      border: "1px solid rgba(34,197,94,0.45)",
      background:
        "linear-gradient(135deg, rgba(34,197,94,0.20), rgba(16,185,129,0.10))",
      color: "#f0fdf4",
      textDecoration: "none",
      fontWeight: 900,
      fontSize: 14,
      whiteSpace: "nowrap",
      boxShadow: "0 8px 18px rgba(0,0,0,0.20)",
      transition:
        "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, filter 120ms ease",
    };
  }

  if (type === "utilities") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 42,
      padding: "9px 13px",
      borderRadius: 14,
      border: "1px solid rgba(168,85,247,0.48)",
      background:
        "linear-gradient(135deg, rgba(168,85,247,0.22), rgba(91,33,182,0.12))",
      color: "#faf5ff",
      textDecoration: "none",
      fontWeight: 900,
      fontSize: 14,
      whiteSpace: "nowrap",
      boxShadow: "0 8px 18px rgba(0,0,0,0.20)",
      transition:
        "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, filter 120ms ease",
    };
  }

  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 42,
    padding: "9px 13px",
    borderRadius: 14,
    border: "1px solid rgba(59,130,246,0.45)",
    background:
      "linear-gradient(135deg, rgba(59,130,246,0.20), rgba(37,99,235,0.10))",
    color: "#f1f5f9",
    textDecoration: "none",
    fontWeight: 900,
    fontSize: 14,
    whiteSpace: "nowrap",
    boxShadow: "0 8px 18px rgba(0,0,0,0.20)",
    transition:
      "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, filter 120ms ease",
  };
}

function topNavIcon(
  type: "learn" | "pickers" | "dashboard" | "platforms" | "utilities"
) {
  if (type === "learn") return "📘";
  if (type === "pickers") return "📊";
  if (type === "dashboard") return "📈";
  if (type === "utilities") return "🧮";
  return "🏦";
}

function calculatorPanelStyle(): React.CSSProperties {
  return {
    border: "1px solid rgba(59,130,246,0.24)",
    borderRadius: 20,
    padding: 18,
    background:
      "linear-gradient(180deg, rgba(8,22,45,0.94), rgba(7,18,36,0.98))",
    boxShadow:
      "0 16px 34px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,255,255,0.05)",
  };
}

function badgeStyle(type: "blue" | "green"): React.CSSProperties {
  if (type === "green") {
    return {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 10px",
      borderRadius: 999,
      background: "#0f2c24",
      border: "1px solid rgba(34,197,94,0.24)",
      fontSize: 12,
      fontWeight: 900,
      letterSpacing: "0.3px",
      color: "#f8fafc",
    };
  }

  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    background: "#102a52",
    border: "1px solid rgba(59,130,246,0.24)",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: "0.3px",
    color: "#f8fafc",
  };
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    height: 44,
    padding: "0 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "#1a2742",
    color: "#f8fafc",
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
    padding: "0 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "#1a2742",
    color: "#f8fafc",
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
    background: "linear-gradient(135deg, rgba(19,35,59,0.96), rgba(15,23,42,0.92))",
    padding: 14,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.045)",
  };
}

function infoCardStyle(): React.CSSProperties {
  return {
    borderRadius: 14,
    border: "1px solid rgba(59,130,246,0.18)",
    background: "linear-gradient(135deg, rgba(59,130,246,0.08), rgba(19,35,59,0.94))",
    padding: 14,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  };
}

function labelStyle(): React.CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 850,
    color: "rgba(241,245,249,0.90)",
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
    color: "rgba(241,245,249,0.82)",
    fontWeight: 850,
    display: "flex",
    alignItems: "center",
    gap: 2,
    flexWrap: "wrap",
  };
}

function guideCardStyle(): React.CSSProperties {
  return {
    border: "1px solid rgba(59,130,246,0.20)",
    borderRadius: 16,
    padding: 15,
    background:
      "linear-gradient(135deg, rgba(59,130,246,0.09), rgba(255,255,255,0.035))",
    color: "#f1f5f9",
    textDecoration: "none",
    display: "block",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.045)",
  };
}

function infoSectionStyle(): React.CSSProperties {
  return {
    marginTop: 24,
    border: "1px solid rgba(59,130,246,0.18)",
    borderRadius: 20,
    padding: 18,
    background: "linear-gradient(135deg, rgba(59,130,246,0.07), rgba(255,255,255,0.03))",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.045)",
  };
}

function sectionEyebrowStyle(type: "blue" | "green" | "red" | "yellow"): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    fontWeight: 950,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color:
      type === "green"
        ? "#86efac"
        : type === "red"
        ? "#fca5a5"
        : type === "yellow"
        ? "#fde68a"
        : "#93c5fd",
  };
}

function utilityIconStyle(type: "blue" | "green" | "red" | "yellow"): React.CSSProperties {
  return {
    width: 42,
    height: 42,
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
    fontSize: 21,
    background:
      type === "green"
        ? "rgba(34,197,94,0.18)"
        : type === "red"
        ? "rgba(239,68,68,0.18)"
        : type === "yellow"
        ? "rgba(250,204,21,0.18)"
        : "rgba(59,130,246,0.18)",
    border:
      type === "green"
        ? "1px solid rgba(34,197,94,0.34)"
        : type === "red"
        ? "1px solid rgba(239,68,68,0.34)"
        : type === "yellow"
        ? "1px solid rgba(250,204,21,0.34)"
        : "1px solid rgba(59,130,246,0.34)",
    boxShadow:
      type === "green"
        ? "0 0 18px rgba(34,197,94,0.16)"
        : type === "red"
        ? "0 0 18px rgba(239,68,68,0.16)"
        : type === "yellow"
        ? "0 0 18px rgba(250,204,21,0.16)"
        : "0 0 18px rgba(59,130,246,0.16)",
  };
}

function calloutCardStyle(type: "blue" | "green" | "red" | "yellow"): React.CSSProperties {
  return {
    borderRadius: 16,
    border:
      type === "green"
        ? "1px solid rgba(34,197,94,0.24)"
        : type === "red"
        ? "1px solid rgba(239,68,68,0.24)"
        : type === "yellow"
        ? "1px solid rgba(250,204,21,0.24)"
        : "1px solid rgba(59,130,246,0.24)",
    background:
      type === "green"
        ? "linear-gradient(135deg, rgba(34,197,94,0.10), rgba(255,255,255,0.035))"
        : type === "red"
        ? "linear-gradient(135deg, rgba(239,68,68,0.10), rgba(255,255,255,0.035))"
        : type === "yellow"
        ? "linear-gradient(135deg, rgba(250,204,21,0.12), rgba(255,255,255,0.035))"
        : "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(255,255,255,0.035))",
    padding: 16,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.045)",
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

function tintBox(
  type: "neutral" | "green" | "yellow" | "red",
  emphasize = false
): React.CSSProperties {
  const base = baseResultBoxStyle();

  if (type === "green") {
    return {
      ...base,
      border: "1px solid rgba(34,197,94,0.44)",
      background: "linear-gradient(135deg, rgba(11,61,44,0.95), #13233b)",
      boxShadow: emphasize ? "0 0 0 1px rgba(34,197,94,0.10) inset" : "none",
    };
  }

  if (type === "yellow") {
    return {
      ...base,
      border: "1px solid rgba(234,179,8,0.42)",
      background: "linear-gradient(135deg, rgba(78,56,12,0.95), #13233b)",
    };
  }

  if (type === "red") {
    return {
      ...base,
      border: "1px solid rgba(239,68,68,0.46)",
      background: "linear-gradient(135deg, rgba(83,22,22,0.95), #13233b)",
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

  const liquidationColor = getLiquidationColor(marginCalc.distancePct) as
    | "neutral"
    | "green"
    | "yellow"
    | "red";

  const rrColor = getRRColor(riskCalc.rr) as
    | "neutral"
    | "green"
    | "yellow"
    | "red";

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
        <div style={{ display: "grid", gap: 14 }}>
          <div className="topNavRow">
            <Link
              href="/"
              style={topNavBtnStyle("dashboard")}
              className="topNavBtn mobileIconOnly dashboardIconOnlyBtn"
              aria-label="Dashboard"
            >
              <span
                aria-hidden="true"
                style={{
                  fontSize: 15,
                  lineHeight: 1,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {topNavIcon("dashboard")}
              </span>
              <span className="topNavLabel dashboardLabel">Dashboard</span>
            </Link>

            <Link
              href="/platforms"
              style={topNavBtnStyle("platforms")}
              className="topNavBtn mobileTextBtn"
            >
              <span
                aria-hidden="true"
                style={{
                  fontSize: 15,
                  lineHeight: 1,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {topNavIcon("platforms")}
              </span>
              <span className="topNavLabel">Platforms</span>
            </Link>

            <Link
              href="/pickers"
              style={topNavBtnStyle("pickers")}
              className="topNavBtn mobileTextBtn"
            >
              <span
                aria-hidden="true"
                style={{
                  fontSize: 15,
                  lineHeight: 1,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {topNavIcon("pickers")}
              </span>
              <span className="topNavLabel">Pickers</span>
            </Link>

            <Link
              href="/learn"
              style={topNavBtnStyle("learn")}
              className="topNavBtn mobileIconOnly learnIconOnlyBtn"
              aria-label="Learn"
            >
              <span
                aria-hidden="true"
                style={{
                  fontSize: 15,
                  lineHeight: 1,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {topNavIcon("learn")}
              </span>
              <span className="topNavLabel learnLabel">Learn</span>
            </Link>
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 800 }}>
              TRADING UTILITIES
            </div>

            <h1
              style={{
                margin: "6px 0 0",
                fontSize: 34,
                letterSpacing: "-0.4px",
              }}
            >
              Risk Tools & Calculators
            </h1>

            <div
              style={{
                marginTop: 8,
                opacity: 0.78,
                lineHeight: 1.55,
                maxWidth: 860,
              }}
            >
              Practical tools to help you manage risk, size positions properly,
              and avoid costly trading mistakes.
            </div>
          </div>
        </div>

        <section style={infoSectionStyle()} className="mobileHideIntroSection">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            <div style={utilityIconStyle("blue")}>🧮</div>
            <div>
              <div style={sectionEyebrowStyle("blue")}>Trading calculators</div>
              <h2 style={{ margin: "8px 0 0", fontSize: 24, lineHeight: 1.2 }}>
                Free trading calculators for risk management
              </h2>

              <p
                style={{
                  margin: "10px 0 0",
                  opacity: 0.84,
                  lineHeight: 1.7,
                  maxWidth: 980,
                }}
              >
                These trading calculators are designed to help you manage risk before
                you enter a position. Use the liquidation calculator to estimate
                where leverage could become dangerous, and use the position size
                calculator to work out how many shares fit your stop loss and risk
                amount.
              </p>

              <p
                style={{
                  margin: "10px 0 0",
                  opacity: 0.84,
                  lineHeight: 1.7,
                  maxWidth: 980,
                }}
              >
                Traders often focus too much on entries and not enough on downside
                control. These tools help you plan trade size, stop distance and
                risk-reward more clearly before putting capital at risk.
              </p>
            </div>
          </div>
        </section>

        <div style={{ marginTop: 22 }} className="grid2">
          <section style={calculatorPanelStyle()}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={utilityIconStyle("blue")}>🧊</div>
              <div>
                <div style={badgeStyle("blue")}>MARGIN TOOL</div>

                <h2
                  style={{
                    margin: "12px 0 0",
                    fontSize: 28,
                    letterSpacing: "-0.3px",
                  }}
                >
                  Margin / Liquidation Calculator
                </h2>

                <p style={{ margin: "10px 0 0", opacity: 0.84, lineHeight: 1.6 }}>
                  Estimate where your trade could be liquidated if the market moves
                  against you while using leverage.
                </p>
              </div>
            </div>

            <div className="calcFieldGrid" style={{ marginTop: 18 }}>
              <div>
                <div style={labelStyle()}>
                  Trade Direction
                  <HelpTip text="Choose Long if you expect price to rise, Short if you expect price to fall." />
                </div>
                <select
                  value={marginSide}
                  onChange={(e) =>
                    setMarginSide(e.target.value as "long" | "short")
                  }
                  style={selectStyle()}
                >
                  <option value="long">Long</option>
                  <option value="short">Short</option>
                </select>
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
            </div>

            <div className="calcResultGrid" style={{ marginTop: 18 }}>
              <div className="mobileCompactResultCard" style={tintBox(liquidationColor)}>
                <div className="mobileCompactResultLabel" style={resultLabelStyle()}>
                  <span className="mobileCompactResultText">Liquidation Price</span>
                  <HelpTip text="Estimated liquidation price only. Some brokers may calculate liquidation differently." />
                  {liquidationColor === "red" ? (
                    <span
                      style={{
                        marginLeft: "auto",
                        color: "#ef4444",
                        fontWeight: 900,
                      }}
                    >
                      ⚠
                    </span>
                  ) : null}
                </div>
                <div className="mobileCompactResultValue" style={{ marginTop: 6, fontSize: 24, fontWeight: 950 }}>
                  {fmtMoney(marginCalc.liquidationPrice)}
                </div>
              </div>

              <div className="mobileCompactResultCard" style={tintBox(liquidationColor)}>
                <div className="mobileCompactResultLabel" style={resultLabelStyle()}>
                  <span className="mobileCompactResultText">Liquidation %</span>
                  <HelpTip text="Shows how far price can move against your trade before estimated liquidation. Some brokers may calculate liquidation differently." />
                  {liquidationColor === "red" ? (
                    <span
                      style={{
                        marginLeft: "auto",
                        color: "#ef4444",
                        fontWeight: 900,
                      }}
                    >
                      ⚠
                    </span>
                  ) : null}
                </div>
                <div className="mobileCompactResultValue" style={{ marginTop: 6, fontSize: 24, fontWeight: 950 }}>
                  {fmtPct(marginCalc.distancePct)}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 18, ...calloutCardStyle("blue") }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={utilityIconStyle("blue")}>ℹ️</div>
                <div style={{ fontWeight: 900 }}>What this tool does</div>
              </div>
              <div style={{ opacity: 0.84, lineHeight: 1.6 }}>
                This calculator estimates the price at which your broker could
                automatically close your position due to insufficient margin.
              </div>
            </div>

            <div style={{ marginTop: 14, ...calloutCardStyle("red") }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={utilityIconStyle("red")}>⚠</div>
                <div style={{ fontWeight: 900 }}>Why it matters</div>
              </div>
              <div style={{ opacity: 0.84, lineHeight: 1.6 }}>
                If you use leverage without understanding liquidation, even a
                relatively small move against your trade can cause forced
                selling. This tool helps you understand how close danger may be
                before entering a trade.
              </div>
            </div>
          </section>

          <section style={calculatorPanelStyle()}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={utilityIconStyle("green")}>🛡</div>
              <div>
                <div style={badgeStyle("green")}>RISK TOOL</div>

                <h2
                  style={{
                    margin: "12px 0 0",
                    fontSize: 28,
                    letterSpacing: "-0.3px",
                  }}
                >
                  Position Size / Stop Loss Calculator
                </h2>

                <p style={{ margin: "10px 0 0", opacity: 0.84, lineHeight: 1.6 }}>
                  Work out how many shares you can buy while keeping your loss
                  within a sensible risk limit.
                </p>
              </div>
            </div>

            <div className="calcFieldGrid" style={{ marginTop: 18 }}>
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

            <div className="calcResultGrid" style={{ marginTop: 18 }}>
              <div className="mobileCompactResultCard" style={tintBox("green", true)}>
                <div className="mobileCompactResultLabel" style={resultLabelStyle()}>
                  <span className="mobileCompactResultText">Total Position Size</span>
                  <HelpTip text="This is the suggested trade size based on your chosen risk amount and stop loss distance." />
                </div>
                <div
                  className="mobileCompactResultValue"
                  style={{ marginTop: 6, fontSize: 24, fontWeight: 950 }}
                >
                  {fmtMoney(riskCalc.positionSize)}
                </div>
              </div>

              <div className="mobileCompactResultCard" style={tintBox(rrColor)}>
                <div className="mobileCompactResultLabel" style={resultLabelStyle()}>
                  <span className="mobileCompactResultText">Risk / Reward</span>
                  <HelpTip text="Compares your potential reward to your potential loss. Higher is usually better." />
                  {rrColor === "red" ? (
                    <span
                      style={{
                        marginLeft: "auto",
                        color: "#ef4444",
                        fontWeight: 900,
                      }}
                    >
                      ⚠
                    </span>
                  ) : null}
                </div>
                <div
                  className="mobileCompactResultValue"
                  style={{ marginTop: 6, fontSize: 24, fontWeight: 950 }}
                >
                  {riskCalc.rr == null ? "—" : `1 : ${riskCalc.rr.toFixed(2)}`}
                </div>
              </div>

              <div className="mobileCompactResultCard" style={baseResultBoxStyle()}>
                <div className="mobileCompactResultLabel" style={resultLabelStyle()}>
                  <span className="mobileCompactResultText">Max Shares</span>
                </div>
                <div
                  className="mobileCompactResultValue"
                  style={{ marginTop: 6, fontSize: 24, fontWeight: 950 }}
                >
                  {fmtNum(riskCalc.shares)}
                </div>
              </div>

              <div className="mobileCompactResultCard" style={baseResultBoxStyle()}>
                <div className="mobileCompactResultLabel" style={resultLabelStyle()}>
                  <span className="mobileCompactResultText">Dollar Risk</span>
                </div>
                <div
                  className="mobileCompactResultValue"
                  style={{ marginTop: 6, fontSize: 24, fontWeight: 950 }}
                >
                  {fmtMoney(riskCalc.dollarRisk)}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 18, ...calloutCardStyle("green") }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={utilityIconStyle("green")}>✅</div>
                <div style={{ fontWeight: 900 }}>What this tool does</div>
              </div>
              <div style={{ opacity: 0.84, lineHeight: 1.6 }}>
                This calculator helps you decide how many shares to buy based on
                the amount you are prepared to lose if your stop loss is hit.
              </div>
            </div>

            <div style={{ marginTop: 14, ...calloutCardStyle("yellow") }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={utilityIconStyle("yellow")}>📏</div>
                <div style={{ fontWeight: 900 }}>Why it matters</div>
              </div>
              <div style={{ opacity: 0.84, lineHeight: 1.6 }}>
                Good traders control their risk before entering a trade.
                Position sizing helps prevent one bad trade from doing serious
                damage to your account and keeps your trading more disciplined
                over time.
              </div>
            </div>
          </section>
        </div>

<section style={infoSectionStyle()}>
<div style={{ display: "flex", alignItems: "center" }}>
    <div>
      <div style={sectionEyebrowStyle("blue")}>Learn next</div>
      <h2 style={{ margin: "6px 0 0", fontSize: 24, lineHeight: 1.2 }}>
        Related risk management guides
      </h2>
    </div>
  </div>

  <div
    style={{
      marginTop: 14,
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
      gap: 12,
    }}
  >
    <Link href="/position-sizing-guide" style={guideCardStyle()}>
      <div style={{ fontWeight: 900, fontSize: 16 }}>
        Position Sizing Guide
      </div>
      <div
        style={{
          marginTop: 6,
          opacity: 0.76,
          lineHeight: 1.55,
          fontSize: 13,
        }}
      >
        Learn how traders calculate the correct trade size based on risk
        and stop loss distance.
      </div>
    </Link>

    <Link href="/stop-loss-strategy" style={guideCardStyle()}>
      <div style={{ fontWeight: 900, fontSize: 16 }}>
        Stop Loss Strategy
      </div>
      <div
        style={{
          marginTop: 6,
          opacity: 0.76,
          lineHeight: 1.55,
          fontSize: 13,
        }}
      >
        Understand how stop losses help control downside risk and protect
        trading capital.
      </div>
    </Link>

    <Link href="/trading-risk-management" style={guideCardStyle()}>
      <div style={{ fontWeight: 900, fontSize: 16 }}>
        Trading Risk Management
      </div>
      <div
        style={{
          marginTop: 6,
          opacity: 0.76,
          lineHeight: 1.55,
          fontSize: 13,
        }}
      >
        Explore the core principles traders use to control losses and
        manage overall portfolio risk.
      </div>
    </Link>

    <Link href="/risk-reward-ratio" style={guideCardStyle()}>
      <div style={{ fontWeight: 900, fontSize: 16 }}>
        Risk Reward Ratio
      </div>
      <div
        style={{
          marginTop: 6,
          opacity: 0.76,
          lineHeight: 1.55,
          fontSize: 13,
        }}
      >
        Learn how traders compare potential upside and downside before
        entering a trade.
      </div>
    </Link>

    <Link href="/margin-trading-explained" style={guideCardStyle()}>
      <div style={{ fontWeight: 900, fontSize: 16 }}>
        Margin Trading Explained
      </div>
      <div
        style={{
          marginTop: 6,
          opacity: 0.76,
          lineHeight: 1.55,
          fontSize: 13,
        }}
      >
        Understand how leverage works and why liquidation risk matters
        when trading on margin.
      </div>
    </Link>

    <Link href="/pickers" style={guideCardStyle()}>
      <div style={{ fontWeight: 900, fontSize: 16 }}>
        Find Stock Ideas
      </div>
      <div
        style={{
          marginTop: 6,
          opacity: 0.76,
          lineHeight: 1.55,
          fontSize: 13,
        }}
      >
        Use the stock pickers to find setups, then return here to plan
        trade size and risk.
      </div>
    </Link>
  </div>
</section>

        <section style={infoSectionStyle()}>
<div style={{ display: "flex", alignItems: "center" }}>
            <div>
              <div style={sectionEyebrowStyle("yellow")}>Quick answers</div>
              <h2 style={{ margin: "6px 0 0", fontSize: 24, lineHeight: 1.2 }}>FAQ</h2>
            </div>
          </div>

          <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                What is a liquidation calculator?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.82 }}>
                A liquidation calculator estimates the price where a leveraged
                position may be forcibly closed if price moves too far against
                you.
              </p>
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                What is a position size calculator?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.82 }}>
                A position size calculator helps you work out how many shares to
                buy based on your entry, stop loss and maximum acceptable dollar
                risk.
              </p>
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                Why does risk-reward matter?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.82 }}>
                Risk-reward helps traders compare the possible upside of a trade
                with the downside they are accepting. It is one of the basic
                ways to judge whether a setup is worth taking.
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

  .calcFieldGrid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .calcResultGrid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .topNavRow {
    display: flex;
    justify-content: flex-end;
    align-items: flex-start;
    gap: 10px;
    flex-wrap: wrap;
  }

  .topNavBtn {
    flex: 0 0 auto;
  }

  .topNavLabel {
    display: inline-flex;
    align-items: center;
  }

  a:hover {
    filter: brightness(1.05);
    transform: translateY(-1px);
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

    .topNavRow {
      justify-content: stretch !important;
      align-items: stretch !important;
      gap: 8px !important;
      flex-wrap: nowrap !important;
    }

    .topNavBtn {
      min-width: 0 !important;
      min-height: 40px !important;
      padding: 9px 10px !important;
      border-radius: 12px !important;
      font-size: 13px !important;
      gap: 6px !important;
      flex: 1 1 0 !important;
    }

    .mobileIconOnly,
    .dashboardIconOnlyBtn,
    .learnIconOnlyBtn {
      padding-left: 0 !important;
      padding-right: 0 !important;
    }

    .dashboardLabel,
    .learnLabel {
      display: none !important;
    }

    .mobileTextBtn {
      justify-content: center !important;
    }

    .mobileTextBtn :global(span[aria-hidden="true"]) {
      display: none !important;
    }

    .mobileHideIntroSection {
      display: none !important;
    }

    .calcFieldGrid,
    .calcResultGrid {
      grid-template-columns: 1fr 1fr !important;
      gap: 10px !important;
    }

    .mobileCompactResultCard {
      padding: 12px !important;
      border-radius: 12px !important;
      min-width: 0 !important;
    }

    .mobileCompactResultLabel {
      font-size: 11px !important;
      gap: 2px !important;
      line-height: 1.2 !important;
      flex-wrap: nowrap !important;
      min-width: 0 !important;
    }

    .mobileCompactResultText {
      min-width: 0 !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
    }

    .mobileCompactResultValue {
      font-size: 18px !important;
      line-height: 1.15 !important;
      margin-top: 5px !important;
    }
  }
`}</style>
    </main>
  );
}
