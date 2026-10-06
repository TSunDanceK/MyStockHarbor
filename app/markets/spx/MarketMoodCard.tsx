"use client";
// MARKET MOOD ON THE OWNER'S THERMOMETER (#563 COWORK #96), in the SPX hero
// where the weekly "Sentiment" tile was. The look is the retired "Market mood"
// gauge's (app/markets/spx/_retired/spx-page-2026-10-04.tsx.txt: its card tone,
// the tube, the bulb and the red → green fill); the number is lib/marketMood.ts,
// computed nightly from our own data, read through the Data Cache.
//
//   face       "Market Mood", the 0–100 reading, its label, the reading's date,
//              a 90-day sparkline, and the Tiingo credit
//   tap note   each available input with its own 0–100, then what it is and
//              isn't (no option-market data); a description, not a forecast
//
// No reading on file shows that plainly, never a made-up 50.
import type { CSSProperties, ReactNode } from "react";
import { useRef } from "react";
import { MOOD_INPUTS, type MoodDay, type MoodLabel } from "@/lib/marketMood";
import { FlowPanel, NoteButton, useIsPhone, useTapNote } from "@/app/stock/[symbol]/TapNote";

export type MoodCardView = { day: MoodDay & { r: number }; label: MoodLabel; spark: { d: string; r: number }[] };

/** The tone bands of the old gauge, on the label's edges: ≤44 red, 45–55 amber, ≥56 green. */
export const moodTone = (r: number) => (r >= 56 ? "green" : r <= 44 ? "red" : "amber");
const TONE = {
  green: { text: "#86efac", bulb: "#22c55e", glow: "rgba(34,197,94,0.45)", border: "rgba(34,197,94,0.30)", bg: "linear-gradient(135deg, rgba(34,197,94,0.16), rgba(7,16,12,0.96))" },
  amber: { text: "#fde68a", bulb: "#eab308", glow: "rgba(234,179,8,0.42)", border: "rgba(250,204,21,0.30)", bg: "linear-gradient(135deg, rgba(250,204,21,0.14), rgba(18,16,8,0.96))" },
  red: { text: "#fecaca", bulb: "#ef4444", glow: "rgba(239,68,68,0.45)", border: "rgba(248,113,113,0.30)", bg: "linear-gradient(135deg, rgba(248,113,113,0.14), rgba(18,10,10,0.96))" },
} as const;

/** The tap note's closing words; N is how many measures went into the reading. */
export const moodNoteText = (n: number) =>
  `Our reading of market mood from ${n} public market measures on our own data. A description, not a forecast. Option-market data isn't included.`;

/** "Fri 2 Oct 2026" */
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayWords = (d: string) => { const t = new Date(`${d}T00:00:00Z`); return `${DAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`; };

/** The last 90 readings as a line on a fixed 0–100 scale, with the 50 line. */
export function MoodSpark({ spark }: { spark: { d: string; r: number }[] }) {
  if (spark.length < 2) return null;
  const W = 240, H = 44;
  const pts = spark.map((p, i) => `${((i / (spark.length - 1)) * W).toFixed(1)},${(H - (p.r / 100) * H).toFixed(1)}`).join(" ");
  return (
    // FILLS THE CARD (#563 COWORK #129): in the SPX hero the card is a flex
    // column, so the line takes the row's spare height; never below H.
    <figure className="moodSpark" style={{ margin: "12px 0 0", flex: "1 1 auto", display: "flex", flexDirection: "column" }}>
      <div className="moodSparkPlot" style={{ position: "relative", flex: "1 1 auto", minHeight: H }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none" role="img" aria-label={`Market Mood over the last ${spark.length} sessions, from ${spark[0].r} to ${spark[spark.length - 1].r}`} style={{ position: "absolute", inset: 0, display: "block", overflow: "visible" }}>
          <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <polyline points={pts} fill="none" stroke="rgba(241,245,249,0.85)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
      </div>
      <figcaption style={{ marginTop: 4, fontSize: "var(--fs-read)", lineHeight: 1.5, color: "rgba(203,213,225,0.72)" }}>Last {spark.length} sessions · the dashed line is 50</figcaption>
    </figure>
  );
}

export default function MarketMoodCard({ view, credit }: { view: MoodCardView | null; credit?: ReactNode }) {
  const note = useTapNote();
  const phone = useIsPhone();
  const head = useRef<HTMLDivElement | null>(null);
  if (!view) {
    return (
      <aside className="moodCard" style={{ ...cardStyle, border: `1px solid ${TONE.amber.border}`, background: TONE.amber.bg }}>
        <div style={eyebrowStyle}>Market Mood</div>
        <p style={{ margin: "10px 0 0", fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", color: "rgba(241,245,249,0.72)" }}>
          Market Mood will appear after tonight&apos;s update.
        </p>
      </aside>
    );
  }
  const { day, label, spark } = view;
  const t = TONE[moodTone(day.r)];
  const inputs = MOOD_INPUTS.filter((x) => typeof day.s[x.key] === "number");
  // The gradient spans the whole tube (red at 0, green at 100), so a fill of 37 ends in orange, not green.
  const fillPct = Math.max(7, Math.min(100, day.r));
  return (
    <aside className="moodCard" style={{ ...cardStyle, border: `1px solid ${t.border}`, background: t.bg }}>
      <div ref={head} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={eyebrowStyle}>Market Mood</h2>
        <span style={{ fontSize: "var(--fs-read)", color: "rgba(203,213,225,0.72)" }}><NoteButton note={note}>What goes into it?</NoteButton></span>
      </div>
      <FlowPanel note={note} anchor={head} phone={phone} label="What goes into Market Mood" pointerX={180}>
        <ul className="moodInputs" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
          {inputs.map((x) => (
            <li key={x.key} className="moodInput" data-input={x.key} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <span>{x.line}</span><strong style={{ color: "rgba(241,245,249,0.94)", fontVariantNumeric: "tabular-nums" }}>{day.s[x.key]}</strong>
            </li>
          ))}
        </ul>
        <p className="moodNoteText" style={{ margin: "8px 0 0", fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", color: "rgba(203,213,225,0.7)" }}>{moodNoteText(inputs.length)}</p>
      </FlowPanel>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "56px minmax(0, 1fr)", gap: 14, alignItems: "center" }}>
        {/* THE THERMOMETER: the tube, filled red → green to the reading's height, and the bulb in the reading's tone. */}
        <div className="moodThermo" aria-hidden="true" style={{ position: "relative", height: 170, display: "flex", justifyContent: "center" }}>
          <div style={{ position: "relative", width: 30, height: 150, borderRadius: 999, border: "3px solid rgba(255,255,255,0.48)", background: "rgba(2,6,23,0.62)", overflow: "hidden", boxShadow: "0 0 24px rgba(255,255,255,0.10)", boxSizing: "border-box" }}>
            <div className="moodFill" style={{ position: "absolute", left: 5, right: 5, bottom: 5, height: `${fillPct}%`, borderRadius: 999, background: "linear-gradient(0deg, #ef4444 0%, #f97316 28%, #eab308 50%, #84cc16 72%, #22c55e 100%)", backgroundSize: `100% ${(100 * 100) / fillPct}%`, backgroundPosition: "bottom", backgroundRepeat: "no-repeat", boxShadow: `0 0 18px ${t.glow}` }} />
          </div>
          <div style={{ position: "absolute", bottom: 0, width: 42, height: 42, borderRadius: 999, border: "3px solid rgba(255,255,255,0.48)", background: t.bulb, boxShadow: `0 0 20px ${t.glow}`, boxSizing: "border-box" }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="moodValue" style={{ fontSize: "2.375rem", lineHeight: 1, fontWeight: 950, letterSpacing: "-0.06em" }}>
            {day.r}<span style={{ fontSize: "1rem", fontWeight: 700, opacity: 0.7, letterSpacing: 0 }}>/100</span>
          </div>
          <div className="moodLabel" style={{ marginTop: 8, fontSize: "1.125rem", fontWeight: 950, color: t.text }}>{label}</div>
          <div className="moodDate" data-fine-print style={{ marginTop: 6, fontSize: "var(--fs-fine)", color: "rgba(203,213,225,0.72)" }}>Reading for {dayWords(day.d)}</div>
          <div style={{ marginTop: 6, fontSize: "var(--fs-read)", lineHeight: 1.45, color: "rgba(203,213,225,0.72)" }}>{day.n} market measures · 0 = extreme fear, 100 = extreme greed</div>
        </div>
      </div>
      <MoodSpark spark={spark} />
      {credit ? <p className="moodCredit" data-fine-print style={{ margin: "10px 0 0", fontSize: "var(--fs-fine)", lineHeight: 1.5, color: "rgba(203,213,225,0.62)" }}>Daily prices: {credit}</p> : null}
    </aside>
  );
}

const cardStyle: CSSProperties = { borderRadius: 20, padding: 18, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)", minWidth: 0, boxSizing: "border-box", position: "relative" };
const eyebrowStyle: CSSProperties = { margin: 0, fontSize: "var(--fs-label)", fontWeight: 950, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(241,245,249,0.82)" };
