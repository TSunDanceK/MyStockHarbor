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
  idPrefix = "a",
}: {
  segments: PieSegment[];
  size?: number;
  // Distinguishes this chart instance's glow filter id from any other
  // BottleneckPieChart rendered on the same page (e.g. the supply-chain
  // and customer-concentration charts on a bottleneck ticker page) so two
  // instances never define the same DOM id="..." twice - this used to be
  // a hardcoded constant shared by every instance.
  idPrefix?: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.pct, 0) || 1;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 10;
  const labelRadius = r * 0.62;
  const fontSize = Math.max(9, Math.min(12, size * 0.05));
  const glowId = `bnGlow2d-${idPrefix}`;

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
    const tooltip = `${segment.name}${segment.ticker ? ` (${segment.ticker})` : ""} - ${segment.pct}%`;

    return { ...segment, index, startAngle, endAngle, label, labelPos, showLabel, tooltip };
  });

  return (
    // Wrapper caps the chart at its natural size on wide screens but lets it
    // shrink to fit a narrow phone-width container. The SVG keeps its real
    // width/height attributes (240x240) as an intrinsic-size fallback so
    // browsers that don't resolve percentage sizing cleanly on a bare
    // viewBox-only SVG don't fall back to an oversized default render - the
    // CSS width/height below is what actually makes it responsive, capped
    // by the wrapper's maxWidth and further clamped by minWidth: 0 so it
    // can shrink inside flex/grid ancestors instead of forcing them wider.
    <div style={{ width: "100%", maxWidth: size, minWidth: 0, margin: "0 auto" }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="img"
        aria-label="Dependency breakdown pie chart"
        style={{ width: "100%", height: "auto", maxWidth: "100%", display: "block" }}
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

        {/* muted, darker fills - this is where the "depth" reads as darker.
            The hover tooltip is a plain `title` attribute (not a nested
            <title> element) - React 19's document-metadata handling can
            special-case a rendered <title> element and strip its text
            during SSR when the page already has its own real <head> title,
            which produced empty <title></title> tags server-side and a
            React hydration mismatch (error #418) once the client filled
            them back in. A plain attribute isn't a "title" element, so
            it's never touched by that logic, and browsers still show the
            same native tooltip on hover. */}
        {computed.map((segment) => (
          <path
            key={`fill-${segment.index}`}
            d={wedgePath(cx, cy, r, segment.startAngle, segment.endAngle)}
            fill={segment.color}
            fillOpacity={0.5}
            title={segment.tooltip}
          />
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
    </div>
  );
}
