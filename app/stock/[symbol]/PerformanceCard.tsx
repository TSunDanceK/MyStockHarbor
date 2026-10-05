"use client";
// "PERFORMANCE VS THE S&P 500" (#563 COWORK #111): the 1M–5Y returns as one card
// in the stock page's left column, under Key levels and above Latest earnings
// (after the stat row and before the chart on a phone). It replaces the
// header's six period boxes.
//
// One row per period: the label; a bar from a centre zero line (green right for
// a gain, red left for a loss) with the S&P 500's change as a thin tick on the
// same square-root scale; the return and a "pts vs S&P" chip. A tap on the
// title opens what each row measures, the as-of time, the tick and the scale.
//
// Presentation only: the numbers are the performance strip's (lib/ta/
// performance.ts, computed server-side), placed by lib/ta/performanceCard.ts.
// NO TRANSFORM anywhere here, and no ReasonedValue (#563 COWORK #103).
import { useRef, type CSSProperties, type ReactNode } from "react";
import type { PerfStrip } from "@/lib/ta/performance";
import { performanceCard, rowPctWords, type PerfRow } from "@/lib/ta/performanceCard";
import { FlowPanel, NoteButton, useIsPhone, useTapNote } from "./TapNote";

const C = {
  up: "#4ade80", down: "#f87171", flat: "rgba(226,232,240,0.8)",
  label: "rgba(147,197,253,0.82)", muted: "rgba(203,213,225,0.62)", value: "rgba(241,245,249,0.94)",
  track: "rgba(255,255,255,0.06)", zero: "rgba(255,255,255,0.28)", tick: "#e2e8f0",
};
const VS = { ahead: { fg: "#86efac", bg: "rgba(34,197,94,0.12)" }, behind: { fg: "#fca5a5", bg: "rgba(239,68,68,0.12)" }, level: { fg: C.muted, bg: "rgba(148,163,184,0.10)" } };

/** One period: label, bar with its S&P 500 tick, return and chip. */
export function PerfRowView({ r, valueRem }: { r: PerfRow; valueRem: number }) {
  const lo = r.barTo === null ? 50 : Math.min(50, r.barTo), hi = r.barTo === null ? 50 : Math.max(50, r.barTo);
  return (
    <li className="pcRow" data-key={r.key} data-tone={r.tone} data-vs={r.vs ?? "none"} style={{ ...rowStyle, gridTemplateColumns: `2.75rem minmax(0, 1fr) ${valueRem}rem` }}>
      <div className="pcKey" style={{ fontSize: "var(--fs-label)", fontWeight: 800, letterSpacing: "0.06em", color: C.muted }}>
        {r.key}
        {r.tag ? <div className="pcTag" data-tag={r.tag} style={{ marginTop: 2, fontSize: "var(--fs-fine)", fontWeight: 700, letterSpacing: 0, color: r.tag === "best" ? C.up : C.down }}>{r.tag}</div> : null}
      </div>
      <div className="pcTrack" aria-hidden="true" style={{ position: "relative", height: 14, borderRadius: 7, background: C.track }}>
        <div className="pcZero" style={{ position: "absolute", left: "50%", top: -3, bottom: -3, width: 1, marginLeft: -0.5, background: C.zero }} />
        {r.barTo === null ? null : (
          <div className="pcBar" style={{ position: "absolute", top: 3, height: 8, left: `${lo}%`, width: `${Math.max(0.6, hi - lo)}%`, borderRadius: 4, background: r.tone === "down" ? C.down : r.tone === "up" ? C.up : C.flat }} />
        )}
        {r.tick === null ? null : (
          <div className="pcTick" style={{ position: "absolute", left: `${r.tick}%`, top: -2, bottom: -2, width: 2, marginLeft: -1, borderRadius: 1, background: C.tick, boxShadow: "0 0 0 1px rgba(6,8,13,0.9)" }} />
        )}
      </div>
      <div className="pcPct" style={{ textAlign: "right", fontSize: "0.9375rem", fontWeight: 850, color: C[r.tone], whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{rowPctWords(r)}</div>
      {/* The chip on its own line under the bar, so every row's track has the same width and the same zero line. */}
      {r.vs && r.vsWords ? (
        <div style={{ gridColumn: "2 / 4", justifySelf: "end" }}>
          <span className="pcVs" style={{ display: "inline-block", padding: "1px 6px", borderRadius: 999, fontSize: "var(--fs-fine)", fontWeight: 700, color: VS[r.vs].fg, background: VS[r.vs].bg, whiteSpace: "nowrap" }}>{r.vsWords}</span>
        </div>
      ) : null}
    </li>
  );
}

export default function PerformanceCard({ strip, credit }: { strip: PerfStrip; credit?: ReactNode }) {
  const note = useTapNote();
  const phone = useIsPhone();
  const head = useRef<HTMLDivElement | null>(null);
  if (!strip.chips.length) return null;
  const card = performanceCard(strip);
  // ONE value column for every row, sized to the card's widest return (about 0.7rem a character at
  // this weight, tabular figures), so every row's track has the same width and the same zero line.
  const valueRem = Math.max(5.25, Math.max(...card.rows.map((r) => rowPctWords(r).length)) * 0.7 + 0.35);
  const stamp = strip.live
    ? strip.live.phase === "afterClose" ? `To the close${strip.live.time ? `, ${strip.live.time} ET` : ""} (IEX)` : `To the last price${strip.live.time ? `, ${strip.live.time} ET` : ""} (IEX)`
    : strip.asOfWords ? `To the close on ${strip.asOfWords}` : null;
  return (
    <section className="pcCard" style={cardStyle}>
      <div className="pcEyebrow" style={eyebrowStyle}>Performance</div>
      <div ref={head} style={{ marginTop: 8 }}>
        <h2 style={titleStyle}><NoteButton note={note}>{strip.benchmark ? "Performance vs the S&P 500" : "Performance"}</NoteButton></h2>
        {card.summary ? <p className="pcSummary" style={{ margin: "6px 0 0", fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", color: C.value }}>{card.summary}</p> : null}
      </div>
      <FlowPanel note={note} anchor={head} phone={phone} label="How these are measured" pointerX={60}>
        <div className="pcNote" style={{ fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)" }}>
          {card.note.map((t) => <p key={t} style={{ margin: "0 0 6px" }}>{t}</p>)}
        </div>
      </FlowPanel>
      <ul className="pcRows" style={{ listStyle: "none", margin: "12px 0 0", padding: 0 }}>
        {card.rows.map((r) => <PerfRowView key={r.key} r={r} valueRem={valueRem} />)}
      </ul>
      {stamp ? <p className="pcStamp" data-fine-print style={noteStyle}>{stamp} · price change only{credit ? <> · {credit}</> : null}</p> : null}
      <style>{`
        .pcRow { transition: background-color 120ms ease; }
        .pcRow:hover, .pcRow:active { background: rgba(255,255,255,0.035); }
      `}</style>
    </section>
  );
}

const cardStyle: CSSProperties = {
  position: "relative", border: "1px solid rgba(148,163,184,0.25)", borderRadius: 20, padding: 18, minWidth: 0,
  background: "linear-gradient(135deg, rgba(148,163,184,0.07), rgba(255,255,255,0.022))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
};
const eyebrowStyle: CSSProperties = { fontSize: "var(--fs-label)", fontWeight: 950, letterSpacing: "0.1em", textTransform: "uppercase", color: C.label };
const titleStyle: CSSProperties = { margin: 0, fontSize: "1.375rem", lineHeight: 1.12, letterSpacing: "-0.03em" };
const rowStyle: CSSProperties = {
  // The columns are set per card (PerformanceCard: the label and one value width for every row).
  display: "grid", alignItems: "center", columnGap: 10, rowGap: 3,
  padding: "7px 6px", margin: "0 -6px", borderRadius: 10,
};
const noteStyle: CSSProperties = { margin: "10px 0 0 0", fontSize: "var(--fs-fine)", lineHeight: 1.5, color: C.muted };
