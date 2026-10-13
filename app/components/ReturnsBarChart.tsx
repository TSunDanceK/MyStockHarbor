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
  // Short display label for tooltips/axis ends, naming the END of the
  // period: "2 Oct", "week to 2 Oct", "Sep 2026" (lib/closeReturns.ts).
  label: string;
  changePercent: number;
  // A period still in progress ("Oct so far", #553 COWORK #115): drawn with a
  // lighter fill and left out of the tiles, never presented as a full period.
  partial?: boolean;
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
  bare = false,
  note,
}: {
  symbol: string;
  // "Daily" | "Weekly"
  periodLabel: string;
  // e.g. "previous day's close" | "previous week's close"
  compareLabel: string;
  bars: ReturnBar[];
  // Inside ReturnsToggleCard (#553 COWORK #89): that card is the one border, so
  // each view drops its own. Content is identical either way.
  bare?: boolean;
  // A line under the explainer, e.g. "October so far isn't included."
  note?: string;
}) {
  // THE TILES COUNT COMPLETE PERIODS ONLY; a partial bar is drawn, marked.
  const whole = bars.filter((b) => !b.partial);
  // Need a real run of bars for the chart to read as a trend, not noise.
  if (whole.length < 3) return null;

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

  const up = whole.filter((b) => b.changePercent >= 0).length;
  const down = whole.length - up;
  const avg = whole.reduce((sum, b) => sum + b.changePercent, 0) / whole.length;
  // The tiles' latest is the latest COMPLETE period; the axis ends at the last bar drawn.
  const latest = whole[whole.length - 1];
  const first = bars[0];
  const lastDrawn = bars[bars.length - 1];

  return (
    <div style={bare ? bareStyle : cardStyle}>
      <div style={eyebrowStyle}>{periodLabel} returns</div>
      <h3 style={headingStyle}>
        {symbol} close vs {compareLabel}
      </h3>
      <p style={subStyle}>
        Each bar is the percentage change in {symbol}&apos;s closing price versus its{" "}
        {compareLabel} — green for a higher close, red for a lower one.
      </p>
      {note ? <p style={{ ...subStyle, marginTop: 4 }}>{note}</p> : null}

      <div style={{ marginTop: 16 }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="img"
          aria-label={`${symbol} ${periodLabel.toLowerCase()} close-over-close percentage change from ${first.label} to ${lastDrawn.label}`}
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
                fillOpacity={b.partial ? 0.35 : 1}
                stroke={b.partial ? color : undefined}
                strokeDasharray={b.partial ? "3 2" : undefined}
              >
                <title>{`${b.label}: ${fmtPct(b.changePercent)}${b.partial ? " (month in progress)" : ""}`}</title>
              </rect>
            );
          })}
          <text x={padX} y={height - 6} fontSize="0.75rem" fill="rgba(203,213,225,0.55)">
            {first.label}
          </text>
          <text
            x={width - padX}
            y={height - 6}
            fontSize="0.75rem"
            fill="rgba(203,213,225,0.55)"
            textAnchor="end"
          >
            {lastDrawn.label}
          </text>
        </svg>
      </div>

      <div className="returns-stats-row">
        <div style={cellStyle}>
          <div style={cellLabelStyle}>Latest {periodLabel.toLowerCase()} change{latest !== lastDrawn ? ` (${latest.label})` : ""}</div>
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

export const cardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 16,
  padding: "16px 18px",
  background: "rgba(255,255,255,0.02)",
  minWidth: 0,
};
const bareStyle: CSSProperties = { minWidth: 0 };
const eyebrowStyle: CSSProperties = {
  fontSize: "var(--fs-label)",
  fontWeight: 900,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "rgba(147,197,253,0.82)",
  marginBottom: 6,
};
const headingStyle: CSSProperties = {
  margin: 0,
  fontSize: "1rem",
  lineHeight: 1.25,
  letterSpacing: "-0.02em",
  fontWeight: 800,
};
const subStyle: CSSProperties = {
  marginTop: 8,
  marginBottom: 0,
  fontSize: "var(--fs-read)",
  lineHeight: "var(--lh-read)",
  color: "rgba(241,245,249,0.7)",
};
const cellStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 10,
  padding: "8px 10px",
  background: "rgba(255,255,255,0.02)",
  minWidth: 0,
};
const cellLabelStyle: CSSProperties = {
  fontSize: "var(--fs-label)",
  fontWeight: 900,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "rgba(148,163,184,0.62)",
};
const cellValueStyle: CSSProperties = {
  marginTop: 4,
  fontSize: "0.8125rem",
  fontWeight: 800,
  letterSpacing: "-0.01em",
  color: "#f1f5f9",
  overflowWrap: "anywhere",
};
