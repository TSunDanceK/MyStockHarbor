// The earnings page's price-reaction charts.
//
// Moved out of page.tsx so the render harness (scripts/lib/render-cards.mjs)
// can draw them from a fixture, the same reason the score card moved to
// SecEarningsCards.tsx. Presentational and server-rendered; every figure is
// computed in page.tsx and handed in. ChartFrame, SeriesLegend and
// SingleValueBarChart are unchanged; DriftBarChart replaces the line chart
// "Did the move hold?" drew (owner review of AVAV, round 2).
import type React from "react";

// Nominal width (in "user units") for the chart SVGs below. Choosing a
// realistic pixel-scale number here -- rather than an abstract 0-100 -- and
// then letting the SVG scale uniformly (width: 100%, height: auto, no
// preserveAspectRatio="none") keeps x and y scaled by very nearly the same
// factor. That's what keeps circles round and strokes a consistent thin
// line instead of the squashed-ellipse / stretched-line look you get from
// forcing a near-square viewBox to fill a wide card non-uniformly.
export const CHART_VIEW_W = 640;

export function ChartFrame({ height, labels, scaleTop, scaleMid, scaleBottom, children }: { height: number; labels: string[]; scaleTop?: string; scaleMid?: string; scaleBottom?: string; children: React.ReactNode; }) {
  const hasScale = scaleTop != null || scaleMid != null || scaleBottom != null;
  return (
    <div>
      <div className="chartRow">
        <div className="chartPlot">{children}</div>
        {hasScale && (
          <div className="chartScale">
            {scaleTop != null && <span className="scaleTop">{scaleTop}</span>}
            {scaleMid != null && <span className="scaleMid">{scaleMid}</span>}
            {scaleBottom != null && <span className="scaleBottom">{scaleBottom}</span>}
          </div>
        )}
      </div>
      {/* Mirrors the row above (same flex structure + spacer) so the quarter
          labels line up under the actual bars/dots instead of being centered
          across the full card width while the plot itself is narrower by the
          Y-axis scale column. */}
      <div className="chartRow">
        <div className="chartCategories">
          {labels.map((l, i) => <span key={`${l}-${i}`}>{l}</span>)}
        </div>
        {hasScale && <div className="chartScaleSpacer" aria-hidden="true" />}
      </div>
    </div>
  );
}



export function SeriesLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="chartLegend">
      {items.map((item) => (
        <span key={item.label}><i style={{ background: item.color }} /> {item.label}</span>
      ))}
    </div>
  );
}

export type SingleBarPoint = { label: string; value: number | null };

export function SingleValueBarChart({ data, height = 168, formatValue = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%` }: { data: SingleBarPoint[]; height?: number; formatValue?: (v: number) => string; }) {
  const values = data.map((d) => d.value).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const maxAbs = values.length ? Math.max(...values.map((v) => Math.abs(v)), 0.5) : 1;
  const zeroY = height / 2;
  const usable = zeroY - 10;
  const groupW = CHART_VIEW_W / Math.max(data.length, 1);

  return (
    <ChartFrame
      height={height}
      labels={data.map((d) => d.label)}
      scaleTop={values.length ? formatValue(maxAbs) : undefined}
      scaleMid={values.length ? formatValue(0) : undefined}
      scaleBottom={values.length ? formatValue(-maxAbs) : undefined}
    >
      <svg viewBox={`0 0 ${CHART_VIEW_W} ${height}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Price reaction chart">
        <line x1="0" y1={zeroY} x2={CHART_VIEW_W} y2={zeroY} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
        {data.map((d, i) => {
          const cx = i * groupW + groupW / 2;
          const barW = Math.min(groupW * 0.42, 38);
          const h = d.value != null ? (Math.abs(d.value) / maxAbs) * usable : 0;
          const up = (d.value ?? 0) >= 0;
          const color = d.value == null ? "rgba(148,163,184,0.35)" : up ? "#22c55e" : "#ef4444";
          return d.value != null ? (
            <rect key={`${d.label}-${i}`} x={cx - barW / 2} y={up ? zeroY - h : zeroY} width={barW} height={Math.max(h, 2)} fill={color} rx="3" />
          ) : null;
        })}
      </svg>
    </ChartFrame>
  );
}

/**
 * ONE REPORT'S MOVE, AT THREE HORIZONS — the input to DriftBarChart.
 *
 * `pending` is set per horizon when that many trading days have not passed
 * since the reaction session yet. It is a different fact from "no figure":
 * the bar is not missing, it does not exist yet, and the chart says so.
 */
export type DriftQuarter = {
  label: string;
  reactionPct: number | null;
  drift5Pct: number | null;
  drift20Pct: number | null;
  drift5Pending: boolean;
  drift20Pending: boolean;
};

/**
 * The three horizons, in the fixed order they are drawn and keyed. Colours are
 * the site's own blue / yellow / green (the owner's spec), checked with the
 * dataviz validator against the page's dark card surface: adjacent-pair CVD
 * separation 8.9 (protan, target >= 8), normal-vision 22.4, contrast >= 3:1.
 * They sit above the validator's dark-mode lightness band; position within
 * the group and the legend carry identity as well as the hue.
 */
export const DRIFT_HORIZONS = [
  { key: "reactionPct", pending: null, label: "Day of reaction", days: 1, color: "#60a5fa" },
  { key: "drift5Pct", pending: "drift5Pending", label: "+5 trading days", days: 5, color: "#facc15" },
  { key: "drift20Pct", pending: "drift20Pending", label: "+20 trading days", days: 20, color: "#22c55e" },
] as const;

const pctText = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

/**
 * A bar whose DATA END is rounded and whose baseline end is square, so it
 * reads as anchored to zero whichever way it grows.
 */
function barPath(x: number, zeroY: number, w: number, h: number, up: boolean, r = 4): string {
  const rr = Math.min(r, w / 2, h);
  if (up) {
    const top = zeroY - h;
    return `M${x},${zeroY} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + w - rr} Q${x + w},${top} ${x + w},${top + rr} V${zeroY} Z`;
  }
  const bot = zeroY + h;
  return `M${x},${zeroY} V${bot - rr} Q${x},${bot} ${x + rr},${bot} H${x + w - rr} Q${x + w},${bot} ${x + w},${bot - rr} V${zeroY} Z`;
}

/**
 * "DID THE MOVE HOLD?" — three thin bars per report, from a 0% baseline.
 *
 * It was three lines over the same quarters, which joined reports months
 * apart as though the price travelled from one to the next. Each report is
 * its own event, so each gets its own group: the day of the reaction, then
 * where the price stood after 5 and 20 trading days, all against the same
 * pre-earnings close. Same quarter axis and labels as the reaction chart above
 * it, with its own symmetric scale.
 *
 * A HORIZON THAT HAS NOT HAPPENED YET GETS NO BAR — never a zero-height one,
 * which would read as "back where it started". It gets a short grey dash on
 * the baseline and a tooltip saying why. Every bar carries its exact figure
 * as a tooltip, over a hit target the height of the plot.
 */
export function DriftBarChart({ quarters, height = 168 }: { quarters: DriftQuarter[]; height?: number }) {
  const values = quarters.flatMap((q) => DRIFT_HORIZONS.map((h) => q[h.key]))
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const maxAbs = values.length ? Math.max(...values.map((v) => Math.abs(v)), 0.5) : 1;
  const zeroY = height / 2;
  const usable = zeroY - 10;
  const groupW = CHART_VIEW_W / Math.max(quarters.length, 1);
  const gap = 2;
  const barW = Math.min((groupW * 0.62 - gap * 2) / 3, 14);
  const scale = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;
  return (
    <ChartFrame
      height={height}
      labels={quarters.map((q) => q.label)}
      scaleTop={values.length ? scale(maxAbs) : undefined}
      scaleMid={values.length ? scale(0) : undefined}
      scaleBottom={values.length ? scale(-maxAbs) : undefined}
    >
      <svg viewBox={`0 0 ${CHART_VIEW_W} ${height}`} style={{ width: "100%", height: "auto", display: "block" }} role="img"
        aria-label="Price against the pre-earnings close after 1, 5 and 20 trading days, by report">
        <line x1="0" y1={zeroY} x2={CHART_VIEW_W} y2={zeroY} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
        {quarters.map((q, i) => {
          const groupLeft = i * groupW + groupW / 2 - (barW * 3 + gap * 2) / 2;
          return (
            <g key={`${q.label}-${i}`}>
              {DRIFT_HORIZONS.map((hz, j) => {
                const v = q[hz.key];
                const x = groupLeft + j * (barW + gap);
                const pending = hz.pending ? q[hz.pending] : false;
                if (v == null || !Number.isFinite(v)) {
                  if (!pending) return null;
                  const why = `Not yet ${hz.days} trading days`;
                  return (
                    <g key={hz.key} className="driftPending" data-pending={hz.key}>
                      <title>{`${q.label} · ${hz.label}: ${why}`}</title>
                      <rect x={x - gap / 2} y={0} width={barW + gap} height={height} fill="transparent" />
                      <line x1={x + 1} x2={x + barW - 1} y1={zeroY + 5} y2={zeroY + 5}
                        stroke="rgba(148,163,184,0.75)" strokeWidth="2" strokeLinecap="round" />
                    </g>
                  );
                }
                const h = Math.max((Math.abs(v) / maxAbs) * usable, 2);
                return (
                  <g key={hz.key} className="driftBar">
                    <title>{`${q.label} · ${hz.label}: ${pctText(v)}`}</title>
                    <rect x={x - gap / 2} y={0} width={barW + gap} height={height} fill="transparent" />
                    <path d={barPath(x, zeroY, barW, h, v >= 0)} fill={hz.color} />
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
}

const pct1 = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : pctText(v));

/**
 * THE PRICE-REACTION CARD — round 2 of the AVAV review cut its copy.
 *
 * The intro was a three-clause paragraph about sessions; the "Each bar is
 * keyed to…" paragraph then said the same thing again, and a market-moves
 * caveat ran two lines. One line of method, the chart, its key, a one-line
 * caveat. The provenance sentence survives only for the case the intro would
 * otherwise mis-describe: dates from an earnings calendar rather than from the
 * company's own SEC filings.
 */
export function PriceReactionCard({
  symbol, latest, reaction, drift, datesFromSec, uncoveredLabels, noPriceHistoryNote,
}: {
  symbol: string;
  latest: { label: string; reactionPct: number | null; volumeMultiple: number | null } | null;
  reaction: SingleBarPoint[];
  drift: DriftQuarter[];
  datesFromSec: boolean;
  uncoveredLabels: string[];
  noPriceHistoryNote: string;
}) {
  const hasAnyReaction = reaction.some((d) => d.value != null);
  const hasAnyDrift = drift.some((q) => q.drift5Pct != null || q.drift20Pct != null);
  return (
    <section className="card">
      <div className="eyebrow">Price reaction</div>
      <h2>How has {symbol} actually traded around its last reports?</h2>
      <p>Close-to-close move around each results filing. After-close filings are measured to the next day&apos;s close.</p>
      {!datesFromSec ? (
        <p className="earningsDataNote">
          Dates here come from an earnings calendar — {symbol}&apos;s own filing history has not been read yet.
        </p>
      ) : null}
      {latest && (latest.reactionPct != null || latest.volumeMultiple != null) ? (
        <p>
          <strong>Most recent reaction ({latest.label}):</strong> {pct1(latest.reactionPct)}
          {latest.volumeMultiple != null ? ` on ${latest.volumeMultiple.toFixed(1)}x average volume` : ""}.
        </p>
      ) : null}
      {hasAnyReaction ? (
        <>
          <div className="chartBlock">
            <SingleValueBarChart data={reaction} />
          </div>
          <SeriesLegend items={[{ label: "Rose after report", color: "#22c55e" }, { label: "Fell after report", color: "#ef4444" }]} />
          {/* A MISSING BAR IS EXPLAINED, NOT LEFT TO INFERENCE: the price
              series starts later than the report. */}
          {uncoveredLabels.length > 0 ? (
            <p className="earningsDataNote">
              <strong>{uncoveredLabels.join(", ")}</strong>{" "}
              {uncoveredLabels.length === 1 ? "has" : "have"} no bar above. {noPriceHistoryNote}
            </p>
          ) : null}
        </>
      ) : (
        <p>Not enough price history is available yet to chart the reaction around earnings.</p>
      )}
      {hasAnyDrift ? (
        <div className="chartBlock">
          <div className="chartBlockTitle">Did the move hold?</div>
          <div className="chartBlockSub">Price vs. the pre-earnings close, after 1, 5 and 20 trading days.</div>
          <DriftBarChart quarters={drift} />
          <SeriesLegend items={DRIFT_HORIZONS.map((h) => ({ label: h.label, color: h.color }))} />
          <p className="earningsDataNote">The most recent quarters may not have a full 20 trading days of data yet.</p>
        </div>
      ) : null}
      <p className="earningsDataNote">Includes broader market moves, not only the earnings news.</p>
    </section>
  );
}
