export type PieSegment = {
  name: string;
  ticker: string | null;
  pct: number;
  color: string;
};

// 10 deliberately spread-out neon hues (36deg apart around the wheel) so no
// two colors read as "similar" even at a glance.
export const NEON_PALETTE = [
  "#FF4D4D", // neon red
  "#FF9F1C", // neon orange
  "#D6FF33", // neon chartreuse / lime
  "#33FF7A", // neon green
  "#33FFC7", // neon spring green / teal
  "#33F0FF", // neon cyan
  "#338FFF", // neon azure blue
  "#7A33FF", // neon blue-violet / indigo
  "#C733FF", // neon purple / magenta
  "#FF33A8", // neon pink / rose
];

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

function arcPath(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

// Only place a ticker label inside a slice if it will actually fit neatly -
// estimated from the chord width available at the label's radius versus the
// rough rendered width of the ticker text.
function canFitLabel(
  sweepDeg: number,
  labelLength: number,
  labelRadius: number,
  fontSize: number
) {
  if (labelLength <= 0 || sweepDeg <= 14) return false;
  const sweepRad = (sweepDeg * Math.PI) / 180;
  const chordWidth = 2 * labelRadius * Math.sin(sweepRad / 2);
  const estimatedTextWidth = labelLength * fontSize * 0.64;
  return chordWidth > estimatedTextWidth + 4;
}

export default function BottleneckPieChart({
  segments,
  size = 220,
}: {
  segments: PieSegment[];
  size?: number;
}) {
  const total = segments.reduce((sum, s) => sum + s.pct, 0) || 1;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 8;
  const labelRadius = r * 0.68;
  const fontSize = Math.max(9, Math.min(12, size * 0.05));
  const glowId = "bnGlow";
  const gradientPrefix = "bnGrad";

  let cumulativeAngle = 0;

  const computed = segments.map((segment, index) => {
    const sweep = (segment.pct / total) * 360;
    const startAngle = cumulativeAngle;
    const endAngle = cumulativeAngle + sweep;
    const midAngle = (startAngle + endAngle) / 2;
    cumulativeAngle = endAngle;

    const label = segment.ticker ?? "";
    const labelPos = polarToCartesian(cx, cy, labelRadius, midAngle);
    const showLabel = canFitLabel(sweep, label.length, labelRadius, fontSize);

    return { ...segment, index, startAngle, endAngle, label, labelPos, showLabel };
  });

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label="Dependency breakdown pie chart"
    >
      <defs>
        <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur in="SourceGraphic" stdDeviation={size * 0.02} result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {computed.map((segment) => (
          <radialGradient
            key={`${gradientPrefix}-${segment.index}`}
            id={`${gradientPrefix}-${segment.index}`}
            gradientUnits="userSpaceOnUse"
            cx={cx - r * 0.25}
            cy={cy - r * 0.3}
            r={r * 1.2}
          >
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0.45} />
            <stop offset="45%" stopColor={segment.color} stopOpacity={1} />
            <stop offset="100%" stopColor={segment.color} stopOpacity={0.94} />
          </radialGradient>
        ))}
      </defs>

      {/* Dark halo behind the disc so the glow has somewhere to bleed into */}
      <circle cx={cx} cy={cy} r={r + 4} fill="#06080d" />

      {computed.map((segment) => (
        <path
          key={`${segment.ticker ?? segment.name}-${segment.index}`}
          d={arcPath(cx, cy, r, segment.startAngle, segment.endAngle)}
          fill={`url(#${gradientPrefix}-${segment.index})`}
          stroke="#06080d"
          strokeWidth={2}
          filter={`url(#${glowId})`}
        >
          <title>
            {segment.name}
            {segment.ticker ? ` (${segment.ticker})` : ""} - {segment.pct}%
          </title>
        </path>
      ))}

      {computed.map((segment) =>
        segment.showLabel ? (
          <text
            key={`label-${segment.index}`}
            x={segment.labelPos.x}
            y={segment.labelPos.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={fontSize}
            fontWeight={800}
            fill="#06080d"
            style={{ pointerEvents: "none" }}
          >
            {segment.label}
          </text>
        ) : null
      )}
    </svg>
  );
}
