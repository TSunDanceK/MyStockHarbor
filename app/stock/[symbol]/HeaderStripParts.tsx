// THE HEADER STRIP'S SMALL PARTS (#563 COWORK #99 §4): the price change with
// its arrow, the stacked day range with its position bar, the thin position
// bars for Volume and RSI, and the faint price line behind the Trend score.
// Presentational only; the numbers come from lib/headerStrip.ts and the page.
import type { CSSProperties } from "react";
import { ARROW, changeAria, changeDirection, rangePosition, sparkPoints } from "@/lib/headerStrip";

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

/** The day's high on top (green), the low below (red), and where the price sits between them. */
export function DayRange({ low, high, last }: { low: number | null | undefined; high: number | null | undefined; last: number | null | undefined }) {
  if (typeof low !== "number" || typeof high !== "number" || !Number.isFinite(low) || !Number.isFinite(high)) return <div className="stock-stat-value">—</div>;
  const row: CSSProperties = { display: "flex", alignItems: "baseline", gap: 6, fontSize: 14, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.2, fontVariantNumeric: "tabular-nums" };
  const tag: CSSProperties = { fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.7, minWidth: 26 };
  return (
    <div className="hsRange" style={{ marginTop: 4 }}>
      <div className="hsHigh" style={{ ...row, color: UP }}><span style={tag}>High</span>{price(high)}</div>
      <div className="hsLow" style={{ ...row, color: DOWN }}><span style={tag}>Low</span>{price(low)}</div>
      <PositionBar pos={rangePosition(low, high, last)} />
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
