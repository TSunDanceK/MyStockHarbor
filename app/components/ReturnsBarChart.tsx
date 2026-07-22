import type { CSSProperties } from "react";

// -- Daily / weekly close-over-close returns bar chart -----------------------
// Presentational (no hooks, no "use client") — the caller computes `bars`
// from data it already has (history state seeded server-side on
// /stock/[symbol]) and passes them in as plain props, so this renders into
// the initial HTML with no extra client fetch. One green/red bar per period,
// bars extend up from a zero baseline for a higher close and down for a
// lower one — same visual language as a simple market-breadth bar chart.

export type ReturnBar = {
  // ISO date of the closing price this bar represents (the later of the two
  // closes being compared).
  date: string;
  // Short display label for tooltips/axis ends, e.g. "Jul 21".
  label: string;
  changePercent: number;
};

const GREEN = "#22c55e";
const RED = "#ef4444";

function fmtPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function ReturnsBarChart({
  symbol,
  periodLabel,
  compareLabel,
  bars,
}: {
  symbol: string;
  // "Daily" | "Weekly"
  periodLabel: string;
  // e.g. "previous day's close" | "previous week's close"
  compareLabel: string;
  bars: ReturnBar[];
}) {
  // Need a real run of bars for the chart to read as a trend, not noise.
  if (bars.length < 3) return null;

  // -- Chart geometry (server-rendered SVG, no client JS) --------------------
  const width = 900;
  const height = 200;
  const padX = 6;
  const padTop = 16;
  const padBottom = 24;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;
  const baselineY = padTop + plotH / 2;
  const halfH = plotH / 2 - 4;

  const maxAbs = Math.max(...bars.map((b) => Math.abs(b.changePercent)), 0.1);
  const slot = plotW / bars.length;
  const barWidth = Math.max(3, slot * 0.55);

  const up = bars.filter((b) => b.changePercent >= 0).length;
  const down = bars.length - up;
  const avg = bars.reduce((sum, b) => sum + b.changePercent, 0) / bars.length;
  const latest = bars[bars.length - 1];
  const first = bars[0];

  return (
    <div style={cardStyle}>
      <div style={eyebrowStyle}>{periodLabel} returns</div>
      <h3 style={headingStyle}>
        {symbol} close vs {compareLabel}
      </h3>
      <p style={subStyle}>
        Each bar is the percentage change in {symbol}&apos;s closing price versus its{" "}
        {compareLabel} — green for a higher close, red for a lower one.
      </p>

      <div style={{ marginTop: 16 }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="img"
          aria-label={`${symbol} ${periodLabel.toLowerCase()} close-over-close percentage change from ${first.label} to ${latest.label}`}
          style={{ width: "100%", height: "auto", maxWidth: "100%", display: "block" }}
        >
          <line
            x1={padX}
            y1={baselineY}
            x2={width - padX}
            y2={baselineY}
            stroke="rgba(255,255,255,0.16)"
            strokeWidth={1}
          />
          {bars.map((b, i) => {
            const cx = padX + slot * i + slot / 2;
            const x = cx - barWidth / 2;
            const magnitude = Math.min(1, Math.abs(b.changePercent) / maxAbs);
            const barH = Math.max(3, magnitude * halfH);
            const color = b.changePercent >= 0 ? GREEN : RED;
            const y = b.changePercent >= 0 ? baselineY - barH : baselineY;
            return (
              <rect
                key={`${b.date}-${i}`}
                x={x}
                y={y}
                width={barWidth}
                height={barH}
                rx={Math.min(3, barWidth / 2)}
                fill={color}
              >
                <title>{`${b.label}: ${fmtPct(b.changePercent)}`}</title>
              </rect>
            );
          })}
          <text x={padX} y={height - 6} fontSize={11} fill="rgba(203,213,225,0.55)">
            {first.label}
          </text>
          <text
            x={width - padX}
            y={height - 6}
            fontSize={11}
            fill="rgba(203,213,225,0.55)"
            textAnchor="end"
          >
            {latest.label}
          </text>
        </svg>
      </div>

      <div className="returns-stats-row">
        <div style={cellStyle}>
          <div style={cellLabelStyle}>Latest {periodLabel.toLowerCase()} change</div>
          <div style={{ ...cellValueStyle, color: latest.changePercent >= 0 ? GREEN : RED }}>
            {fmtPct(latest.changePercent)}
          </div>
        </div>
        <div style={cellStyle}>
          <div style={cellLabelStyle}>Up / down over window</div>
          <div style={cellValueStyle}>
            {up} up · {down} down
          </div>
        </div>
        <div style={cellStyle}>
          <div style={cellLabelStyle}>Average change</div>
          <div style={{ ...cellValueStyle, color: avg >= 0 ? GREEN : RED }}>{fmtPct(avg)}</div>
        </div>
      </div>

      <style>{`
        .returns-stats-row {
          margin-top: 14px;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        @media (max-width: 480px) {
          .returns-stats-row { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

const cardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 16,
  padding: "16px 18px",
  background: "rgba(255,255,255,0.02)",
  minWidth: 0,
};
const eyebrowStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "rgba(147,197,253,0.82)",
  marginBottom: 6,
};
const headingStyle: CSSProperties = {
  margin: 0,
  fontSize: 16,
  lineHeight: 1.25,
  letterSpacing: "-0.02em",
  fontWeight: 800,
};
const subStyle: CSSProperties = {
  marginTop: 8,
  marginBottom: 0,
  fontSize: 12.5,
  lineHeight: 1.55,
  color: "rgba(241,245,249,0.65)",
};
const cellStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 10,
  padding: "8px 10px",
  background: "rgba(255,255,255,0.02)",
  minWidth: 0,
};
const cellLabelStyle: CSSProperties = {
  fontSize: 9.5,
  fontWeight: 900,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "rgba(148,163,184,0.62)",
};
const cellValueStyle: CSSProperties = {
  marginTop: 4,
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: "-0.01em",
  color: "#f1f5f9",
  overflowWrap: "anywhere",
};
