"use client";
// "DID THE LEVEL HOLD?" (#563 COWORK #133): the live chart for the post's
// window, the level it discussed drawn on it, a slider over the chart's own
// sessions, lined up with its x-axis and marking the bar on it (#155), with a
// readout, and four toggles (200-day, 50-day, Trend Helper,
// today's levels). The chart is the site's PriceChart; this file owns only the
// controls and the readout, both from the closes the server already sent.
import { useMemo, useState } from "react";
import PriceChart, { PRICE_CHART_PAD, type Overlay } from "@/app/components/PriceChart";

/** The slider's thumb, in px: the input overhangs the plot by half of it on each side, so its centre runs from the first bar to the last. */
export const THUMB_PX = 18;

export type InsightChartProps = {
  symbol: string;
  points: { date: string; close: number }[];
  fullCloses: number[];
  displayStart: number;
  ma50: (number | null)[];
  ma200: (number | null)[];
  wma200: (number | null)[] | null;
  bbMid: (number | null)[] | null;
  publishIndex: number;
  level: { kind: string; name: string; series: (number | null)[] } | null;
  todayLevels: { price: number; label: string }[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return `${dd} ${MONTHS[m - 1]} ${y}`; };
const money = (v: number) => `$${v.toFixed(v >= 1000 ? 0 : 2)}`;
const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;

type Toggle = "level" | "ma200" | "ma50" | "trend" | "today";
const BASE: { key: Toggle; label: string }[] = [
  { key: "ma200", label: "200-day" },
  { key: "ma50", label: "50-day" },
  { key: "trend", label: "Trend Helper" },
  { key: "today", label: "Today's levels" },
];
/**
 * THE TOGGLES MATCH THE LEVEL DISCUSSED (#563 COWORK #137): a post about the
 * 20-day (its Bollinger midline) or the 200-week gets THAT line as the first
 * toggle, on by default; the 200-day and 50-day posts already have theirs.
 */
export function togglesFor(level: string | undefined): { key: Toggle; label: string }[] {
  if (level === "BBMID") return [{ key: "level", label: "20-day (Bollinger)" }, ...BASE];
  if (level === "WMA200") return [{ key: "level", label: "200-week" }, ...BASE];
  return BASE;
}

export default function InsightChart(p: InsightChartProps) {
  const last = p.points.length - 1;
  const [at, setAt] = useState(last);
  // The level discussed is always drawn; the toggles add the rest.
  const toggles = togglesFor(p.level?.kind);
  const [on, setOn] = useState<Record<Toggle, boolean>>({ level: true, ma200: p.level?.kind === "MA200", ma50: p.level?.kind === "MA50", trend: false, today: false });
  const indicators = useMemo<Overlay[]>(() => {
    const out: Overlay[] = [];
    if (on.ma200) out.push("MA200");
    if (on.ma50) out.push("MA50");
    if (on.trend) out.push("Trend Helper (Smooth)");
    if (on.level && p.level?.kind === "WMA200") out.push("Weekly MA200");
    if (on.level && p.level?.kind === "BBMID") out.push("Bollinger(20,2)");
    return out;
  }, [on, p.level?.kind]);

  // THE SLIDER IS THE CHART'S X-AXIS (#563 COWORK #155): position n is bar n,
  // the first bar to the last, and the chart marks the same bar. Sessions
  // before publication are allowed and say so; the "vs publication" figure is
  // only for sessions after it.
  const i = Math.max(0, Math.min(at, last));
  const pt = p.points[i];
  const pub = p.points[p.publishIndex];
  const lv = p.level?.series[i] ?? null;
  const span = last - p.publishIndex;
  const before = i < p.publishIndex;

  return (
    <div className="inChart" data-insight-chart="">
      <div className="inToggles" role="group" aria-label="Lines on the chart">
        {toggles.map((t) => (
          <button key={t.key} type="button" aria-pressed={on[t.key]} className="inToggle" data-on={on[t.key] ? "1" : "0"}
            onClick={() => setOn((s) => ({ ...s, [t.key]: !s[t.key] }))}>
            {t.label}
          </button>
        ))}
      </div>
      <PriceChart
        symbol={p.symbol}
        data={p.points}
        ma50={p.ma50}
        ma200={p.ma200}
        weeklyMa200={p.wma200 ?? undefined}
        bollMid={p.bbMid ?? undefined}
        selectedIndicators={indicators}
        referenceLines={on.today ? p.todayLevels.map((l) => ({ price: l.price, label: l.label, color: "rgba(148,163,184,0.7)" })) : []}
        marker={span >= 1 ? i : null}
        fullCloses={p.fullCloses}
        displayStart={p.displayStart}
        height={300}
        hideSourceToggle
        showTradeLink={false}
        showTradingViewLink={false}
      />
      {span >= 1 ? (
        <div className="inSlider">
          <label htmlFor="inSliderRange" className="inSliderLabel">Drag to a date</label>
          {/* The track spans the plot area, not the card: the chart's own left and right inset, in % of the same width (shifted 1 px right: the chart's border). */}
          <div className="inSliderTrack" data-slider-track="" style={{ paddingLeft: `calc(${(PRICE_CHART_PAD.left / PRICE_CHART_PAD.width) * 100}% + 1px)`, paddingRight: `calc(${(PRICE_CHART_PAD.right / PRICE_CHART_PAD.width) * 100}% - 1px)` }}>
            <input id="inSliderRange" type="range" min={0} max={last} step={1} value={i}
              style={{ ["--pub" as string]: `${(p.publishIndex / Math.max(1, last)) * 100}%` }}
              onChange={(e) => setAt(Number(e.target.value))} aria-valuetext={`${day(pt.date)}${before ? ", before publication" : ""}`} />
          </div>
          <p className="inReadout" aria-live="polite" data-slider-readout={pt.date}>
            <strong>{day(pt.date)}</strong> · close {money(pt.close)} · {before ? "before publication" : `${pct(((pt.close - pub.close) / pub.close) * 100)} vs publication`}
            {p.level && lv !== null ? <> · {pt.close >= lv ? "above" : "below"} the {p.level.name} ({money(lv)})</> : null}
          </p>
        </div>
      ) : (
        <p className="inReadout">Published {day(pub.date)}. The slider appears once a session has closed since.</p>
      )}
    </div>
  );
}
