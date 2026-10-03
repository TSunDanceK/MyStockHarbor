import type { CSSProperties } from "react";

// -- Share dilution history ---------------------------------------------------
// Server-rendered "shares outstanding over time" chart. Since 2026-09-22 the
// series is the weighted-average basic share count from the company's own SEC
// filings (lib/server/secShareHistory.ts); it was FMP's income statement.
// Presentational only (no hooks, no "use client"),
// same pattern as CompanyProfile.tsx, so it renders into the crawlable initial
// HTML rather than behind a client fetch.

export type SharePoint = { date: string; shares: number };

export type DilutionHistoryData = {
  // Ascending by date, one point per reported period (see buildShareHistory in
  // lib/server/secShareHistory.ts; fetchShareHistory in page.tsx is retired),
  // so the chart reads as a trend rather than thousands of daily wiggles.
  points: SharePoint[];
  /**
   * Quarters, or fiscal years when too few quarters carry a share count.
   * Optional so a payload built the old way still renders; the footer then
   * names no basis.
   */
  basis?: "annual+quarters" | "quarter" | "year";
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

/**
 * THE Y-AXIS, WITH A FLOOR ON ITS SPAN (#535 COWORK #22 §3).
 *
 * TSM's share count has sat at about 25.93bn since 2019. Autoscaled to
 * min..max, rounding noise filled the whole plot and drew a five-year
 * "decline" with no labels — implying buybacks that never happened, on every
 * stable-share large cap. The axis now spans at least ±2.5% around the mean,
 * widened to take in the data; it is NOT anchored at zero, so real dilution
 * (a 15% rise) still fills the chart.
 */
export const SHARE_AXIS_MIN_HALF_SPAN = 0.025;

export function shareAxis(values: number[]): { lo: number; hi: number } {
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const lo = Math.min(minV, mean * (1 - SHARE_AXIS_MIN_HALF_SPAN));
  const hi = Math.max(maxV, mean * (1 + SHARE_AXIS_MIN_HALF_SPAN));
  return hi > lo ? { lo, hi } : { lo: lo - 1, hi: hi + 1 };
}

/**
 * THE CHANGE SINCE THE FIRST POINT, TO TWO DECIMALS (#535 COWORK #22 §4).
 * One decimal printed TSM's -0.02% as "-0.0%"; under 0.01% either way it is
 * "Unchanged". The Trend cell keeps its own "Roughly flat" band.
 */
export function formatShareChange(changePercent: number | null): string {
  if (typeof changePercent !== "number" || !Number.isFinite(changePercent)) return "—";
  if (Math.abs(changePercent) < 0.01) return "Unchanged";
  return `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%`;
}

/**
 * A SERIES THE CHART CANNOT SUMMARISE YET (#552 COWORK #89, interim guard).
 *
 * The annual points are as filed, so a split leaves older years on the old
 * basis: AMZN reads 494M then 10,005M at its 20:1 split, and PAC's count goes
 * x1000 from 2017 ("+96,037%"). Measured over 916 charted series (CODE-A #94):
 * 99 step at a whole split ratio, 65 step by more than 100x, 33 have a gap of
 * more than 15 months (GDDY 2016 -> 2023, drawn as a straight "rise").
 *
 * DETECTION ONLY, the probe's own rules: a step within 3% of a whole split
 * ratio either way, a step over 100x either way, or consecutive points more
 * than SHARE_GAP_MAX_DAYS apart. The line is still drawn; the "Since" and
 * Trend figures are withheld. The full fix (restated comparatives, broken
 * lines, the 3-year trend) replaces this after the purge. A real one-year
 * doubling also matches the 2x ratio and is withheld with the rest: hiding a
 * true figure for a week is the cheaper error than printing a false one.
 */
export const SHARE_SPLIT_RATIOS = [2, 3, 4, 5, 8, 10, 15, 20, 25, 40, 50];
export const SHARE_SPLIT_TOLERANCE = 0.03;
export const SHARE_SCALE_MAX_STEP = 100;
export const SHARE_GAP_MAX_DAYS = 460;

export function shareHistoryDefect(points: SharePoint[]): "scale-step" | "split-step" | "gap" | null {
  let found: "split-step" | "gap" | null = null;
  for (let i = 1; i < points.length; i++) {
    const r = points[i].shares / points[i - 1].shares;
    if (!Number.isFinite(r) || r <= 0) continue;
    if (r > SHARE_SCALE_MAX_STEP || r < 1 / SHARE_SCALE_MAX_STEP) return "scale-step";
    if (!found && SHARE_SPLIT_RATIOS.some((k) => Math.abs(r / k - 1) < SHARE_SPLIT_TOLERANCE || Math.abs(r * k - 1) < SHARE_SPLIT_TOLERANCE)) found = "split-step";
    const days = (Date.parse(points[i].date) - Date.parse(points[i - 1].date)) / 86_400_000;
    if (!found && days > SHARE_GAP_MAX_DAYS) found = "gap";
  }
  return found;
}

/** What the two withheld cells say instead. */
export const SHARE_HISTORY_WITHHELD = "Share history needs a correction; figures hidden for now";

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
  const defect = shareHistoryDefect(points);
  const isDilution = !defect && typeof changePercent === "number" && changePercent > 0.05;
  const isBuyback = !defect && typeof changePercent === "number" && changePercent < -0.05;
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
  // ROOM FOR THE THREE RIGHT-HAND AXIS LABELS.
  const padRight = 70;
  const padTop = 14;
  const padBottom = 26;
  const plotW = width - padX - padRight;
  const plotH = height - padTop - padBottom;

  const values = points.map((p) => p.shares);
  const { lo: minV, hi: maxV } = shareAxis(values);
  const span = maxV - minV;
  const axisTicks = [maxV, (maxV + minV) / 2, minV].map((v, i) => ({ v, y: padTop + (i / 2) * plotH }));
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
              {/* ONE STRING: React renders an array child of <title> with a warning. */}
              <title>{`${fmtDateShort(c.p.date)}: ${fmtShares(c.p.shares)} shares outstanding`}</title>
            </circle>
          ))}
          {axisTicks.map((t, i) => (
            <text key={`axis-${i}`} x={width - 2} y={t.y + 4} fontSize={11} fill="rgba(203,213,225,0.55)" textAnchor="end">
              {fmtShares(t.v)}
            </text>
          ))}
          <text x={padX} y={height - 8} fontSize={11} fill="rgba(203,213,225,0.55)">
            {fmtDateShort(first.date)}
          </text>
          <text x={padX + plotW} y={height - 8} fontSize={11} fill="rgba(203,213,225,0.55)" textAnchor="end">
            {fmtDateShort(last.date)}
          </text>
        </svg>
      </div>

      <div className="dh-stats-row">
        <div style={cellStyle}>
          <div style={cellLabelStyle}>Shares outstanding (latest)</div>
          <div style={cellValueStyle}>{fmtShares(last.shares)}</div>
        </div>
        {defect ? (
          // THE TWO CELLS GO TOGETHER: a Trend label read from the same broken
          // first-vs-last comparison would be the same wrong figure in words.
          <div className="dh-withheld" style={cellStyle} data-share-history-defect={defect}>
            <div style={cellLabelStyle}>Since {fmtDateShort(first.date)} · Trend</div>
            <div style={{ ...cellValueStyle, fontSize: 13 }}>{SHARE_HISTORY_WITHHELD}</div>
          </div>
        ) : (
          <>
            <div style={cellStyle}>
              <div style={cellLabelStyle}>Since {fmtDateShort(first.date)}</div>
              <div style={{ ...cellValueStyle, color: trendColor }}>
                {formatShareChange(changePercent)}
              </div>
            </div>
            <div style={cellStyle}>
              <div style={cellLabelStyle}>Trend</div>
              <div style={{ ...cellValueStyle, color: trendColor, fontSize: 13 }}>{trendLabel}</div>
            </div>
          </>
        )}
      </div>

      <div style={sourceStyle}>
        {data?.basis === "annual+quarters" ? (
          // THE OWNER'S WORDING (#517).
          <>Annual share counts from SEC filings, latest quarters appended. {symbol} — {points.length} data points
          from {fmtDateShort(first.date)} to {fmtDateShort(last.date)}.</>
        ) : (
          <>Weighted-average basic shares from {symbol}&apos;s own SEC filings
          {data?.basis === "year" ? ", by fiscal year" : data?.basis === "quarter" ? ", by quarter" : ""} —{" "}
          {points.length} data points from {fmtDateShort(first.date)} to {fmtDateShort(last.date)}.</>
        )}
        {/* FEWER POINTS THAN THE OLD CHART, AND WHY (owner, #517). The store
            keeps the last 12 quarters, and a fourth quarter has no share count
            of its own — a weighted average is not derived by subtraction — so
            it is not plotted. Retention is deliberately not widened. */}
        {data?.basis === "quarter"
          ? " Covers the last 12 quarters on file; fourth quarters have no separately filed share count and are not plotted."
          : data?.basis === "year" ? " Covers the fiscal years on file." : ""}
      </div>

      <style>{`
        .dh-stats-row {
          margin-top: 16px;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        .dh-withheld { grid-column: span 2; }
        @media (max-width: 640px) {
          .dh-stats-row { grid-template-columns: 1fr !important; }
          .dh-withheld { grid-column: auto; }
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
