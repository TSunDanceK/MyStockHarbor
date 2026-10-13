// THE TREND SCORE'S SEGMENTED METER, SHARED (#553 COWORK #221): lifted out of
// app/dashboard/DashboardLanding.tsx (C's "Market today", #563 COWORK #164/#166)
// so the dashboard and the SPX / QQQ hero tiles draw one meter, not two copies.
// The markup, the class names and the CSS are exactly the dashboard's, which
// re-exports trendTone / TREND_SEGMENTS and interpolates TREND_METER_CSS into
// its LANDING_CSS: its rendered output is byte-identical to before the lift.
//
// Decorative (aria-hidden): the "85/100" beside it carries the reading.

/** The trend score's tone: the index tiles' green / amber / red, on trendWords' bands. */
export const trendTone = (score: number) => (score >= 56 ? "up" : score > 44 ? "flat" : "down");
/** Segments in the trend meter; one per 10 points. */
export const TREND_SEGMENTS = 10;

/** The trend score as a segmented bar: TREND_SEGMENTS cells, the first round(score / 10) lit. Decorative; the number carries it. */
export function TrendMeter({ score }: { score: number }) {
  const lit = Math.max(0, Math.min(TREND_SEGMENTS, Math.round(score / (100 / TREND_SEGMENTS))));
  return (
    <span className="dlMeter" data-meter={lit} data-tone={trendTone(score)} aria-hidden="true">
      {Array.from({ length: TREND_SEGMENTS }, (_, i) => <i key={i} data-on={i < lit ? "" : undefined} />)}
    </span>
  );
}

/** The meter's rules, once: the dashboard's LANDING_CSS and the market pages' style blocks both include them. */
export const TREND_METER_CSS = `.dlMeter{display:inline-grid;grid-template-columns:repeat(10,6px);gap:2px;align-items:center;}
.dlMeter i{display:block;height:10px;border-radius:2px;background:#222c40;}
.dlMeter[data-tone="up"] i[data-on]{background:#22c55e;}
.dlMeter[data-tone="flat"] i[data-on]{background:#eab308;}
.dlMeter[data-tone="down"] i[data-on]{background:#ef4444;}`;
