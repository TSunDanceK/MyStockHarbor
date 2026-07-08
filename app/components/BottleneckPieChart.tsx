export type PieSegment = {
  name: string;
  ticker: string | null;
  pct: number;
  color: string;
};

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
  const r = size / 2 - 4;

  let cumulativeAngle = 0;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label="Dependency breakdown pie chart"
    >
      {segments.map((segment, index) => {
        const sweep = (segment.pct / total) * 360;
        const startAngle = cumulativeAngle;
        const endAngle = cumulativeAngle + sweep;
        cumulativeAngle = endAngle;
        const label = segment.ticker
          ? `${segment.name} (${segment.ticker})`
          : segment.name;

        return (
          <path
            key={`${segment.ticker ?? segment.name}-${index}`}
            d={arcPath(cx, cy, r, startAngle, endAngle)}
            fill={segment.color}
            stroke="#06080d"
            strokeWidth={1.5}
          >
            <title>
              {label} - {segment.pct}%
            </title>
          </path>
        );
      })}
    </svg>
  );
}
