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

function Noted({ children, note, style, label }: { children: ReactNode; note: string; style?: CSSProperties; label: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
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
      {open ? (
        <span
          id={id}
          role="tooltip"
          style={{
            position: "absolute", left: 0, top: "calc(100% + 6px)", zIndex: 20, width: "min(280px, 80vw)",
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
        <span style={{ marginLeft: 6, fontSize: "0.55em", fontWeight: 700, letterSpacing: "0.04em", opacity: 0.75, verticalAlign: "middle" }}>derived</span>
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
