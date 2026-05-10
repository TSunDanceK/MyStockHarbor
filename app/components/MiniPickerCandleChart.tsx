import type { CSSProperties } from "react";

export type MiniCandlePoint = {
  date: string;
  open?: number;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

type MiniPickerCandleChartProps = {
  points?: MiniCandlePoint[];
  tone?: "green" | "red" | "yellow" | "orange" | "blue";
};

function toneBorder(tone?: MiniPickerCandleChartProps["tone"]) {
  if (tone === "red") return "rgba(248,113,113,0.20)";
  if (tone === "yellow") return "rgba(250,204,21,0.20)";
  if (tone === "orange") return "rgba(251,146,60,0.20)";
  if (tone === "blue") return "rgba(96,165,250,0.20)";
  return "rgba(34,197,94,0.20)";
}

function toneGlow(tone?: MiniPickerCandleChartProps["tone"]) {
  if (tone === "red") return "rgba(248,113,113,0.10)";
  if (tone === "yellow") return "rgba(250,204,21,0.10)";
  if (tone === "orange") return "rgba(251,146,60,0.10)";
  if (tone === "blue") return "rgba(96,165,250,0.10)";
  return "rgba(34,197,94,0.10)";
}

const emptyStyle: CSSProperties = {
  marginTop: 14,
  height: 138,
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(2,6,23,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#64748b",
  fontSize: 12,
  fontWeight: 900,
};

export default function MiniPickerCandleChart({
  points = [],
  tone = "green",
}: MiniPickerCandleChartProps) {
  const cleanPoints = points
    .filter((point) => point && point.date && Number.isFinite(point.close))
    .slice(-56);

  if (cleanPoints.length < 4) {
    return <div style={emptyStyle}>Chart preview unavailable</div>;
  }

  const width = 420;
  const height = 154;
  const paddingX = 16;
  const paddingTop = 16;
  const paddingBottom = 24;

  const lows = cleanPoints.map((point) =>
    typeof point.low === "number" && Number.isFinite(point.low)
      ? point.low
      : point.close
  );

  const highs = cleanPoints.map((point) =>
    typeof point.high === "number" && Number.isFinite(point.high)
      ? point.high
      : point.close
  );

  const minValue = Math.min(...lows);
  const maxValue = Math.max(...highs);
  const range = maxValue - minValue || 1;
  const buffer = range * 0.12;
  const yMin = minValue - buffer;
  const yMax = maxValue + buffer;
  const yRange = yMax - yMin || 1;

  function xAt(index: number) {
    if (cleanPoints.length <= 1) return paddingX;
    return paddingX + (index / (cleanPoints.length - 1)) * (width - paddingX * 2);
  }

  function yAt(value: number) {
    return (
      paddingTop +
      ((yMax - value) / yRange) * (height - paddingTop - paddingBottom)
    );
  }

  const slotWidth = (width - paddingX * 2) / Math.max(1, cleanPoints.length);
  const candleBodyWidth = Math.max(2.2, Math.min(7, slotWidth * 0.58));
  const gridYs = [0.25, 0.5, 0.75].map(
    (ratio) => paddingTop + ratio * (height - paddingTop - paddingBottom)
  );

  const firstDate = cleanPoints[0]?.date?.slice(5) ?? "";
  const lastDate = cleanPoints[cleanPoints.length - 1]?.date?.slice(5) ?? "";

  return (
    <div
      style={{
        marginTop: 14,
        border: `1px solid ${toneBorder(tone)}`,
        borderRadius: 16,
        background: `radial-gradient(circle at 18% 0%, ${toneGlow(
          tone
        )}, transparent 34%), rgba(2,6,23,0.62)`,
        overflow: "hidden",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)",
      }}
    >
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Mini candlestick chart" style={{ display: "block", width: "100%", height: "auto" }}>
        <rect x="0" y="0" width={width} height={height} fill="rgba(2,6,23,0.18)" />

        {gridYs.map((y) => (
          <line key={y} x1={paddingX} x2={width - paddingX} y1={y} y2={y} stroke="rgba(148,163,184,0.13)" strokeWidth="1" />
        ))}

        {cleanPoints.map((point, index) => {
          const open =
            typeof point.open === "number" && Number.isFinite(point.open)
              ? point.open
              : index > 0
                ? cleanPoints[index - 1].close
                : point.close;
          const close = point.close;
          const high =
            typeof point.high === "number" && Number.isFinite(point.high)
              ? point.high
              : Math.max(open, close);
          const low =
            typeof point.low === "number" && Number.isFinite(point.low)
              ? point.low
              : Math.min(open, close);

          const x = xAt(index);
          const highY = yAt(high);
          const lowY = yAt(low);
          const openY = yAt(open);
          const closeY = yAt(close);
          const up = close >= open;
          const candleColour = up ? "#22c55e" : "#fb7185";
          const bodyTop = Math.min(openY, closeY);
          const bodyHeight = Math.max(2, Math.abs(openY - closeY));

          return (
            <g key={`${point.date}-${index}`}>
              <line x1={x} x2={x} y1={highY} y2={lowY} stroke={candleColour} strokeWidth="1.15" strokeLinecap="round" opacity="0.82" />
              <rect x={x - candleBodyWidth / 2} y={bodyTop} width={candleBodyWidth} height={bodyHeight} rx="1.2" fill={candleColour} opacity={up ? 0.82 : 0.9} />
            </g>
          );
        })}

        <text x={paddingX} y={height - 7} fill="rgba(203,213,225,0.58)" fontSize="10" fontWeight="700">
          {firstDate}
        </text>
        <text x={width - paddingX} y={height - 7} textAnchor="end" fill="rgba(203,213,225,0.58)" fontSize="10" fontWeight="700">
          {lastDate}
        </text>
      </svg>
    </div>
  );
}
