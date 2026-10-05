// THE HEADER STRIP'S SMALL PARTS (#563 COWORK #99 §4): the price change with
// its arrow, the stacked day range with its position bar, the thin position
// bars for Volume and RSI, and the faint price line behind the Trend score.
// Presentational only; the numbers come from lib/headerStrip.ts and the page.
import type { CSSProperties } from "react";
import { ARROW, changeAria, changeDirection, dayCandle, peLine, priceSpark, rsiPane, sparkPoints, volumeBars } from "@/lib/headerStrip";

const UP = "#22c55e", DOWN = "#ef4444";

/** "▲ +1.23 (+0.45%)": the arrow beside the signed change, with spoken words for it. */
export function PriceChange({ change, pct, label }: { change: number | null | undefined; pct: number | null | undefined; label: string }) {
  const d = changeDirection(change);
  const colour = d === "up" ? UP : d === "down" ? DOWN : undefined;
  return (
    <span className="hsChange" data-direction={d ?? undefined} aria-label={changeAria(change, pct) ?? undefined} style={{ color: colour, fontWeight: 700, opacity: 0.95 }}>
      {d && ARROW[d] ? <span aria-hidden="true" style={{ marginRight: 4 }}>{ARROW[d]}</span> : null}
      <span aria-hidden={changeAria(change, pct) ? "true" : undefined}>{label}</span>
    </span>
  );
}

/** A thin track with a marker at `pos` (0–100), and optional tick marks. Decorative: the figures beside it are the content. */
export function PositionBar({ pos, ticks = [], colour = "rgba(241,245,249,0.9)" }: { pos: number | null; ticks?: number[]; colour?: string }) {
  if (pos === null) return null;
  return (
    <div className="hsBar" aria-hidden="true" style={{ position: "relative", height: 4, marginTop: 6, borderRadius: 999, background: "rgba(255,255,255,0.12)" }}>
      {ticks.map((t) => <span key={t} style={{ position: "absolute", left: `${t}%`, top: -2, width: 1, height: 8, background: "rgba(255,255,255,0.28)" }} />)}
      <span className="hsMarker" data-pos={pos.toFixed(1)} style={{ position: "absolute", left: `calc(${pos}% - 4px)`, top: -2, width: 8, height: 8, borderRadius: 999, background: colour, boxShadow: "0 0 0 2px #0b1220" }} />
    </div>
  );
}

const price = (v: number) => `$${v.toFixed(2)}`;

/** The day's high on top (green), the low below (red); today's candle on the 52-week range sits beside them (DayCandle). */
export function DayRange({ low, high }: { low: number | null | undefined; high: number | null | undefined; /** Kept for the call site; the candle shows it now. */ last?: number | null }) {
  if (typeof low !== "number" || typeof high !== "number" || !Number.isFinite(low) || !Number.isFinite(high)) return <div className="stock-stat-value">—</div>;
  const row: CSSProperties = { display: "flex", alignItems: "baseline", gap: 6, fontSize: "0.9375rem", fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.2, fontVariantNumeric: "tabular-nums" };
  const tag: CSSProperties = { fontSize: "var(--fs-label)", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", opacity: 0.7, minWidth: "2.4em" };
  return (
    <div className="hsRange" style={{ marginTop: 4 }}>
      <div className="hsHigh" style={{ ...row, color: UP }}><span style={tag}>High</span>{price(high)}</div>
      <div className="hsLow" style={{ ...row, color: DOWN }}><span style={tag}>Low</span>{price(low)}</div>
    </div>
  );
}

/** The chart window's closes as a faint line behind the Trend score, in the score's colour. Decorative. */
export function TrendSpark({ closes, colour }: { closes: readonly number[]; colour: string }) {
  const pts = sparkPoints(closes);
  if (!pts) return null;
  return (
    <svg className="hsSpark" aria-hidden="true" focusable="false" viewBox="0 0 100 30" preserveAspectRatio="none"
      style={{ position: "absolute", left: 10, right: 10, bottom: 10, width: "calc(100% - 20px)", height: "55%", opacity: 0.28, pointerEvents: "none" }}>
      <polyline points={pts} fill="none" stroke={colour} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

// ── THE CELLS' MINI-GRAPHICS (#563 COWORK #112) ─────────────────────────────
// Each is aria-hidden, faint, in the cell's own colour, absolutely placed so the
// cell's size and layout don't change, and carries NO transform (the P/E cell
// holds A's ReasonedValue, whose fixed note a transform would capture).

const behind: CSSProperties = { position: "absolute", left: 10, right: 10, bottom: 10, width: "calc(100% - 20px)", height: "55%", pointerEvents: "none" };

/** Today's candle (wick low–high, body open–last) on a faint 52-week track, at the cell's right edge. */
export function DayCandle({ open, high, low, last, yearLow, yearHigh }: { open?: number | null; high?: number | null; low?: number | null; last?: number | null; yearLow?: number | null; yearHigh?: number | null }) {
  const c = dayCandle({ open, high, low, last, yearLow, yearHigh });
  if (!c) return null;
  const colour = c.up ? UP : DOWN;
  return (
    <svg className="hsCandle" data-up={c.up ? "1" : "0"} aria-hidden="true" focusable="false" viewBox="0 0 10 100" preserveAspectRatio="none"
      style={{ position: "absolute", right: 12, top: 12, bottom: 12, width: 10, height: "calc(100% - 24px)", pointerEvents: "none" }}>
      {c.onYear ? <rect className="hsYear" x={3.5} y={0} width={3} height={100} rx={1.5} fill="rgba(255,255,255,0.10)" /> : null}
      <line className="hsWick" x1={5} x2={5} y1={c.wickTop} y2={c.wickBottom} stroke={colour} strokeOpacity={0.75} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <rect className="hsBody" x={1.5} y={c.bodyTop} width={7} height={c.bodyBottom - c.bodyTop} fill={colour} fillOpacity={0.8} />
    </svg>
  );
}

/** The last ~30 sessions' volume as faint bars behind the figure, the latest brighter, a dashed line at the 50-day average. */
export function VolumeBars({ vols, avg, colour }: { vols: readonly (number | null | undefined)[]; avg: number | null | undefined; colour: string }) {
  const b = volumeBars(vols, avg);
  if (!b) return null;
  const w = 100 / b.heights.length;
  return (
    <svg className="hsVolume" aria-hidden="true" focusable="false" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ ...behind, height: "45%", opacity: 0.6 }}>
      {b.heights.map((h, i) => (
        <rect key={i} className={i === b.heights.length - 1 ? "hsVolLast" : undefined} x={i * w + w * 0.15} y={100 - h} width={w * 0.7} height={h}
          fill={colour} fillOpacity={i === b.heights.length - 1 ? 0.55 : 0.22} />
      ))}
      {b.avgY !== null ? <line className="hsVolAvg" x1={0} x2={100} y1={b.avgY} y2={b.avgY} stroke="rgba(241,245,249,0.6)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" /> : null}
    </svg>
  );
}

/** A mini RSI pane behind the figure: the 30–70 band shaded, dashed 70 and 30, above 70 tinted red, below 30 green, the line and its last point. */
export function RsiPane({ series, colour }: { series: readonly (number | null)[]; colour: string }) {
  const p = rsiPane(series);
  if (!p) return null;
  return (
    <svg className="hsRsi" aria-hidden="true" focusable="false" viewBox="0 0 100 30" preserveAspectRatio="none" style={{ ...behind, opacity: 0.5 }}>
      <rect className="hsRsiHot" x={0} y={0} width={100} height={p.y70} fill={DOWN} fillOpacity={0.12} />
      <rect className="hsRsiBand" x={0} y={p.y70} width={100} height={p.y30 - p.y70} fill="rgba(148,163,184,0.10)" />
      <rect className="hsRsiCold" x={0} y={p.y30} width={100} height={30 - p.y30} fill={UP} fillOpacity={0.12} />
      <line className="hsRsi70" x1={0} x2={100} y1={p.y70} y2={p.y70} stroke="rgba(241,245,249,0.45)" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      <line className="hsRsi30" x1={0} x2={100} y1={p.y30} y2={p.y30} stroke="rgba(241,245,249,0.45)" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      <polyline points={p.points} fill="none" stroke={colour} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle className="hsRsiDot" cx={p.last.x} cy={p.last.y} r={1.6} fill={colour} />
    </svg>
  );
}

/** The P/E on a small number line from 0: the sector median as a tick, the stock as a dot, the gap shaded green below the median, amber above. */
export function PeLine({ pe, median }: { pe: number | null | undefined; median: number | null | undefined }) {
  const l = peLine(pe, median);
  if (!l) return null;
  const lo = Math.min(l.stock, l.median), hi = Math.max(l.stock, l.median);
  return (
    <svg className="hsPe" data-below={l.below ? "1" : "0"} aria-hidden="true" focusable="false" viewBox="0 0 100 12" preserveAspectRatio="none"
      style={{ position: "absolute", left: 10, right: 10, bottom: 6, width: "calc(100% - 20px)", height: 12, pointerEvents: "none" }}>
      <line x1={0} x2={100} y1={6} y2={6} stroke="rgba(255,255,255,0.14)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <rect className="hsPeGap" x={lo} y={4} width={hi - lo} height={4} fill={l.below ? UP : "#f59e0b"} fillOpacity={0.35} />
      <line className="hsPeMedian" x1={l.median} x2={l.median} y1={1} y2={11} stroke="rgba(241,245,249,0.7)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <circle className="hsPeDot" cx={l.stock} cy={6} r={2.6} fill="rgba(241,245,249,0.95)" />
    </svg>
  );
}

/** The last 5 sessions' closes behind the price, with a dashed line at the previous close. Daily closes only, no intraday line. */
export function PriceSpark({ closes, prevClose }: { closes: readonly number[]; prevClose: number | null | undefined }) {
  const p = priceSpark(closes, prevClose);
  if (!p) return null;
  const colour = p.up === null ? "rgba(203,213,225,0.8)" : p.up ? UP : DOWN;
  return (
    <svg className="hsPriceSpark" aria-hidden="true" focusable="false" viewBox="0 0 100 30" preserveAspectRatio="none" style={{ ...behind, opacity: 0.32 }}>
      {p.prevY !== null ? <line className="hsPrev" x1={0} x2={100} y1={p.prevY} y2={p.prevY} stroke="rgba(241,245,249,0.8)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" /> : null}
      <polyline points={p.points} fill="none" stroke={colour} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
