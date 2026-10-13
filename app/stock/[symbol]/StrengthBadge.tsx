"use client";
// THE STRENGTH BADGE'S PILL (#563 COWORK #105): one word left of Share, under
// the ticker on phones; a tap opens every input with its points, the hold, the
// not-a-recommendation line and the Tiingo credit. Presentation only: the page
// scores it server-side (lib/strengthBadge.ts) from the bars it already reads.
//
// Two copies render (the page's CSS shows one): "top" in the header's top row,
// "under" in the ticker's row on a phone. Each opens its note across its own
// row (FlowPanel, anchored after the row; inline on a phone).
//
// NO TRANSFORM anywhere in here (the pill, its row, the note): a transformed
// ancestor would capture a position: fixed note (#563 COWORK #105).
import { useCallback, useState, type ReactNode, type RefObject } from "react";
import { CUTOFFS_WORDS, NOT_ADVICE, signed, type StrengthBadge, type StrengthWord } from "@/lib/strengthBadge";
import { FlowPanel, NoteButton, useIsPhone, useTapNote } from "./TapNote";

const TONE: Record<StrengthWord | "none", { fg: string; bg: string; border: string }> = {
  Strong: { fg: "#4ade80", bg: "rgba(34,197,94,0.12)", border: "rgba(74,222,128,0.45)" },
  Firm: { fg: "#a3e635", bg: "rgba(132,204,22,0.10)", border: "rgba(163,230,53,0.40)" },
  Neutral: { fg: "rgba(226,232,240,0.88)", bg: "rgba(148,163,184,0.10)", border: "rgba(148,163,184,0.38)" },
  Soft: { fg: "#fbbf24", bg: "rgba(245,158,11,0.10)", border: "rgba(251,191,36,0.40)" },
  Weak: { fg: "#f87171", bg: "rgba(239,68,68,0.10)", border: "rgba(248,113,113,0.45)" },
  none: { fg: "rgba(203,213,225,0.72)", bg: "rgba(148,163,184,0.06)", border: "rgba(148,163,184,0.28)" },
};

/** The note's body: the inputs and their points, the cut-offs, the hold, the line, the credit. */
export function StrengthNoteBody({ badge, credit }: { badge: StrengthBadge; credit?: ReactNode }) {
  return (
    <div className="strengthNote">
      <div style={{ fontWeight: 800 }}>
        Strength: {badge.word ?? "Not enough data"}
        {badge.total !== null && badge.asOfWords ? <span style={{ fontWeight: 600, color: "rgba(203,213,225,0.8)" }}> · total {signed(badge.total)} on {badge.asOfWords}</span> : null}
      </div>
      <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
        {badge.lines.map((l) => (
          <li key={l.key} data-input={l.key} data-counted={l.counted ? "1" : "0"}>
            <strong>{l.label}:</strong> {l.reading} · <strong>{signed(l.points)}</strong> {Math.abs(l.points) === 1 ? "point" : "points"}
          </li>
        ))}
      </ul>
      <p style={{ margin: "6px 0 0" }}>{CUTOFFS_WORDS}</p>
      <p className="strengthHold" style={{ margin: "6px 0 0" }}>{badge.hold}</p>
      <p className="strengthNotAdvice" style={{ margin: "6px 0 0" }}>{NOT_ADVICE}</p>
      {credit ? <p data-fine-print style={{ margin: "6px 0 0", fontSize: "var(--fs-fine)", opacity: 0.7 }}>Prices: {credit}</p> : null}
    </div>
  );
}

/**
 * One copy's state: its note, and where its pointer sits (under the pill,
 * measured from the row marked data-strength-row when the pill is tapped).
 */
export function useStrengthNote() {
  const note = useTapNote();
  const phone = useIsPhone();
  const [pointerX, setPointerX] = useState(16);
  const aim = useCallback((pill: HTMLElement) => {
    const row = pill.closest("[data-strength-row]");
    if (!row) return;
    const r = row.getBoundingClientRect(), p = pill.getBoundingClientRect();
    setPointerX(Math.max(12, Math.min(p.left - r.left + 16, r.width - 24)));
  }, []);
  return { note, phone, pointerX, aim };
}

/** The pill: "Strength · Firm", the same text in the server HTML. */
export function StrengthPill({ s, badge, place }: { s: ReturnType<typeof useStrengthNote>; badge: StrengthBadge; place: "top" | "under" }) {
  const tone = TONE[badge.word ?? "none"];
  return (
    <span className={`strengthPill strengthPill--${place}`} data-word={badge.word ?? "none"} onClickCapture={(e) => s.aim(e.currentTarget)}>
      <NoteButton note={s.note} style={{
        borderBottom: "none", display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 999,
        fontSize: "var(--fs-label)", fontWeight: 800, lineHeight: 1.2, whiteSpace: "nowrap", boxSizing: "border-box",
        color: tone.fg, background: tone.bg, border: `1px solid ${tone.border}`,
      }}>
        <span style={{ fontWeight: 700, color: "rgba(203,213,225,0.72)" }}>Strength</span>
        {/* A REAL SEPARATOR IN THE TEXT (#563 COWORK #106): the gap alone left the
            server HTML reading "StrengthStrong" to crawlers and screen readers. */}
        <span style={{ color: "rgba(203,213,225,0.5)" }}> · </span>
        <span>{badge.word ?? "Not enough data"}</span>
      </NoteButton>
    </span>
  );
}

/** The note, placed right after the pill's row (`row`); its pointer under the pill. */
export function StrengthNote({ s, row, badge, credit, place }: { s: ReturnType<typeof useStrengthNote>; row: RefObject<HTMLDivElement | null>; badge: StrengthBadge; credit?: ReactNode; place: "top" | "under" }) {
  return (
    <div className={`strengthNoteSlot strengthNoteSlot--${place}`}>
      <FlowPanel note={s.note} anchor={row} phone={s.phone} label="Strength: how it's scored" pointerX={s.pointerX}>
        <StrengthNoteBody badge={badge} credit={credit} />
      </FlowPanel>
    </div>
  );
}

/** The CSS that shows one copy: "top" above 640 px, "under" (its own row under the ticker) at 640 px and below. */
export const STRENGTH_CSS = `
  .strengthPill { display: inline-flex; }
  .strengthUnderRow, .strengthNoteSlot--under { display: none; }
  @media (max-width: 640px) {
    .strengthPill--top, .strengthNoteSlot--top { display: none; }
    .strengthUnderRow { display: flex; margin-top: 10px; }
    .strengthNoteSlot--under { display: block; }
  }
`;
