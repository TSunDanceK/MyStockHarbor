import type { CSSProperties } from "react";

export type MiniCandlePoint = {
  date: string;
  open?: number;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
  ma50?: number;
  ma200?: number;
  rsi14?: number;
  macdHist?: number;
};

type ChartOverlay =
  | "none"
  | "ma200"
  | "ath"
  | "recentHigh"
  | "rsi"
  | "macd"
  | "trend";

export type SupportResistanceZone = {
  kind: "support" | "resistance";
  lower: number;
  upper: number;
};

type MiniPickerCandleChartProps = {
  points?: MiniCandlePoint[];
  tone?: "green" | "red" | "yellow" | "orange" | "blue";
  overlay?: ChartOverlay;
  supportResistanceZone?: SupportResistanceZone;
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
  height: 154,
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function fallbackSma(values: number[], window: number) {
  const out: (number | null)[] = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

function fallbackRsi(values: number[], period = 14) {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length < period + 1) return out;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss += -diff;
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return out;
}

function fallbackEma(values: number[], period: number) {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (!values.length) return out;

  const k = 2 / (period + 1);
  let emaPrev: number | null = null;

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (i < period - 1) continue;
    if (i === period - 1) {
      const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
      emaPrev = seed;
      out[i] = seed;
      continue;
    }

    emaPrev = emaPrev == null ? value : value * k + emaPrev * (1 - k);
    out[i] = emaPrev;
  }

  return out;
}

function fallbackMacdHist(values: number[]) {
  const fast = fallbackEma(values, 12);
  const slow = fallbackEma(values, 26);
  const line = values.map((_, index) => {
    const f = fast[index];
    const s = slow[index];
    return isFiniteNumber(f) && isFiniteNumber(s) ? f - s : null;
  });
  const signalInput = line.map((value) => (isFiniteNumber(value) ? value : 0));
  const signal = fallbackEma(signalInput, 9);

  return line.map((value, index) => {
    const sig = signal[index];
    return isFiniteNumber(value) && isFiniteNumber(sig) ? value - sig : null;
  });
}

export default function MiniPickerCandleChart({
  points = [],
  tone = "green",
  overlay = "none",
  supportResistanceZone,
}: MiniPickerCandleChartProps) {
  const cleanPoints = points.filter(
    (point) => point && point.date && Number.isFinite(point.close)
  );

  if (cleanPoints.length < 4) {
    return <div style={emptyStyle}>Chart preview unavailable</div>;
  }

  const visibleLimit = supportResistanceZone ? 104 : 64;
  const visiblePoints = cleanPoints.slice(-visibleLimit);
  const visibleStart = Math.max(0, cleanPoints.length - visiblePoints.length);
  const closes = cleanPoints.map((point) => point.close);
  const fallbackMa50 = fallbackSma(closes, 50);
  const fallbackMa200 = fallbackSma(closes, 200);
  const fallbackRsiArr = fallbackRsi(closes, 14);
  const fallbackMacdArr = fallbackMacdHist(closes);

  const showIndicator = overlay === "rsi" || overlay === "macd";
  const width = 420;
  const priceHeight = showIndicator ? 128 : 154;
  const indicatorHeight = showIndicator ? 52 : 0;
  const height = priceHeight + indicatorHeight;
  const paddingX = 16;
  const paddingTop = 16;
  const paddingBottom = showIndicator ? 10 : 24;
  const indicatorTop = priceHeight + 4;
  const indicatorBottom = height - 18;

  const lows = visiblePoints.map((point) =>
    isFiniteNumber(point.low) ? point.low : point.close
  );

  const highs = visiblePoints.map((point) =>
    isFiniteNumber(point.high) ? point.high : point.close
  );

  const ma50Values = visiblePoints.map((point, localIndex) => {
    const globalIndex = visibleStart + localIndex;
    return isFiniteNumber(point.ma50) ? point.ma50 : fallbackMa50[globalIndex];
  });

  const ma200Values = visiblePoints.map((point, localIndex) => {
    const globalIndex = visibleStart + localIndex;
    return isFiniteNumber(point.ma200) ? point.ma200 : fallbackMa200[globalIndex];
  });

  const priceOverlayValues: number[] = [];
  const validSupportResistanceZone =
    supportResistanceZone &&
    isFiniteNumber(supportResistanceZone.lower) &&
    isFiniteNumber(supportResistanceZone.upper) &&
    supportResistanceZone.lower > 0 &&
    supportResistanceZone.upper > 0
      ? {
          kind: supportResistanceZone.kind,
          lower: Math.min(supportResistanceZone.lower, supportResistanceZone.upper),
          upper: Math.max(supportResistanceZone.lower, supportResistanceZone.upper),
        }
      : null;

  if (validSupportResistanceZone) {
    priceOverlayValues.push(validSupportResistanceZone.lower, validSupportResistanceZone.upper);
  }
  if (overlay === "ma200") {
    for (const value of ma200Values) {
      if (isFiniteNumber(value)) priceOverlayValues.push(value);
    }
  }
  if (overlay === "trend") {
    for (const value of ma50Values) {
      if (isFiniteNumber(value)) priceOverlayValues.push(value);
    }
    for (const value of ma200Values) {
      if (isFiniteNumber(value)) priceOverlayValues.push(value);
    }
  }

  const previousHighSource =
    overlay === "ath"
      ? cleanPoints.slice(0, -1)
      : overlay === "recentHigh"
        ? visiblePoints.slice(0, -1)
        : [];
  const previousHigh = previousHighSource.length
    ? Math.max(
        ...previousHighSource.map((point) =>
          isFiniteNumber(point.high) ? point.high : point.close
        )
      )
    : null;

  if (isFiniteNumber(previousHigh)) priceOverlayValues.push(previousHigh);

  const minValue = Math.min(...lows, ...priceOverlayValues);
  const maxValue = Math.max(...highs, ...priceOverlayValues);
  const range = maxValue - minValue || 1;
  const buffer = range * 0.12;
  const yMin = minValue - buffer;
  const yMax = maxValue + buffer;
  const yRange = yMax - yMin || 1;

  function xAt(index: number) {
    if (visiblePoints.length <= 1) return paddingX;
    return paddingX + (index / (visiblePoints.length - 1)) * (width - paddingX * 2);
  }

  function yAt(value: number) {
    return (
      paddingTop +
      ((yMax - value) / yRange) * (priceHeight - paddingTop - paddingBottom)
    );
  }

  function indicatorYAt(value: number, min: number, max: number) {
    const range = max - min || 1;
    return indicatorTop + ((max - value) / range) * (indicatorBottom - indicatorTop);
  }

  function linePath(values: Array<number | null | undefined>, yFn: (value: number) => number) {
    let path = "";
    values.forEach((value, index) => {
      if (!isFiniteNumber(value)) return;
      const command = path ? "L" : "M";
      path += `${command}${xAt(index).toFixed(1)} ${yFn(value).toFixed(1)} `;
    });
    return path.trim();
  }

  const slotWidth = (width - paddingX * 2) / Math.max(1, visiblePoints.length);
  const candleBodyWidth = Math.max(2.2, Math.min(6.5, slotWidth * 0.58));
  const gridYs = [0.25, 0.5, 0.75].map(
    (ratio) => paddingTop + ratio * (priceHeight - paddingTop - paddingBottom)
  );

  const firstDate = visiblePoints[0]?.date?.slice(5) ?? "";
  const lastDate = visiblePoints[visiblePoints.length - 1]?.date?.slice(5) ?? "";
  const ma200Path = linePath(ma200Values, yAt);
  const ma50Path = linePath(ma50Values, yAt);

  const rsiValues = visiblePoints.map((point, localIndex) => {
    const globalIndex = visibleStart + localIndex;
    return isFiniteNumber(point.rsi14) ? point.rsi14 : fallbackRsiArr[globalIndex];
  });
  const macdValues = visiblePoints.map((point, localIndex) => {
    const globalIndex = visibleStart + localIndex;
    return isFiniteNumber(point.macdHist) ? point.macdHist : fallbackMacdArr[globalIndex];
  });

  const rsiPath = linePath(rsiValues, (value) => indicatorYAt(value, 0, 100));
  const macdFinite = macdValues.filter(isFiniteNumber);
  const macdMax = Math.max(0.01, ...macdFinite.map((value) => Math.abs(value)));
  const highLineLabel = overlay === "ath" ? "Previous ATH" : "Previous 3M high";
  const supportResistanceColour =
    validSupportResistanceZone?.kind === "support" ? "#22c55e" : "#fb923c";
  const supportResistanceFill =
    validSupportResistanceZone?.kind === "support"
      ? "rgba(34,197,94,0.11)"
      : "rgba(251,146,60,0.12)";
  const supportResistanceLabel =
    validSupportResistanceZone?.kind === "support" ? "Macro support" : "Macro resistance";

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
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Mini candlestick chart"
        style={{ display: "block", width: "100%", height: "auto" }}
      >
        <rect x="0" y="0" width={width} height={height} fill="rgba(2,6,23,0.18)" />

        {gridYs.map((y) => (
          <line
            key={y}
            x1={paddingX}
            x2={width - paddingX}
            y1={y}
            y2={y}
            stroke="rgba(148,163,184,0.13)"
            strokeWidth="1"
          />
        ))}

        {validSupportResistanceZone ? (
          <g>
            <rect
              x={paddingX}
              y={Math.min(yAt(validSupportResistanceZone.upper), yAt(validSupportResistanceZone.lower))}
              width={width - paddingX * 2}
              height={Math.max(3, Math.abs(yAt(validSupportResistanceZone.lower) - yAt(validSupportResistanceZone.upper)))}
              fill={supportResistanceFill}
              stroke={supportResistanceColour}
              strokeWidth="1"
              strokeDasharray="5 5"
              opacity="0.95"
            />
            <line
              x1={paddingX}
              x2={width - paddingX}
              y1={yAt((validSupportResistanceZone.lower + validSupportResistanceZone.upper) / 2)}
              y2={yAt((validSupportResistanceZone.lower + validSupportResistanceZone.upper) / 2)}
              stroke={supportResistanceColour}
              strokeWidth="1.8"
              opacity="0.88"
            />
            <text
              x={width - paddingX}
              y={Math.max(12, yAt(validSupportResistanceZone.upper) - 5)}
              textAnchor="end"
              fill={validSupportResistanceZone.kind === "support" ? "#bbf7d0" : "#fed7aa"}
              fontSize="10"
              fontWeight="900"
            >
              {supportResistanceLabel}
            </text>
          </g>
        ) : null}

        {isFiniteNumber(previousHigh) ? (
          <g>
            <line
              x1={paddingX}
              x2={width - paddingX}
              y1={yAt(previousHigh)}
              y2={yAt(previousHigh)}
              stroke={overlay === "ath" ? "#fb923c" : "#60a5fa"}
              strokeWidth="1.6"
              strokeDasharray="5 5"
              opacity="0.9"
            />
            <text
              x={width - paddingX}
              y={Math.max(12, yAt(previousHigh) - 5)}
              textAnchor="end"
              fill={overlay === "ath" ? "#fed7aa" : "#dbeafe"}
              fontSize="10"
              fontWeight="900"
            >
              {highLineLabel}
            </text>
          </g>
        ) : null}

        {overlay === "ma200" && ma200Path ? (
          <path
            d={ma200Path}
            stroke="#facc15"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            opacity="0.95"
          />
        ) : null}

        {overlay === "trend" && ma50Path ? (
          <path
            d={ma50Path}
            stroke="#22c55e"
            strokeWidth="1.7"
            fill="none"
            strokeLinecap="round"
            opacity="0.92"
          />
        ) : null}

        {overlay === "trend" && ma200Path ? (
          <path
            d={ma200Path}
            stroke="#facc15"
            strokeWidth="1.7"
            fill="none"
            strokeLinecap="round"
            opacity="0.9"
          />
        ) : null}

        {visiblePoints.map((point, index) => {
          const open = isFiniteNumber(point.open)
            ? point.open
            : index > 0
              ? visiblePoints[index - 1].close
              : point.close;
          const close = point.close;
          const high = isFiniteNumber(point.high) ? point.high : Math.max(open, close);
          const low = isFiniteNumber(point.low) ? point.low : Math.min(open, close);

          const x = xAt(index);
          const highY = yAt(high);
          const lowY = yAt(low);
          const openY = yAt(open);
          const closeY = yAt(close);
          const up = close >= open;
          const candleColour = up ? "#60a5fa" : "#f8fafc";
          const bodyTop = Math.min(openY, closeY);
          const bodyHeight = Math.max(2, Math.abs(openY - closeY));

          return (
            <g key={`${point.date}-${index}`}>
              <line
                x1={x}
                x2={x}
                y1={highY}
                y2={lowY}
                stroke={candleColour}
                strokeWidth="1.15"
                strokeLinecap="round"
                opacity="0.82"
              />
              <rect
                x={x - candleBodyWidth / 2}
                y={bodyTop}
                width={candleBodyWidth}
                height={bodyHeight}
                rx="1.2"
                fill={candleColour}
                opacity={up ? 0.86 : 0.92}
              />
            </g>
          );
        })}

        {showIndicator ? (
          <g>
            <line
              x1={paddingX}
              x2={width - paddingX}
              y1={indicatorTop}
              y2={indicatorTop}
              stroke="rgba(148,163,184,0.12)"
            />
            <line
              x1={paddingX}
              x2={width - paddingX}
              y1={indicatorBottom}
              y2={indicatorBottom}
              stroke="rgba(148,163,184,0.10)"
            />

            {overlay === "rsi" ? (
              <>
                <line
                  x1={paddingX}
                  x2={width - paddingX}
                  y1={indicatorYAt(70, 0, 100)}
                  y2={indicatorYAt(70, 0, 100)}
                  stroke="rgba(239,68,68,0.48)"
                  strokeDasharray="4 4"
                />
                <line
                  x1={paddingX}
                  x2={width - paddingX}
                  y1={indicatorYAt(30, 0, 100)}
                  y2={indicatorYAt(30, 0, 100)}
                  stroke="rgba(34,197,94,0.48)"
                  strokeDasharray="4 4"
                />
                {rsiPath ? (
                  <path
                    d={rsiPath}
                    stroke="#a78bfa"
                    strokeWidth="2"
                    fill="none"
                    strokeLinecap="round"
                  />
                ) : null}
                <text x={paddingX} y={height - 6} fill="#c4b5fd" fontSize="10" fontWeight="900">
                  RSI(14)
                </text>
              </>
            ) : null}

            {overlay === "macd" ? (
              <>
                <line
                  x1={paddingX}
                  x2={width - paddingX}
                  y1={indicatorYAt(0, -macdMax, macdMax)}
                  y2={indicatorYAt(0, -macdMax, macdMax)}
                  stroke="rgba(148,163,184,0.24)"
                />
                {macdValues.map((value, index) => {
                  if (!isFiniteNumber(value)) return null;
                  const x = xAt(index);
                  const y0 = indicatorYAt(0, -macdMax, macdMax);
                  const y1 = indicatorYAt(value, -macdMax, macdMax);
                  return (
                    <line
                      key={`macd-${index}`}
                      x1={x}
                      x2={x}
                      y1={y0}
                      y2={y1}
                      stroke={value >= 0 ? "#22c55e" : "#ef4444"}
                      strokeWidth="3"
                      opacity="0.78"
                    />
                  );
                })}
                <text x={paddingX} y={height - 6} fill="#93c5fd" fontSize="10" fontWeight="900">
                  MACD histogram
                </text>
              </>
            ) : null}
          </g>
        ) : null}

        <text
          x={paddingX}
          y={priceHeight - 7}
          fill="rgba(203,213,225,0.58)"
          fontSize="10"
          fontWeight="700"
        >
          {firstDate}
        </text>
        <text
          x={width - paddingX}
          y={priceHeight - 7}
          textAnchor="end"
          fill="rgba(203,213,225,0.58)"
          fontSize="10"
          fontWeight="700"
        >
          {lastDate}
        </text>
      </svg>
    </div>
  );
}
