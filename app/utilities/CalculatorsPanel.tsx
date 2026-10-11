"use client";

import { useMemo, useState } from "react";
import {
  calculatorPanelStyle,
  badgeStyle,
  inputStyle,
  selectStyle,
  baseResultBoxStyle,
  labelStyle,
  resultLabelStyle,
  utilityIconStyle,
  calloutCardStyle,
  toNum,
  fmtMoney,
  fmtPct,
  fmtNum,
  getLiquidationColor,
  getRRColor,
  tintBox,
} from "./utilitiesStyles";

function HelpTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

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

export default function CalculatorsPanel() {
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
    <div style={{ marginTop: 22 }} className="grid2">
      <section style={calculatorPanelStyle()}>
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
  );
}
