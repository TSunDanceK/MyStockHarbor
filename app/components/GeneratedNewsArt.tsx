// The generated data card: what a news card shows when there is no library art.
//
// Step 0 of claude/news-adapter-spec-2026-09-13.md, §6. It replaced the
// publisher thumbnail, which the site had no right to display (see
// lib/news-image-policy.ts).
//
// ── WHY IT IS AN INLINE SVG AND NOT AN IMAGE FILE ──────────────────────────
// It is generated from data the page has already loaded -- ticker, price move,
// sparkline -- so there is nothing to fetch, nothing to cache and nothing to
// 404. It also costs no request, which matters on the compact feed where ten of
// them render at once.
//
// ── WHY IT IS THE BETTER PRODUCT ON THE COMPACT ROWS, NOT A CONSOLATION ────
// The spec's reasoning, worth keeping next to the code: at 56px a generated card
// showing the ticker and the move is legible, and a shrunk illustration of a
// silicon wafer is not. So the compact rows take this ALWAYS, even once the
// library is full -- it is not a fallback there, it is the design.
//
// Sizing follows claude/image-policy-2026-09-13.md: explicit width and height on
// every graphic so nothing shifts as the page settles. An SVG with a viewBox and
// fixed dimensions reserves its box immediately.
import type { CSSProperties } from "react";

export type GeneratedArtProps = {
  symbol: string;
  /** Percent change over the sparkline window. null renders the flat state. */
  changePct: number | null;
  /** Closing prices, oldest first. Fewer than two points renders no line. */
  points: number[];
  variant: "lead" | "compact";
  style?: CSSProperties;
};

const UP = "#4ade80";
const DOWN = "#f87171";
const FLAT = "rgba(241,245,249,0.55)";

/**
 * The sparkline path.
 *
 * NORMALISED TO ITS OWN RANGE, not to zero: these windows move a few percent and
 * a zero-baselined line would be a flat rule on every card. A completely flat
 * series is drawn down the middle rather than dividing by zero.
 */
function sparkPath(values: number[], w: number, h: number, padY: number): string {
  if (values.length < 2) return "";

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const usable = h - padY * 2;

  return values
    .map((value, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = span === 0 ? h / 2 : padY + (1 - (value - min) / span) * usable;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

/** At most `max` points, evenly sampled. Keeps the path short in the markup. */
function sample(values: number[], max: number): number[] {
  const clean = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (clean.length <= max) return clean;
  const step = (clean.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => clean[Math.round(i * step)]);
}

export default function GeneratedNewsArt({
  symbol, changePct, points, variant, style,
}: GeneratedArtProps) {
  const compact = variant === "compact";
  const w = compact ? 56 : 1200;
  const h = compact ? 56 : 675;

  const tone = changePct == null ? FLAT : changePct >= 0 ? UP : DOWN;
  const move =
    changePct == null
      ? "—"
      : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(compact ? 0 : 1)}%`;

  const line = sparkPath(sample(points, compact ? 16 : 60), w, compact ? h * 0.5 : h * 0.42, compact ? 6 : 40);
  const gradientId = `nag-${variant}-${symbol.replace(/[^A-Za-z0-9]/g, "")}`;

  return (
    <svg
      // Decorative: the headline beside it carries the meaning, and the ticker
      // and move are both already rendered as text elsewhere on the card.
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      style={style}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tone} stopOpacity={compact ? 0.20 : 0.16} />
          <stop offset="100%" stopColor={tone} stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width={w} height={h} fill="#0b1220" />
      <rect x="0" y="0" width={w} height={h} fill={`url(#${gradientId})`} />

      {line ? (
        <g transform={`translate(0 ${compact ? h * 0.42 : h * 0.5})`}>
          <path
            d={line}
            fill="none"
            stroke={tone}
            strokeWidth={compact ? 2.5 : 6}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity="0.9"
          />
        </g>
      ) : null}

      {compact ? (
        // 56px: the ticker on one line, the move under it. Nothing else fits,
        // and anything else would be decoration rather than information.
        <g>
          <text
            x="28" y="24" textAnchor="middle"
            fontFamily="system-ui, Arial" fontSize="15" fontWeight="800"
            fill="#f8fafc"
          >
            {symbol.slice(0, 5)}
          </text>
          <text
            x="28" y="40" textAnchor="middle"
            fontFamily="system-ui, Arial" fontSize="12" fontWeight="800"
            fill={tone}
          >
            {move}
          </text>
        </g>
      ) : (
        <g>
          <text
            x="64" y="150"
            fontFamily="system-ui, Arial" fontSize="132" fontWeight="900"
            letterSpacing="-6" fill="#f8fafc"
          >
            {symbol}
          </text>
          <text
            x="64" y="250"
            fontFamily="system-ui, Arial" fontSize="72" fontWeight="800"
            fill={tone}
          >
            {move}
          </text>
          <text
            x="64" y="318"
            fontFamily="system-ui, Arial" fontSize="34" fontWeight="700"
            fill="rgba(241,245,249,0.50)"
          >
            recent price action
          </text>
        </g>
      )}

      <rect
        x="0" y="0" width={w} height={h}
        fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={compact ? 2 : 4}
      />
    </svg>
  );
}
