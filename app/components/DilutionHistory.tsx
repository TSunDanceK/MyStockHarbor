import type { CSSProperties } from "react";

// -- Share dilution history ---------------------------------------------------
// Server-rendered "shares outstanding over time" chart built from FMP's
// historical share-float data. Presentational only (no hooks, no "use client"),
// same pattern as CompanyProfile.tsx, so it renders into the crawlable initial
// HTML rather than behind a client fetch.

export type SharePoint = { date: string; shares: number };

export type DilutionHistoryData = {
  // Ascending by date, already downsampled server-side (see fetchShareHistory
  // in page.tsx) to roughly one point per quarter so the chart reads as a
  // trend rather than thousands of daily wiggles.
  points: SharePoint[];
};

function fmtShares(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

function fmtDateShort(value: string | null) {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(d);
}

const GREEN = "#22c55e";
const RED = "#ef4444";
const BLUE = "#60a5fa";

export default function DilutionHistory({
  data,
  symbol,
  embedded,
}: {
  data: DilutionHistoryData | null;
  symbol: string;
  // true when rendered inside another card (currently: CompanyProfile's
  // description column, filling the space that column would otherwise
  // leave empty next to the taller stat-box column) rather than as its own
  // standalone full-width section further down the page. Drops the
  // section-level border/heading spacing that would otherwise double up
  // with the parent card's own border.
  embedded?: boolean;
}) {
  const points = data?.points ?? [];
  // Need a real spread of points to show a meaningful trend — a single
  // snapshot (or FMP returning nothing usable) isn't a "history".
  if (points.length < 3) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const changePercent =
    first.shares > 0 ? ((last.shares - first.shares) / first.shares) * 100 : null;
  const isDilution = typeof changePercent === "number" && changePercent > 0.05;
  const isBuyback = typeof changePercent === "number" && changePercent < -0.05;
  const trendColor = isDilution ? RED : isBuyback ? GREEN : BLUE;
  const trendLabel = isDilution
    ? "More shares outstanding"
    : isBuyback
    ? "Fewer shares outstanding (buybacks)"
    : "Roughly flat";

  // -- Chart geometry (server-rendered SVG, no client JS) --------------------
  // viewBox is a fixed aspect ratio; actual rendered size always scales to
  // 100% of whatever column it's placed in (full middle column standalone,
  // or the narrower description column when embedded).
  const width = 900;
  const height = 220;
  const padX = 6;
  const padTop = 14;
  const padBottom = 26;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;

  const values = points.map((p) => p.shares);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const span = maxV - minV || 1;
  const denom = points.length > 1 ? points.length - 1 : 1;

  const coords = points.map((p, i) => {
    const x = padX + (i / denom) * plotW;
    const y = padTop + (1 - (p.shares - minV) / span) * plotH;
    return { x, y, p };
  });

  const polyline = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const areaPath =
    `M ${coords[0].x.toFixed(1)} ${(padTop + plotH).toFixed(1)} ` +
    coords.map((c) => `L ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ") +
    ` L ${coords[coords.length - 1].x.toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`;

  const gradientId = `dilutionArea-${symbol}${embedded ? "-embedded" : ""}`;

  const body = (
    <>
      <div style={eyebrowStyle}>Share dilution</div>
      <h2 style={embedded ? embeddedHeadingStyle : headingStyle}>{symbol} shares outstanding over time</h2>
      <p style={subStyle}>
        Tracking total shares outstanding is one way to spot dilution — a rising line means the company
        has issued more shares (stock-based compensation, secondary offerings, convertible debt), which
        spreads the same earnings and ownership across more shares. A falling line usually reflects
        buybacks.
      </p>

      <div style={{ marginTop: 18 }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="img"
          aria-label={`${symbol} shares outstanding from ${fmtDateShort(first.date)} to ${fmtDateShort(last.date)}`}
          style={{ width: "100%", height: "auto", maxWidth: "100%", display: "block" }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={trendColor} stopOpacity={0.35} />
              <stop offset="100%" stopColor={trendColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradientId})`} />
          <polyline
            points={polyline}
            fill="none"
            stroke={trendColor}
            strokeWidth={2.25}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {coords.map((c, i) => (
            <circle key={i} cx={c.x} cy={c.y} r={i === coords.length - 1 ? 3.5 : 2} fill={trendColor}>
              <title>
                {fmtDateShort(c.p.date)}: {fmtShares(c.p.shares)} shares outstanding
              </title>
            </circle>
          ))}
          <text x={padX} y={height - 8} fontSize={11} fill="rgba(203,213,225,0.55)">
            {fmtDateShort(first.date)}
          </text>
          <text x={width - padX} y={height - 8} fontSize={11} fill="rgba(203,213,225,0.55)" textAnchor="end">
            {fmtDateShort(last.date)}
          </text>
        </svg>
      </div>

      <div className="dh-stats-row">
        <div style={cellStyle}>
          <div style={cellLabelStyle}>Shares outstanding (latest)</div>
          <div style={cellValueStyle}>{fmtShares(last.shares)}</div>
        </div>
        <div style={cellStyle}>
          <div style={cellLabelStyle}>Since {fmtDateShort(first.date)}</div>
          <div style={{ ...cellValueStyle, color: trendColor }}>
            {typeof changePercent === "number"
              ? `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(1)}%`
              : "—"}
          </div>
        </div>
        <div style={cellStyle}>
          <div style={cellLabelStyle}>Trend</div>
          <div style={{ ...cellValueStyle, color: trendColor, fontSize: 13 }}>{trendLabel}</div>
        </div>
      </div>

      <div style={sourceStyle}>
        Historical shares-outstanding data from Financial Modeling Prep. {symbol} — {points.length} data points
        from {fmtDateShort(first.date)} to {fmtDateShort(last.date)}.
      </div>

      <style>{`
        .dh-stats-row {
          margin-top: 16px;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        @media (max-width: 640px) {
          .dh-stats-row { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </>
  );

  if (embedded) {
    return <div style={{ marginTop: 24 }}>{body}</div>;
  }

  return (
    <section style={{ marginTop: 32, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 24 }}>
      {body}
    </section>
  );
}

const eyebrowStyle: CSSProperties = { fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(147,197,253,0.82)", marginBottom: 6 };
const headingStyle: CSSProperties = { margin: 0, fontSize: 22, lineHeight: 1.15, letterSpacing: "-0.025em", fontWeight: 700 };
const embeddedHeadingStyle: CSSProperties = { margin: 0, fontSize: 17, lineHeight: 1.2, letterSpacing: "-0.02em", fontWeight: 700 };
const subStyle: CSSProperties = { marginTop: 10, marginBottom: 0, fontSize: 14, lineHeight: 1.7, color: "rgba(241,245,249,0.72)", maxWidth: 760 };
const cellStyle: CSSProperties = { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "10px 12px", background: "rgba(255,255,255,0.02)", minWidth: 0 };
const cellLabelStyle: CSSProperties = { fontSize: 10, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(148,163,184,0.62)" };
const cellValueStyle: CSSProperties = { marginTop: 4, fontSize: 14, fontWeight: 800, letterSpacing: "-0.01em", color: "#f1f5f9", overflowWrap: "anywhere" };
const sourceStyle: CSSProperties = { marginTop: 12, fontSize: 11, lineHeight: 1.5, color: "rgba(203,213,225,0.55)" };
