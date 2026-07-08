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

function ellipsePoint(
  cx: number,
  cyBase: number,
  rx: number,
  ry: number,
  angleDeg: number
) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + rx * Math.cos(angleRad),
    y: cyBase + ry * Math.sin(angleRad),
  };
}

// The flat, filled "top of the disc" wedge (center -> rim -> rim -> center).
function wedgeTopPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  startAngle: number,
  endAngle: number
) {
  const start = ellipsePoint(cx, cy, rx, ry, endAngle);
  const end = ellipsePoint(cx, cy, rx, ry, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${rx} ${ry} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

// Just the outer rim arc (no center point) - used for the glowing rim outline.
function wedgeRimArc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  startAngle: number,
  endAngle: number
) {
  const start = ellipsePoint(cx, cy, rx, ry, endAngle);
  const end = ellipsePoint(cx, cy, rx, ry, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [`M ${start.x} ${start.y}`, `A ${rx} ${ry} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`].join(
    " "
  );
}

// The curved "side wall" band connecting the top rim to a lower, offset rim -
// this is what makes the disc read as an extruded cylinder rather than a flat
// circle. Drawing every wedge's wall first, then every wedge's top face on
// top, naturally hides the "back" walls under the front top faces without
// needing real 3D visibility sorting.
function wedgeWallPath(
  cx: number,
  cyTop: number,
  cyBottom: number,
  rx: number,
  ry: number,
  startAngle: number,
  endAngle: number
) {
  const topA = ellipsePoint(cx, cyTop, rx, ry, startAngle);
  const topB = ellipsePoint(cx, cyTop, rx, ry, endAngle);
  const botA = ellipsePoint(cx, cyBottom, rx, ry, startAngle);
  const botB = ellipsePoint(cx, cyBottom, rx, ry, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    `M ${topA.x} ${topA.y}`,
    `A ${rx} ${ry} 0 ${largeArcFlag} 1 ${topB.x} ${topB.y}`,
    `L ${botB.x} ${botB.y}`,
    `A ${rx} ${ry} 0 ${largeArcFlag} 0 ${botA.x} ${botA.y}`,
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
  size = 260,
}: {
  segments: PieSegment[];
  size?: number;
}) {
  const total = segments.reduce((sum, s) => sum + s.pct, 0) || 1;

  const width = size;
  const height = size * 0.72;
  const cx = width / 2;
  const rx = width * 0.4;
  const ry = rx * 0.5;
  const depth = rx * 0.22;
  const cyTop = height * 0.4;
  const cyBottom = cyTop + depth;
  const explode = size * 0.018;
  const labelRadius = rx * 0.6;
  const fontSize = Math.max(9, Math.min(12, size * 0.048));
  const glowId = "bnGlow3d";
  const gradPrefix = "bnGrad3d";
  const wallGradPrefix = "bnWallGrad3d";

  let cumulativeAngle = 0;

  const computed = segments.map((segment, index) => {
    const sweep = (segment.pct / total) * 360;
    const startAngle = cumulativeAngle;
    const endAngle = cumulativeAngle + sweep;
    const midAngle = (startAngle + endAngle) / 2;
    cumulativeAngle = endAngle;

    const midRad = ((midAngle - 90) * Math.PI) / 180;
    const dx = Math.cos(midRad) * explode;
    const dy = Math.sin(midRad) * explode * (ry / rx);

    const label = segment.ticker ?? "";
    const labelBase = ellipsePoint(cx, cyTop, labelRadius, labelRadius * (ry / rx), midAngle);
    const labelPos = { x: labelBase.x + dx, y: labelBase.y + dy };
    const showLabel = canFitLabel(sweep, label.length, labelRadius, fontSize);

    return { ...segment, index, startAngle, endAngle, dx, dy, label, labelPos, showLabel };
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label="Dependency breakdown pie chart"
    >
      <defs>
        <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur in="SourceGraphic" stdDeviation={size * 0.014} result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {computed.map((segment) => (
          <radialGradient
            key={`${gradPrefix}-${segment.index}`}
            id={`${gradPrefix}-${segment.index}`}
            gradientUnits="userSpaceOnUse"
            cx={cx - rx * 0.22}
            cy={cyTop - ry * 0.3}
            r={rx * 1.15}
          >
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0.5} />
            <stop offset="42%" stopColor={segment.color} stopOpacity={1} />
            <stop offset="100%" stopColor={segment.color} stopOpacity={0.92} />
          </radialGradient>
        ))}

        {computed.map((segment) => (
          <linearGradient
            key={`${wallGradPrefix}-${segment.index}`}
            id={`${wallGradPrefix}-${segment.index}`}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor={segment.color} stopOpacity={0.8} />
            <stop offset="100%" stopColor="#06080d" stopOpacity={0.55} />
          </linearGradient>
        ))}
      </defs>

      {/* dark backing disc so the glow has somewhere to bleed into */}
      <ellipse cx={cx} cy={cyBottom} rx={rx + 3} ry={ry + 3} fill="#06080d" />

      {/* side walls - drawn first so the top faces cover the "back" halves */}
      {computed.map((segment) => (
        <g key={`wall-${segment.index}`} transform={`translate(${segment.dx} ${segment.dy})`}>
          <path
            d={wedgeWallPath(cx, cyTop, cyBottom, rx, ry, segment.startAngle, segment.endAngle)}
            fill={`url(#${wallGradPrefix}-${segment.index})`}
          />
        </g>
      ))}

      {/* top faces */}
      {computed.map((segment) => (
        <g key={`top-${segment.index}`} transform={`translate(${segment.dx} ${segment.dy})`}>
          <path
            d={wedgeTopPath(cx, cyTop, rx, ry, segment.startAngle, segment.endAngle)}
            fill={`url(#${gradPrefix}-${segment.index})`}
            stroke="#06080d"
            strokeWidth={1.5}
            filter={`url(#${glowId})`}
          >
            <title>
              {segment.name}
              {segment.ticker ? ` (${segment.ticker})` : ""} - {segment.pct}%
            </title>
          </path>
        </g>
      ))}

      {/* glowing neon rim outline along each slice's outer top edge */}
      {computed.map((segment) => (
        <g key={`rim-${segment.index}`} transform={`translate(${segment.dx} ${segment.dy})`}>
          <path
            d={wedgeRimArc(cx, cyTop, rx, ry, segment.startAngle, segment.endAngle)}
            fill="none"
            stroke={segment.color}
            strokeWidth={2}
            strokeLinecap="round"
            filter={`url(#${glowId})`}
            opacity={0.95}
          />
        </g>
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
