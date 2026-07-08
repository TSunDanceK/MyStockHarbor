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

// Full wedge outline: center -> rim -> (arc) -> rim -> back to center. Used
// for both the muted fill and, drawn again on top with no fill, the glowing
// neon outline - so the "depth" comes from a bright edge over a dark
// interior rather than a real 3D extrusion.
function wedgePath(
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
  if (labelLength <= 0 || sweepDeg <= 16) return false;
  const sweepRad = (sweepDeg * Math.PI) / 180;
  const chordWidth = 2 * labelRadius * Math.sin(sweepRad / 2);
  const estimatedTextWidth = labelLength * fontSize * 0.64;
  return chordWidth > estimatedTextWidth + 4;
}

export default function BottleneckPieChart({
  segments,
  size = 240,
}: {
  segments: PieSegment[];
  size?: number;
}) {
  const total = segments.reduce((sum, s) => sum + s.pct, 0) || 1;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 10;
  const labelRadius = r * 0.62;
  const fontSize = Math.max(9, Math.min(12, size * 0.05));
  const glowId = "bnGlow2d";

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
          <feGaussianBlur in="SourceGraphic" stdDeviation={size * 0.012} result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* dark backing disc so the glow has somewhere to bleed into */}
      <circle cx={cx} cy={cy} r={r + 3} fill="#06080d" />

      {/* muted, darker fills - this is where the "depth" reads as darker */}
      {computed.map((segment) => (
        <path
          key={`fill-${segment.index}`}
          d={wedgePath(cx, cy, r, segment.startAngle, segment.endAngle)}
          fill={segment.color}
          fillOpacity={0.5}
        >
          <title>
            {segment.name}
            {segment.ticker ? ` (${segment.ticker})` : ""} - {segment.pct}%
          </title>
        </path>
      ))}

      {/* bright glowing neon outline on top - the rim arc AND the radial
          dividers between slices both come from this same stroked path */}
      {computed.map((segment) => (
        <path
          key={`stroke-${segment.index}`}
          d={wedgePath(cx, cy, r, segment.startAngle, segment.endAngle)}
          fill="none"
          stroke={segment.color}
          strokeWidth={2.25}
          strokeLinejoin="round"
          filter={`url(#${glowId})`}
        />
      ))}

      {/* ticker labels, only where they fit neatly */}
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
            fill="#f8fafc"
            style={{ pointerEvents: "none" }}
          >
            {segment.label}
          </text>
        ) : null
      )}
    </svg>
  );
}
