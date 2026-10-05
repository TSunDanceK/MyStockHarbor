// THE STOCK PAGE'S TECHNICAL INDICATORS, AS PICTURES (#563 COWORK #68): the
// old "Key levels & signals" rows split into two parts.
//
//   Price levels   a vertical ladder: the last price, MA50, MA200 and the
//                  macro support zone (a shaded band) at their real heights on
//                  one scale, each labelled with its value and its distance.
//                  Support quality ("3 touches · 1.1× zone volume") sits in the
//                  zone's note rather than as a signal of its own.
//   Signals        RSI (14) on a 0–100 bar with the 30 and 70 bands; MACD as a
//                  state pill and one hedged line (no "Bullish"/"Bearish").
//
// PRESENTATION ONLY. Every value arrives as a prop from what the page already
// computes; lib/ta/priceLadder.ts places and words them. No fetch, no Redis.
import type { CSSProperties, ReactNode } from "react";
import { ReasonedValue } from "@/app/components/EstimatedValue";
import { dateWords, shortDate } from "@/lib/ta/keyLevels";
import { macdSeries, runWords, type MacdSeries } from "@/lib/ta/macdSeries";
import {
  LABEL_OFFSET, LADDER_HEIGHT, LEADER_GAP, MACD_WORDS, ladderMarks, macdState, rsiPct, rsiZone,
  type LadderItem, type LadderMark, type LadderSide,
} from "@/lib/ta/priceLadder";

/** Below the price vs above it: the key says so, and position says it too. */
export const SIDE_COLOUR: Record<LadderSide, string> = { anchor: "#f8fafc", below: "#38bdf8", above: "#f59e0b" };
export const LADDER_KEY = "Distances are from the last price. Blue: below it · amber: above it. Each sits at its own height on the scale.";

export const NOTES = {
  last: "The newest close in the daily prices these levels are measured from.",
  ma50: "The average of the last 50 daily closes, a common read of the medium-term trend.",
  ma200: "The average of the last 200 daily closes, a common read of the long-term trend.",
  zone: "A price band where weekly lows have turned up more than once over the past three years.",
  rsi: "RSI (14) compares the size of recent up days with recent down days over 14 sessions, on a 0–100 scale. Readings above 70 and below 30 are the zones traders call overbought and oversold.",
  macd: "MACD (12, 26, 9) is the gap between a 12-day and a 26-day average of closes; its signal line is a 9-day average of that gap. Above or below describes recent momentum, not what comes next.",
} as const;

const C = {
  label: "rgba(148,163,184,0.75)",
  muted: "rgba(203,213,225,0.62)",
  value: "rgba(241,245,249,0.94)",
  axis: "rgba(255,255,255,0.14)",
  band: "rgba(56,189,248,0.14)",
};

export type LevelsSignalsProps = {
  last: number | null;
  ma50: number | null;
  ma200: number | null;
  /** computeMacroSupport's zone, or null with the reason. */
  zone: { lower: number; upper: number; touches: number; volumeRatio: number | null } | null;
  zoneMissing: string;
  /** Why an MA is missing (too little history), when it is. */
  ma50Missing?: string | null;
  ma200Missing?: string | null;
  rsi: number | null;
  /** buildMacd's tone, or null when MACD can't be computed. */
  macdTone: "green" | "yellow" | "red" | null;
  /** The newest bar's date, and whether it is today's bar so far. */
  asOf: string | null;
  asOfPartial?: boolean;
  credit?: ReactNode;
  /**
   * More levels for the ladder, for later (#563 COWORK #73: built and checked
   * for up to 8 markers). The page passes none yet; the measure script does.
   */
  extraLevels?: LadderItem[];
  /** The bars the page's MACD reading comes from, for the mini chart (#563 COWORK #74). */
  macdBars?: readonly { date: string; close: number }[];
  /** Set ("14:32", or "") when those bars end with today's in-session partial bar (#563 COWORK #75). */
  macdToday?: { time: string | null; phase: "session" | "afterClose" } | null;
};

/** The histogram's colours: the pill's own "above" blue and "below" amber. */
export const MACD_COLOUR = { above: "rgb(56,189,248)", below: "rgb(245,158,11)", line: "rgba(241,245,249,0.85)", signal: "rgba(203,213,225,0.7)" } as const;
export const MACD_CHART_H = 64;

/** "Includes today's session so far (14:32 ET)." / "Includes today's session (close, 16:00 ET, IEX)." (#75/#77), or null. */
export function macdTodayWords(t: LevelsSignalsProps["macdToday"]): string | null {
  if (!t) return null;
  return t.phase === "afterClose"
    ? `Includes today's session (close${t.time ? `, ${t.time} ET` : ""}, IEX).`
    : `Includes today's session so far${t.time ? ` (${t.time} ET)` : ""}.`;
}

/**
 * THE MINI MACD CHART (#563 COWORK #74): the histogram (MACD − signal) as bars
 * either side of a zero line, MACD solid and signal dotted over them, and a
 * marker on the session they last crossed. One shared vertical scale: the
 * largest absolute value of the three in the window.
 */
function MacdChart({ s }: { s: MacdSeries }) {
  const n = s.points.length;
  const r = Math.max(1e-9, ...s.points.flatMap((p) => [Math.abs(p.hist), Math.abs(p.macd), Math.abs(p.signal)]));
  const y = (v: number) => ((r - v) / (2 * r)) * 100;
  const path = (k: "macd" | "signal") => s.points.map((p, i) => `${i ? "L" : "M"}${i + 0.5} ${y(p[k])}`).join(" ");
  const cross = s.crossIndex;
  return (
    <div className="lsMacdChart" style={{ position: "relative", height: MACD_CHART_H, marginTop: 8 }}>
      <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" width="100%" height={MACD_CHART_H} aria-hidden="true" style={{ display: "block", overflow: "visible" }}>
        <line x1={0} x2={n} y1={50} y2={50} stroke="rgba(255,255,255,0.18)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {s.points.map((p, i) => (
          <rect key={p.date} className="lsMacdBar" data-sign={p.hist >= 0 ? "above" : "below"} x={i + 0.2} width={0.6}
            y={Math.min(50, y(p.hist))} height={Math.max(0.5, Math.abs(y(p.hist) - 50))} fill={p.hist >= 0 ? MACD_COLOUR.above : MACD_COLOUR.below} fillOpacity={0.55} />
        ))}
        <path className="lsMacdLineMacd" d={path("macd")} fill="none" stroke={MACD_COLOUR.line} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <path className="lsMacdLineSignal" d={path("signal")} fill="none" stroke={MACD_COLOUR.signal} strokeWidth={1.25} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      </svg>
      {cross !== null ? (
        <span className="lsMacdCross" style={{ position: "absolute", top: 0, bottom: 0, left: `${((cross + 0.5) / n) * 100}%`, width: 0, borderLeft: "1px dashed rgba(241,245,249,0.55)" }} />
      ) : null}
    </div>
  );
}

function asOfWords(asOf: string | null, partial?: boolean): string {
  if (!asOf) return "";
  return partial ? `As of today's trading so far (${dateWords(asOf)}).` : `As of the close on ${dateWords(asOf)}.`;
}

function noteFor(m: LadderMark, p: LevelsSignalsProps, when: string): string {
  if (m.key === "zone" && p.zone) {
    const vol = p.zone.volumeRatio != null ? ` · ${p.zone.volumeRatio.toFixed(1)}× zone volume (weekly volume in the band against the past year's average)` : "";
    return `${NOTES.zone} ${p.zone.touches} touches${vol}. ${when}`;
  }
  return `${(NOTES as Record<string, string>)[m.key] ?? ""} ${when}`.trim();
}

export default function LevelsSignals(p: LevelsSignalsProps) {
  const when = asOfWords(p.asOf, p.asOfPartial);
  const marks = p.last != null ? ladderMarks({ last: p.last, ma50: p.ma50, ma200: p.ma200, zone: p.zone }, LADDER_HEIGHT, p.extraLevels) : [];
  const missing = [
    p.ma50 == null ? `MA50: ${p.ma50Missing ?? "not available"}` : null,
    p.ma200 == null ? `MA200: ${p.ma200Missing ?? "not available"}` : null,
    p.zone == null ? `Macro support: ${p.zoneMissing}` : null,
  ].filter((x): x is string => !!x);
  const macd = p.macdTone ? macdState(p.macdTone) : null;
  const ms = p.macdBars && macd ? macdSeries(p.macdBars) : null;
  return (
    <div className="lsGrid">
      <div className="lsPart">
        <h3 style={partTitleStyle}>Price levels</h3>
        {marks.length ? (
          <div className="lsLadder" style={{ position: "relative", height: LADDER_HEIGHT, marginTop: 14 }}>
            {/* THE PILLAR, CENTRED (#563 COWORK #73): the axis, the zone band and
                each mark's tick at true height, on the column's centre line. */}
            <div className="lsAxis" style={{ position: "absolute", left: "calc(50% - 1px)", top: 0, bottom: 0, width: 2, background: C.axis, borderRadius: 1 }} />
            {marks.filter((m) => m.band).map((m) => (
              <div key={`b-${m.key}`} className="lsBand" style={{ position: "absolute", left: "calc(50% - 11px)", width: 22, top: m.band!.top, height: Math.max(3, m.band!.bottom - m.band!.top), background: C.band, border: `1px solid ${SIDE_COLOUR.below}55`, borderRadius: 3 }} />
            ))}
            {marks.map((m) => (
              <div key={`t-${m.key}`} className="lsTick" data-key={m.key} style={{ position: "absolute", left: m.key === "last" ? "calc(50% - 8px)" : "calc(50% - 5px)", top: m.y - (m.key === "last" ? 3 : 1), width: m.key === "last" ? 16 : 10, height: m.key === "last" ? 6 : 2, borderRadius: 2, background: SIDE_COLOUR[m.side] }} />
            ))}
            {/* LEADERS, one SVG each side of the pillar: from the tick at true
                height to the label's inner edge at its stacked height, stopping
                LEADER_GAP short of the label, so a line never crosses text. */}
            {(["right", "left"] as const).map((side) => (
              <svg key={side} className={`lsLeaders lsLeaders-${side}`} width={LABEL_OFFSET - LEADER_GAP} height={LADDER_HEIGHT} aria-hidden="true"
                style={{ position: "absolute", top: 0, ...(side === "right" ? { left: "50%" } : { right: "50%" }) }}>
                {marks.filter((m) => m.labelSide === side).map((m) => {
                  const w = LABEL_OFFSET - LEADER_GAP;
                  return <line key={m.key} x1={side === "right" ? 0 : w} y1={m.y} x2={side === "right" ? w : 0} y2={m.labelY} stroke={SIDE_COLOUR[m.side]} strokeOpacity={0.5} strokeWidth={1} />;
                })}
              </svg>
            ))}
            {/* NO TRANSFORM ON A LABEL (#563 COWORK #103): A's ReasonedValue note is
                position: fixed, and a transformed ancestor becomes its containing
                block, squashing it into the label's width off the card. So each
                label is centred on its height by a zero-height flex row instead
                of translateY(-50%). measure-level-notes.mjs taps every label. */}
            {marks.map((m) => (
              <div key={`l-${m.key}`} className="lsLabel" data-key={m.key} data-side={m.side} data-label-side={m.labelSide}
                style={{
                  position: "absolute", top: m.labelY, height: 0, display: "flex", alignItems: "center", minWidth: 0,
                  ...(m.labelSide === "right"
                    ? { left: `calc(50% + ${LABEL_OFFSET}px)`, right: 0, justifyContent: "flex-start" }
                    : { left: 0, right: `calc(50% + ${LABEL_OFFSET}px)`, justifyContent: "flex-end" }),
                }}>
                <div className="lsLabelBody" style={{ display: "flex", flexDirection: "column", gap: 3, lineHeight: 1.2, minWidth: 0, alignItems: m.labelSide === "right" ? "flex-start" : "flex-end", textAlign: m.labelSide === "right" ? "left" : "right" }}>
                {/* THE ANCHOR STAYS BOLDER on whichever side it falls (#73). */}
                <span style={{ fontSize: m.key === "last" ? "0.875rem" : "0.8125rem", fontWeight: m.key === "last" ? 900 : 800, color: SIDE_COLOUR[m.side] }}>
                  <ReasonedValue text={m.name} reason={noteFor(m, p, when)} />
                </span>
                <span className="lsValue" style={{ fontSize: "0.75rem", color: m.key === "last" ? C.value : C.muted, fontWeight: m.key === "last" ? 800 : 600 }}>{m.valueText}</span>
                {m.distText ? <span className="lsDist" style={{ fontSize: "var(--fs-label)", color: C.muted }}>{m.distText}</span> : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {marks.length > 1 ? <p className="lsKey" style={readStyle}>{LADDER_KEY}</p> : null}
        {missing.map((m) => <p key={m} className="lsMissing" style={readStyle}>{m}</p>)}
        {when ? <p data-fine-print style={noteStyle}>{when}</p> : null}
      </div>

      <div className="lsPart">
        <h3 style={partTitleStyle}>Signals</h3>
        <div style={{ marginTop: 14 }}>
          <div style={gaugeHeadStyle}>
            <span style={{ fontWeight: 800, color: C.value }}><ReasonedValue text="RSI (14)" reason={`${NOTES.rsi} ${when}`} /></span>
            <span className="lsRsiValue" style={{ fontWeight: 800, color: C.value }}>{p.rsi != null ? p.rsi.toFixed(1) : "—"}</span>
          </div>
          {p.rsi != null ? (
            <>
              <div className="lsRsi" style={{ position: "relative", height: 10, marginTop: 8, borderRadius: 5, background: "rgba(255,255,255,0.06)" }}>
                <div style={{ position: "absolute", left: 0, width: "30%", top: 0, bottom: 0, borderRadius: "5px 0 0 5px", background: "rgba(56,189,248,0.18)" }} />
                <div style={{ position: "absolute", left: "70%", right: 0, top: 0, bottom: 0, borderRadius: "0 5px 5px 0", background: "rgba(245,158,11,0.18)" }} />
                <div className="lsRsiMark" style={{ position: "absolute", left: `${rsiPct(p.rsi)}%`, top: -3, width: 4, height: 16, marginLeft: -2, borderRadius: 2, background: "#f8fafc" }} />
              </div>
              <div className="lsRsiAxis" style={{ position: "relative", height: 13, fontSize: "var(--fs-label)", color: C.muted, marginTop: 3 }}>
                {[0, 30, 70, 100].map((t) => <span key={t} style={{ position: "absolute", left: `${t}%`, transform: t === 0 ? "none" : t === 100 ? "translateX(-100%)" : "translateX(-50%)" }}>{t}</span>)}
              </div>
              <div className="lsRsiZone" style={{ marginTop: 4, fontSize: "0.8125rem", color: C.muted }}>{rsiZone(p.rsi)}</div>
            </>
          ) : <p style={readStyle}>Momentum unavailable: not enough daily prices on file.</p>}
        </div>
        <div style={{ marginTop: 18 }}>
          <div style={gaugeHeadStyle}>
            <span style={{ fontWeight: 800, color: C.value }}><ReasonedValue text="MACD" reason={`${NOTES.macd} ${macdTodayWords(p.macdToday) ?? when}`} /></span>
            {macd ? <span className="lsMacdPill" data-state={macd} style={pillStyle(macd)}>{macd === "above" ? "▲ " : macd === "below" ? "▼ " : "– "}{MACD_WORDS[macd].pill}</span> : <span>—</span>}
          </div>
          {ms ? <MacdChart s={ms} /> : null}
          {ms ? (
            <div className="lsMacdKey" style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginTop: 3, fontSize: "var(--fs-label)", color: C.muted }}>
              {/* THE SWATCHES ARE THE LINES THEMSELVES (#563 COWORK #77): solid MACD, dotted signal. */}
              <span className="lsMacdLegend" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <svg className="lsSwatchMacd" width="14" height="6" aria-hidden="true"><line x1="0" y1="3" x2="14" y2="3" stroke={MACD_COLOUR.line} strokeWidth="1.5" /></svg>MACD
                <svg className="lsSwatchSignal" width="14" height="6" aria-hidden="true" style={{ marginLeft: 6 }}><line x1="0" y1="3" x2="14" y2="3" stroke={MACD_COLOUR.signal} strokeWidth="1.25" strokeDasharray="3 3" /></svg>Signal
              </span>
              {ms.crossIndex !== null ? <span className="lsMacdCrossed">crossed {shortDate(ms.points[ms.crossIndex].date)}</span> : null}
            </div>
          ) : null}
          {/* THE RUN, NOT A CALL (#74): "below its signal line for 6 sessions". */}
          <div className="lsMacdLine" style={{ marginTop: 6, fontSize: "var(--fs-read)", lineHeight: 1.5, color: C.muted }}>
            {macd ? (macd !== "near" && ms ? `${MACD_WORDS[macd].line} ${runWords(ms)}` : MACD_WORDS[macd].line) : "Momentum unavailable: not enough daily prices on file."}
          </div>
        </div>
      </div>
      {p.credit ? <p className="lsCredit" data-fine-print style={{ ...noteStyle, gridColumn: "1 / -1" }}>Daily prices: {p.credit}</p> : null}

      <style>{`
        .lsGrid { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 28px; }
        .lsPart { min-width: 0; }
        @media (max-width: 640px) { .lsGrid { grid-template-columns: minmax(0, 1fr); gap: 22px; } }
        /* Half a 320 px column per side: labels a size smaller so "$23,700–$24,300" stays on two lines at most. */
        @media (max-width: 360px) { .lsLabelBody { line-height: 1.15 !important; } .lsLabelBody > span:first-child { font-size: 0.75rem !important; } .lsValue, .lsDist { font-size: var(--fs-label) !important; } }
      `}</style>
    </div>
  );
}

function pillStyle(state: "above" | "below" | "near"): CSSProperties {
  const rgb = state === "above" ? "56,189,248" : state === "below" ? "245,158,11" : "148,163,184";
  return { padding: "3px 9px", borderRadius: 999, fontSize: "0.75rem", fontWeight: 800, color: `rgb(${rgb})`, background: `rgba(${rgb},0.12)`, border: `1px solid rgba(${rgb},0.35)`, whiteSpace: "nowrap" };
}
const partTitleStyle: CSSProperties = { margin: 0, fontSize: "0.8125rem", fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: C.label };
const noteStyle: CSSProperties = { margin: "8px 0 0 0", fontSize: "var(--fs-fine)", lineHeight: 1.5, color: C.muted };
const readStyle: CSSProperties = { ...noteStyle, fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)" };
const gaugeHeadStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, fontSize: "0.875rem" };
