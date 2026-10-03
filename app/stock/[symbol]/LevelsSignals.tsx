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
import { dateWords } from "@/lib/ta/keyLevels";
import {
  LADDER_HEIGHT, MACD_WORDS, ladderMarks, macdState, rsiPct, rsiZone,
  type LadderMark, type LadderSide,
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
};

function asOfWords(asOf: string | null, partial?: boolean): string {
  if (!asOf) return "";
  return partial ? `As of today's trading so far (${dateWords(asOf)}).` : `As of the close on ${dateWords(asOf)}.`;
}

function noteFor(m: LadderMark, p: LevelsSignalsProps, when: string): string {
  if (m.key === "zone" && p.zone) {
    const vol = p.zone.volumeRatio != null ? ` · ${p.zone.volumeRatio.toFixed(1)}× zone volume (weekly volume in the band against the past year's average)` : "";
    return `${NOTES.zone} ${p.zone.touches} touches${vol}. ${when}`;
  }
  return `${NOTES[m.key]} ${when}`;
}

export default function LevelsSignals(p: LevelsSignalsProps) {
  const when = asOfWords(p.asOf, p.asOfPartial);
  const marks = p.last != null ? ladderMarks({ last: p.last, ma50: p.ma50, ma200: p.ma200, zone: p.zone }) : [];
  const missing = [
    p.ma50 == null ? `MA50: ${p.ma50Missing ?? "not available"}` : null,
    p.ma200 == null ? `MA200: ${p.ma200Missing ?? "not available"}` : null,
    p.zone == null ? `Macro support: ${p.zoneMissing}` : null,
  ].filter((x): x is string => !!x);
  const macd = p.macdTone ? macdState(p.macdTone) : null;
  return (
    <div className="lsGrid">
      <div className="lsPart">
        <h3 style={partTitleStyle}>Price levels</h3>
        {marks.length ? (
          <div className="lsLadder" style={{ position: "relative", height: LADDER_HEIGHT, marginTop: 14 }}>
            {/* the axis, the zone band and each mark's tick, at true height */}
            <div style={{ position: "absolute", left: 10, top: 0, bottom: 0, width: 2, background: C.axis, borderRadius: 1 }} />
            {marks.filter((m) => m.band).map((m) => (
              <div key="band" className="lsBand" style={{ position: "absolute", left: 0, width: 22, top: m.band!.top, height: Math.max(3, m.band!.bottom - m.band!.top), background: C.band, border: `1px solid ${SIDE_COLOUR.below}55`, borderRadius: 3 }} />
            ))}
            {marks.map((m) => (
              <div key={`t-${m.key}`} className="lsTick" data-key={m.key} style={{ position: "absolute", left: m.key === "last" ? 4 : 6, top: m.y - (m.key === "last" ? 3 : 1), width: m.key === "last" ? 14 : 10, height: m.key === "last" ? 6 : 2, borderRadius: 2, background: SIDE_COLOUR[m.side] }} />
            ))}
            {/* leaders from each tick to its stacked label */}
            <svg className="lsLeaders" width="28" height={LADDER_HEIGHT} style={{ position: "absolute", left: 22, top: 0, overflow: "visible" }} aria-hidden="true">
              {marks.map((m) => <line key={m.key} x1={0} y1={m.y} x2={28} y2={m.labelY} stroke={SIDE_COLOUR[m.side]} strokeOpacity={0.5} strokeWidth={1} />)}
            </svg>
            {marks.map((m) => (
              <div key={`l-${m.key}`} className="lsLabel" data-key={m.key} data-side={m.side} style={{ position: "absolute", left: 54, right: 0, top: m.labelY, transform: "translateY(-50%)", display: "flex", flexDirection: "column", lineHeight: 1.2, minWidth: 0, whiteSpace: "nowrap" }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: SIDE_COLOUR[m.side] }}>
                  <ReasonedValue text={m.name} reason={noteFor(m, p, when)} />
                </span>
                <span className="lsWords" style={{ fontSize: 12, color: m.key === "last" ? C.value : C.muted, fontWeight: m.key === "last" ? 800 : 500, overflow: "hidden", textOverflow: "ellipsis" }}>{m.words}</span>
              </div>
            ))}
          </div>
        ) : null}
        {marks.length > 1 ? <p className="lsKey" style={noteStyle}>{LADDER_KEY}</p> : null}
        {missing.map((m) => <p key={m} className="lsMissing" style={noteStyle}>{m}</p>)}
        {when ? <p style={noteStyle}>{when}</p> : null}
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
              <div className="lsRsiAxis" style={{ position: "relative", height: 13, fontSize: 10, color: C.muted, marginTop: 3 }}>
                {[0, 30, 70, 100].map((t) => <span key={t} style={{ position: "absolute", left: `${t}%`, transform: t === 0 ? "none" : t === 100 ? "translateX(-100%)" : "translateX(-50%)" }}>{t}</span>)}
              </div>
              <div className="lsRsiZone" style={{ marginTop: 4, fontSize: 13, color: C.muted }}>{rsiZone(p.rsi)}</div>
            </>
          ) : <p style={noteStyle}>Momentum unavailable: not enough daily prices on file.</p>}
        </div>
        <div style={{ marginTop: 18 }}>
          <div style={gaugeHeadStyle}>
            <span style={{ fontWeight: 800, color: C.value }}><ReasonedValue text="MACD" reason={`${NOTES.macd} ${when}`} /></span>
            {macd ? <span className="lsMacdPill" data-state={macd} style={pillStyle(macd)}>{macd === "above" ? "▲ " : macd === "below" ? "▼ " : "– "}{MACD_WORDS[macd].pill}</span> : <span>—</span>}
          </div>
          <div className="lsMacdLine" style={{ marginTop: 6, fontSize: 13, color: C.muted }}>{macd ? MACD_WORDS[macd].line : "Momentum unavailable: not enough daily prices on file."}</div>
        </div>
      </div>
      {p.credit ? <p className="lsCredit" style={{ ...noteStyle, gridColumn: "1 / -1" }}>Daily prices: {p.credit}</p> : null}

      <style>{`
        .lsGrid { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 28px; }
        .lsPart { min-width: 0; }
        @media (max-width: 640px) { .lsGrid { grid-template-columns: minmax(0, 1fr); gap: 22px; } }
      `}</style>
    </div>
  );
}

function pillStyle(state: "above" | "below" | "near"): CSSProperties {
  const rgb = state === "above" ? "56,189,248" : state === "below" ? "245,158,11" : "148,163,184";
  return { padding: "3px 9px", borderRadius: 999, fontSize: 12, fontWeight: 800, color: `rgb(${rgb})`, background: `rgba(${rgb},0.12)`, border: `1px solid rgba(${rgb},0.35)`, whiteSpace: "nowrap" };
}
const partTitleStyle: CSSProperties = { margin: 0, fontSize: 13, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: C.label };
const noteStyle: CSSProperties = { margin: "8px 0 0 0", fontSize: 11.5, lineHeight: 1.5, color: C.muted };
const gaugeHeadStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, fontSize: 14 };
