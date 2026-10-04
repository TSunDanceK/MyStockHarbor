"use client";
// "LEVELS TO WATCH" (#563 COWORK #93): a small card under Key levels on the SPX
// page, filling the space Price zones' taller ladder leaves. Its lines are
// lib/ta/levelsGlance.ts over confluence() with exactly the Price zones card's
// inputs (the page passes both the same object), so the numbers always match.
// Short on purpose: what the levels are is Price zones' job (its tap notes).
import type { CSSProperties, ReactNode } from "react";
import type { KeyBar } from "@/lib/ta/keyLevels";
import { confluence } from "@/lib/ta/confluence";
import { glanceLines } from "@/lib/ta/levelsGlance";
import { ZONE_COLOUR } from "@/app/stock/[symbol]/ConfluenceCard";

export default function LevelsGlanceCard({ bars, lastPrice, nowMs, ma50, ma200, macro, shownOn, credit }: {
  bars: readonly KeyBar[];
  lastPrice?: number | null;
  nowMs?: number;
  ma50?: number | null;
  ma200?: number | null;
  macro?: { lower: number; upper: number } | null;
  /** "Shown on SPY" */
  shownOn: string;
  credit?: ReactNode;
}) {
  const c = confluence({ bars, nowMs, lastPrice, ma50, ma200, macro });
  const lines = glanceLines(c);
  return (
    <section className="lgCard" style={lgCardStyle}>
      <div style={lgEyebrowStyle}>At a glance</div>
      <h2 style={lgTitleStyle}>Levels to watch</h2>
      {lines.length ? (
        <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 8 }}>
          {lines.map((l) => (
            <li key={l.kind} className="lgLine" data-kind={l.kind} data-side={l.side}
              style={{ fontSize: l.kind === "main" || l.kind === "inside" ? "1.0625rem" : "var(--fs-read)", lineHeight: "var(--lh-read)", color: "rgba(226,232,240,0.9)", overflowWrap: "anywhere" }}>
              {l.lead ? <strong style={{ color: ZONE_COLOUR[l.side], fontWeight: 850 }}>{l.lead}</strong> : <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: ZONE_COLOUR[l.side], marginRight: 7 }} aria-hidden="true" />}
              {l.text}
            </li>
          ))}
        </ul>
      ) : <p style={{ ...lgNoteStyle, fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)" }}>{c.reason}</p>}
      <p className="lgCredit" data-fine-print style={lgNoteStyle}>{shownOn}{credit ? <> · Daily prices: {credit}</> : null}</p>
    </section>
  );
}

const lgCardStyle: CSSProperties = {
  border: "1px solid rgba(148,163,184,0.25)",
  borderRadius: 20,
  padding: 18,
  background: "linear-gradient(135deg, rgba(148,163,184,0.07), rgba(255,255,255,0.022))",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  minWidth: 0,
  boxSizing: "border-box",
};
const lgEyebrowStyle: CSSProperties = { fontSize: "var(--fs-label)", fontWeight: 950, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(147,197,253,0.82)" };
const lgTitleStyle: CSSProperties = { margin: "8px 0 0", fontSize: "1.375rem", lineHeight: 1.12, letterSpacing: "-0.03em" };
const lgNoteStyle: CSSProperties = { margin: "10px 0 0 0", fontSize: "var(--fs-fine)", lineHeight: 1.5, color: "rgba(203,213,225,0.62)" };
