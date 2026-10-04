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
  /** The series' corrections and its 3-year figure (lib/server/secShareHistory.ts, #552 COWORK #89). */
  gaps?: { from: string; to: string }[];
  splits?: { date: string; ratio: number }[];
  dropped?: string[];
  startedAfter?: { date: string; reason: "unexplained-split-step" | "scale-step" | "listing" | "unmatched-split"; ratio?: number };
  /** Fiscal-year-average points, by date (#552 COWORK #136); the rest are quarterly. */
  yearEnds?: string[];
  /** Fiscal years left out as another basis, by date. */
  refusedYears?: string[];
  withheld?:
    | { reason: "units-unconfirmed"; factor: number | null }
    | { reason: "cut-too-short"; factor: null; cut?: "unexplained-split-step" | "scale-step" | "listing" | "unmatched-split"; since?: string };
  threeYear?: { pct: number; base: SharePoint; end?: SharePoint } | { pct: null; reason: "too-short" };
};

function fmtShares(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

/** "27 Dec 2025": the 3-year window's own ends, to the day (#552 COWORK #120). */
function fmtDateDay(value: string) {
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
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
 *
 * ±10% SINCE #552 COWORK #136: at ±2.5% AAPL's −5.5% over two and a half years
 * filled the whole plot and read as dramatic as a doubling. At ±10% a 5% drift
 * takes about a quarter of the height, and a heavy diluter (+100%) still fills it.
 */
export const SHARE_AXIS_MIN_HALF_SPAN = 0.1;

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
 * THE TREND, FROM THE LAST 3 YEARS (#552 COWORK #88/#89 §5). The colour and
 * the words come from the 3-year figure, never first-vs-last: GDDY rose to its
 * IPO and has shrunk its count ever since. Hedged: a description of the count,
 * never a judgement. Within ±SHARE_FLAT_PCT it is "roughly unchanged".
 */
export const SHARE_FLAT_PCT = 1;
export function threeYearWords(pct: number | null, phrase: string = LAST_3_YEARS): { label: string; tone: "up" | "down" | "flat" | "none" } {
  if (pct === null || !Number.isFinite(pct)) return { label: "Recent history too short", tone: "none" };
  if (pct > SHARE_FLAT_PCT) return { label: `Share count has risen over ${phrase}`, tone: "up" };
  if (pct < -SHARE_FLAT_PCT) return { label: `Share count has fallen over ${phrase}`, tone: "down" };
  return { label: `Share count roughly unchanged over ${phrase}`, tone: "flat" };
}

/**
 * THE SPAN, NAMED AS LONG AS IT IS (#552 COWORK #141). The trend window's base
 * may sit up to 6 months before the 3-year cut, and its end up to 6 months
 * before the newest point, so a "3-year" figure can span 3½ years (BKNG: Dec
 * 2022 to Jun 2026). Within ±3 months of 3 years, ending at the newest point,
 * it is "the last 3 years"; otherwise its length to the quarter-year, "3½ years".
 */
export const LAST_3_YEARS = "the last 3 years";
export const SPAN_3_YEARS_TOLERANCE_DAYS = 92;
export function spanPhrase(baseDate: string, endDate: string, endIsNewest: boolean): string {
  const d = (Date.parse(endDate) - Date.parse(baseDate)) / 86_400_000;
  if (endIsNewest && Math.abs(d - 3 * 365.25) <= SPAN_3_YEARS_TOLERANCE_DAYS) return LAST_3_YEARS;
  const q = Math.round((d / 365.25) * 4) / 4;
  const whole = Math.floor(q);
  const frac = ["", "¼", "½", "¾"][Math.round((q - whole) * 4)];
  return `${whole}${frac} years`;
}

/**
 * THE HEADLINE OVER THE CHART (#552 COWORK #136 (b)): the move in words, with
 * an arrow, hedged. From the 3-year figure where there is one, else since the
 * first point. Direction is in the arrow AND the words, never colour alone.
 */
/**
 * THE SAME SPAN AS THE TILE (#552 COWORK #138): where the 3-year window's end
 * stepped back from the newest point to find a base (COWORK #120), the
 * headline names that window, as the tile does, rather than "the last 3 years".
 */
export const NEWEST_SPAN_WORDS = "the newest span on file";

export function shareHeadline(
  three: { pct: number; from: string; to: string; endIsNewest: boolean; phrase: string } | null,
  sincePct: number | null,
  since: string | null,
): string | null {
  const pct = three ? three.pct : sincePct;
  if (pct === null || !Number.isFinite(pct)) return null;
  const when = three
    ? three.phrase === LAST_3_YEARS
      ? `over ${LAST_3_YEARS}`
      : `over ${three.phrase}, from ${three.from} to ${three.to}${three.endIsNewest ? "" : `, ${NEWEST_SPAN_WORDS}`},`
    : since ? `since ${since}` : "";
  // "–", NOT "≈": that glyph is reserved for estimates (check-estimate-glyph-reserved).
  if (Math.abs(pct) <= SHARE_FLAT_PCT) return `– Share count roughly unchanged ${when.replace(/,$/, "")}`.trim();
  return pct < 0
    ? `▼ Down ${Math.abs(pct).toFixed(1)}% ${when.replace(/,$/, "")}, which may reflect buybacks`
    : `▲ Up ${pct.toFixed(1)}% ${when.replace(/,$/, "")}: more shares can spread the same earnings and ownership thinner`;
}

/** "20-for-1" / "1-for-10". */
export function splitWords(ratio: number): string {
  return ratio >= 1 ? `${Math.round(ratio)}-for-1` : `1-for-${Math.round(1 / ratio)}`;
}

/**
 * WHY NO CHART (#552 COWORK #121): the filed counts couldn't be confirmed in
 * the units the cover page uses. Said instead of drawing a count that may be
 * off by a thousand times.
 */
export function withheldWords(w: NonNullable<DilutionHistoryData["withheld"]>): string {
  // A SERIES THE CORRECTIONS CUT BELOW THREE POINTS (#552 COWORK #132 (d)).
  if (w.reason === "cut-too-short") {
    if (w.cut === "listing") return "Not drawn: fewer than three share counts have been filed since the company's first report after listing, too few to show a trend.";
    if (w.cut) return `Not drawn: an earlier step in the filed share counts couldn't be matched to a split the company restated, and the counts since${w.since ? ` ${fmtDateShort(w.since)}` : ""} are too few to show a trend.`;
    return "Not drawn: after leaving out filed figures that were off by a factor of 100 or more, too few share counts remain to show a trend.";
  }
  return w.factor !== null
    ? `Not drawn: the share counts in this company's filings don't agree with the count on its latest cover page (they differ by a factor of 300 or more), so we can't confirm which units they're in.`
    : "Not drawn: the filed share counts jump by more than 100 times at one point, and there's no cover-page count to confirm which side is in the right units.";
}

/** The notes the source line carries for a corrected series (#552 COWORK #89 §1–4). */
export function seriesNotes(data: DilutionHistoryData): string[] {
  const out: string[] = [];
  for (const s of data.splits ?? []) {
    // NO DATE (#552 COWORK #138): s.date is where the step sits in the series
    // (a fiscal year-end), not when the split took effect, and the stored set
    // carries no effective date. AAPL read "Sept 2012" for its June 2014 7-for-1.
    out.push(`Earlier counts are adjusted for a ${splitWords(s.ratio)} split, using the company's own restated figures.`);
  }
  const st = data.startedAfter;
  if (st?.reason === "listing") out.push("Starts at the company's first report after listing.");
  else if (st?.reason === "unmatched-split") out.push(`Starts ${fmtDateShort(st.date)}: the company restated its earlier counts for a ${splitWords(st.ratio ?? 1)} split, but the step before this point doesn't match it, so the chart doesn't draw across it.`);
  else if (st) out.push(`Starts ${fmtDateShort(st.date)}: an earlier step in the filed counts couldn't be matched to a split the company restated, so the chart doesn't draw across it.`);
  const dropped = data.dropped ?? [];
  if (dropped.length === 1) out.push(`The filed figure for ${fmtDateShort(dropped[0])} is left out: it was off by a factor of 100 or more from the figures either side.`);
  else if (dropped.length > 1) out.push(`${dropped.length} filed figures (${dropped.map((d) => fmtDateShort(d)).join(", ")}) are left out: each was off by a factor of 100 or more from the figures either side.`);
  if (data.gaps?.length) out.push("A break in the line marks more than 15 months with no filing data.");
  return out;
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
  if (data?.withheld) {
    const said = (
      <>
        <div style={eyebrowStyle}>Share dilution</div>
        <h2 style={embedded ? embeddedHeadingStyle : headingStyle}>{symbol} shares outstanding over time</h2>
        <p style={subStyle} data-share-withheld="">{withheldWords(data.withheld)}</p>
      </>
    );
    return embedded ? <div style={{ marginTop: 24 }}>{said}</div> : <section style={{ marginTop: 32, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 24 }}>{said}</section>;
  }
  // Need a real spread of points to show a meaningful trend — a single
  // snapshot (or FMP returning nothing usable) isn't a "history".
  if (points.length < 3) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const changePercent =
    first.shares > 0 ? ((last.shares - first.shares) / first.shares) * 100 : null;
  // THE 3-YEAR FIGURE DRIVES THE COLOUR AND THE WORDS (#552 COWORK #89 §5).
  // A payload built before it existed reads as "too short": no colour claim.
  const threePct = data?.threeYear && data.threeYear.pct !== null ? data.threeYear.pct : null;
  // THE WINDOW'S ACTUAL ENDS, NEVER "LATEST" (#552 COWORK #120): the end may
  // step back up to 6 months from the newest point to find a base.
  const threeSpan = data?.threeYear && data.threeYear.pct !== null && data.threeYear.end ? data.threeYear : null;
  // WHEN THE END STEPPED BACK, THE TILE SAYS SO (#552 COWORK #138), and the
  // headline names the same span: one window, stated the same way twice.
  const endIsNewest = threeSpan ? threeSpan.end!.date === last.date : true;
  const threeWindow = threeSpan
    ? `${fmtDateDay(threeSpan.base.date)} to ${fmtDateDay(threeSpan.end!.date)}${endIsNewest ? "" : ` · ${NEWEST_SPAN_WORDS}`}`
    : null;
  const phrase = threeSpan ? spanPhrase(threeSpan.base.date, threeSpan.end!.date, endIsNewest) : LAST_3_YEARS;
  const trend = threeYearWords(threePct, phrase);
  const headline = shareHeadline(
    threeSpan ? { pct: threeSpan.pct as number, from: fmtDateShort(threeSpan.base.date) ?? threeSpan.base.date, to: fmtDateShort(threeSpan.end!.date) ?? threeSpan.end!.date, endIsNewest, phrase } : null,
    changePercent,
    fmtDateShort(first.date),
  );
  const trendColor = trend.tone === "up" ? RED : trend.tone === "down" ? GREEN : BLUE;

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
  // X IS TIME, NOT THE POINT'S INDEX: a 7-year hole (GDDY 2016 -> 2023) used
  // to take the same width as one quarter, which hid it.
  const t0 = Date.parse(first.date), t1 = Date.parse(last.date);
  const tSpan = t1 > t0 ? t1 - t0 : 1;

  const coords = points.map((p) => {
    const x = padX + ((Date.parse(p.date) - t0) / tSpan) * plotW;
    const y = padTop + (1 - (p.shares - minV) / span) * plotH;
    return { x, y, p };
  });

  // THE LINE BREAKS AT EVERY GAP (#552 COWORK #89 §4): one segment per run of
  // points with no gap between them, and never a straight line across a hole.
  const gapStarts = new Set((data?.gaps ?? []).map((g) => g.from));
  const segments: (typeof coords)[] = [[]];
  for (const c of coords) {
    segments[segments.length - 1].push(c);
    if (gapStarts.has(c.p.date)) segments.push([]);
  }
  const drawn = segments.filter((seg) => seg.length > 0);
  const baseY = (padTop + plotH).toFixed(1);
  const lineOf = (seg: typeof coords) => seg.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const areaOf = (seg: typeof coords) =>
    `M ${seg[0].x.toFixed(1)} ${baseY} ` + seg.map((c) => `L ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ") + ` L ${seg[seg.length - 1].x.toFixed(1)} ${baseY} Z`;
  const gapLabels = (data?.gaps ?? []).map((g) => {
    const a = coords.find((c) => c.p.date === g.from), b = coords.find((c) => c.p.date === g.to);
    return a && b ? { x: (a.x + b.x) / 2, key: g.from } : null;
  }).filter((g): g is { x: number; key: string } => g !== null);
  const notes = data ? seriesNotes(data) : [];

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

      {headline ? (
        <div style={{ marginTop: 14, fontSize: 14, fontWeight: 800, lineHeight: 1.4, color: trendColor }} data-share-headline="">
          {headline}
        </div>
      ) : null}

      <div style={{ marginTop: headline ? 10 : 18 }}>
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
          {drawn.map((seg, i) => (
            <g key={`seg-${i}`} data-share-segment="">
              {seg.length > 1 ? <path d={areaOf(seg)} fill={`url(#${gradientId})`} /> : null}
              <polyline
                points={lineOf(seg)}
                fill="none"
                stroke={trendColor}
                strokeWidth={2.25}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
          ))}
          {gapLabels.map((g) => (
            <text key={`gap-${g.key}`} x={g.x} y={padTop + plotH / 2} fontSize={11} fill="rgba(203,213,225,0.55)" textAnchor="middle" data-share-gap="">
              no filing data
            </text>
          ))}
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
        {/* THE TWO FIGURES SIDE BY SIDE (#552 COWORK #89 §5): the last 3
            years, which carries the colour and the words, and since the first
            point, in plain ink. */}
        <div style={cellStyle} data-share-three-year="">
          {/* THE SAME SPAN AS THE HEADLINE AND THE DATE LINE (#552 COWORK #141). */}
          <div style={cellLabelStyle}>Over {phrase}</div>
          <div style={{ ...cellValueStyle, color: trendColor }}>
            {threePct === null ? "—" : formatShareChange(threePct)}
          </div>
          <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.4, color: "rgba(203,213,225,0.72)" }}>{trend.label}</div>
          {threeWindow ? (
            <div style={{ marginTop: 2, fontSize: 12, lineHeight: 1.4, color: "rgba(203,213,225,0.55)" }} data-share-three-window="">
              {threeWindow}
            </div>
          ) : null}
        </div>
        <div style={cellStyle}>
          <div style={cellLabelStyle}>Since {fmtDateShort(first.date)}</div>
          <div style={cellValueStyle}>{formatShareChange(changePercent)}</div>
        </div>
      </div>

      <div style={sourceStyle}>
        {data?.basis === "annual+quarters" ? (
          // THE BASIS, SAID (#552 COWORK #136): quarterly averages plus
          // fiscal-year averages, which fill the year-ends no quarter covers.
          <>Weighted-average basic shares from {symbol}&apos;s own SEC filings: quarterly averages plus{" "}
          {data.yearEnds?.length ?? 0} fiscal-year average{(data.yearEnds?.length ?? 0) === 1 ? "" : "s"} (a year&apos;s
          figure averages all twelve months; a fourth quarter has no share count of its own) — {points.length} data points
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
        {data?.refusedYears?.length
          ? ` ${data.refusedYears.length === 1 ? "One fiscal-year figure is" : `${data.refusedYears.length} fiscal-year figures are`} left out: outside the range of that year's own quarterly figures, so likely on another basis.`
          : null}
        {notes.length ? <> {notes.join(" ")}</> : null}
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
