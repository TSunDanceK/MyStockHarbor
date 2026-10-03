"use client";
// THE SHARED ESTIMATE MARK (#552 COWORK #94/#112). Every surface that shows a
// figure from lib/server/secEstimates renders it through this, and nobody
// copies it: one marker, one colour, one note, one key.
//
//   estimate → "≈" + the value in ESTIMATE_COLOUR. Not colour alone: the "≈"
//              carries the meaning for a reader who can't see the colour.
//   derived  → the value as filed figures give it, plus the word "derived"
//              (arithmetic on filed lines, not a guess, COWORK #112).
//
// The note (method + balance-sheet date) shows on hover (title) and on tap or
// keyboard (Enter/Space toggles, Escape closes) in a small popover. A value
// with no `est` renders as plain text: a filed figure never wears the mark.
//
// ReasonedValue is the same popover for a word in place of a dash ("Loss",
// "Not meaningful"), whose reason is on hover/tap rather than printed under
// the tile (#552 COWORK #98 §1).
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { ESTIMATE_COLOUR, ESTIMATE_SIGN, type EstimateMark } from "./estimateMark";

export { ESTIMATE_COLOUR, ESTIMATE_SIGN, type EstimateMark };

/** The popover's widest, and the gutter it keeps from each viewport edge. */
export const NOTE_MAX_WIDTH = 280;
export const NOTE_GUTTER = 16;
/** Less room than this below the trigger, and more above, and the note opens upward. */
export const NOTE_FLIP_SPACE = 120;

export type NotePlace = { left: number; width: number } & ({ top: number } | { bottom: number });

/**
 * WHERE THE NOTE GOES (#552 COWORK #113): under the trigger, but never past a
 * viewport edge. A note anchored at the trigger's left pushed a 360 px page
 * sideways from a right-hand cell; fixed positioning also escapes a parent's
 * overflow clipping (the hero stat row). Pure, so the check can drive it.
 *
 * AND ABOVE IT NEAR THE FOOT OF THE SCREEN (#552 COWORK #115): a tile in the
 * bottom ~90 px of a phone had its note cut off. Anchored by `bottom` when it
 * flips, so the note's own height (unknown before it renders) never matters.
 */
export function notePlacement(trigger: { left: number; top?: number; bottom: number }, viewportWidth: number, viewportHeight?: number): NotePlace {
  const width = Math.max(0, Math.min(NOTE_MAX_WIDTH, viewportWidth - 2 * NOTE_GUTTER));
  const left = Math.max(NOTE_GUTTER, Math.min(trigger.left, viewportWidth - NOTE_GUTTER - width));
  if (viewportHeight !== undefined && trigger.top !== undefined) {
    const below = viewportHeight - trigger.bottom;
    if (below < NOTE_FLIP_SPACE && trigger.top > below) return { left, width, bottom: viewportHeight - trigger.top + 6 };
  }
  return { left, top: trigger.bottom + 6, width };
}

function Noted({ children, note, style, label }: { children: ReactNode; note: string; style?: CSSProperties; label: string }) {
  // OPEN IS WHERE IT IS: null is closed. Measured when it opens, in the event.
  const [place, setPlace] = useState<NotePlace | null>(null);
  const open = place !== null;
  const setOpen = (next: boolean | ((was: boolean) => boolean)) => {
    const want = typeof next === "function" ? next(open) : next;
    if (!want || !ref.current) { setPlace(null); return; }
    const r = ref.current.getBoundingClientRect();
    setPlace(notePlacement({ left: r.left, top: r.top, bottom: r.bottom }, document.documentElement.clientWidth, document.documentElement.clientHeight));
  };
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) setPlace(null); };
    // Fixed to the viewport, so a scroll or resize would leave it behind: close
    // instead. CAPTURE PHASE, so an inner container's scroll (which does not
    // bubble to window) closes it too (#552 COWORK #115).
    const close = () => setPlace(null);
    document.addEventListener("pointerdown", away);
    window.addEventListener("scroll", close, { passive: true, capture: true });
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [open]);
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <span
        role="button"
        tabIndex={0}
        title={note}
        aria-label={`${label}. ${note}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        data-estimate-note={note}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); }
          else if (e.key === "Escape") setOpen(false);
        }}
        style={{ cursor: "help", borderBottom: "1px dotted currentColor", ...style }}
      >
        {children}
      </span>
      {open && place ? (
        <span
          id={id}
          role="tooltip"
          style={{
            position: "fixed", left: place.left, ...("top" in place ? { top: place.top } : { bottom: place.bottom }), zIndex: 50, width: place.width,
            padding: "8px 10px", borderRadius: 8, background: "#0f172a", border: "1px solid rgba(255,255,255,0.14)",
            color: "#e2e8f0", fontSize: 12, fontWeight: 500, lineHeight: 1.45, letterSpacing: 0, whiteSpace: "normal",
          }}
        >
          {note}
        </span>
      ) : null}
    </span>
  );
}

/** A figure, marked when (and only when) it carries an estimate. */
export function EstimatedValue({ text, est, style }: { text: string; est?: EstimateMark | null; style?: CSSProperties }) {
  if (!est) return <span style={style}>{text}</span>;
  if (est.kind === "derived") {
    return (
      <Noted note={est.note} label={`${text}, derived`} style={style}>
        {text}
        <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 700, letterSpacing: "0.02em", opacity: 0.85, verticalAlign: "middle" }}>derived</span>
      </Noted>
    );
  }
  return (
    <Noted note={est.note} label={`${text}, estimated`} style={{ color: ESTIMATE_COLOUR, ...style }}>
      {ESTIMATE_SIGN}
      {text}
    </Noted>
  );
}

/** A word in place of a dash, its reason on hover/tap. */
export function ReasonedValue({ text, reason, style }: { text: string; reason?: string | null; style?: CSSProperties }) {
  if (!reason) return <span style={style}>{text}</span>;
  return <Noted note={reason} label={text} style={style}>{text}</Noted>;
}
