"use client";
// TAP NOTES THAT OPEN BESIDE THE TAP (#563 COWORK #88 §3 / #89), for C's Price
// zones and Key levels cards.
//
//   desktop   anchored directly below the label tapped, as wide as the card
//             (never wider), with a small pointer to the label; flipped above
//             when it would run off the bottom of the viewport
//   phone     inline under the label (≤ 900 px, where the page stacks), pushing
//             what follows down instead of floating over it
//   closing   ✕, Esc, or a tap outside; one note open at a time on the page
//
// The cards place the panel themselves (a Key levels row in its own flow, the
// Price zones ladder by moving what sits below the label); this module holds
// the shared state, the placement arithmetic and the panel's frame. Pure
// helpers (anchoredPlacement, pushOffsets) are exported for the checks.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/** At or below this width the page stacks (StockSymbolPageClient's ≤ 900 px block), and notes open inline. */
export const PHONE_MAX = 900;
/** Room between the label and the note, in px. */
export const NOTE_GAP = 8;

// ── one open at a time ──────────────────────────────────────────────────────
const listeners = new Set<(id: string | null) => void>();
let current: string | null = null;
function announce(id: string | null) {
  current = id;
  listeners.forEach((l) => l(id));
}

/**
 * The note's open state, shared so opening one closes any other. Esc closes it,
 * and so does a tap outside every element carrying `owner` (the label and the
 * panel, which may be siblings rather than nested).
 */
export function useTapNote() {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [open, setOpen] = useState(false);
  const owner = { "data-note": id };
  useEffect(() => {
    const l = (o: string | null) => setOpen(o === id);
    listeners.add(l);
    return () => { listeners.delete(l); if (current === id) current = null; };
  }, [id]);
  const close = useCallback(() => { if (current === id) announce(null); }, [id]);
  const toggle = useCallback(() => announce(current === id ? null : id), [id]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    // ON CLICK, NOT POINTERDOWN: on a phone the open note is inline, so closing it
    // on pointerdown shifts the page before the click lands, and a tap on another
    // note's label would miss it. On click, that label's own handler runs first
    // (it opens its note, which closes this one) and this finds nothing to close.
    const outside = (e: MouseEvent) => { if (!(e.target instanceof Element) || !e.target.closest(`[data-note="${id}"]`)) close(); };
    document.addEventListener("keydown", key);
    document.addEventListener("click", outside);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("click", outside); };
  }, [open, close, id]);
  return { id, open, toggle, close, owner };
}

/** True at phone width (≤ PHONE_MAX); false on the server and until the first effect. */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(`(max-width: ${PHONE_MAX}px)`);
    const on = () => setPhone(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return phone;
}

// ── placement ───────────────────────────────────────────────────────────────

/**
 * Where a desktop note sits, in px from the top of its positioned container:
 * below the label (labelBottom + NOTE_GAP), or above it (labelTop − NOTE_GAP −
 * height) when below would run past the viewport's bottom and above fits.
 * `containerTop` is the container's top in viewport px.
 */
export function anchoredPlacement(a: { labelTop: number; labelBottom: number; height: number; containerTop: number; viewportHeight: number }): { top: number; flipped: boolean } {
  const below = a.labelBottom + NOTE_GAP;
  const above = a.labelTop - NOTE_GAP - a.height;
  const offBottom = a.containerTop + below + a.height > a.viewportHeight;
  const fitsAbove = a.containerTop + above >= 0;
  return offBottom && fitsAbove ? { top: above, flipped: true } : { top: below, flipped: false };
}

/**
 * Phone: everything below the open label moves down by the note's height (and
 * its gap), so the note sits inline under the label. `ys` are the marks' tops,
 * `from` the open label's bottom; returns each mark's added offset.
 */
export function pushOffsets(ys: readonly number[], from: number, noteHeight: number): number[] {
  return ys.map((y) => (y >= from ? noteHeight + NOTE_GAP * 2 : 0));
}

// ── the trigger and the panel ───────────────────────────────────────────────

/** The tappable label: a button, dotted underline like the site's other notes. */
export function NoteButton({ note, children, style, className }: { note: ReturnType<typeof useTapNote>; children: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <button type="button" {...note.owner} className={`tapNoteBtn${className ? ` ${className}` : ""}`} aria-expanded={note.open} aria-controls={`${note.id}-panel`}
      onClick={note.toggle} style={{ all: "unset", cursor: "pointer", borderBottom: "1px dotted currentColor", ...style }}>
      {children}
    </button>
  );
}

/**
 * The note's frame. `overlay` positions it absolutely in its container at
 * `top` (desktop); without it, it is a block in the flow (phone, or a card that
 * pushes). `pointerX` is the pointer's left in px; it points up, or down when
 * flipped. `onHeight` reports the rendered height (for placement and pushing).
 */
export function NotePanel({ note, overlay, mode, pointerX = 16, onHeight, children, label }: {
  note: ReturnType<typeof useTapNote>;
  overlay?: { top: number; flipped: boolean } | null;
  /** What it is for the checks and the measure: anchored over the page, or inline (pushing). Defaults from `overlay`. */
  mode?: "overlay" | "inline";
  pointerX?: number;
  onHeight?: (h: number) => void;
  children: ReactNode;
  label: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!ref.current || !onHeight) return;
    const el = ref.current;
    onHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => onHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeight]);
  const flipped = !!overlay?.flipped;
  return (
    <div ref={ref} {...note.owner} id={`${note.id}-panel`} role="dialog" aria-label={label} className="tapNotePanel" data-mode={mode ?? (overlay ? "overlay" : "inline")} data-flipped={flipped ? "1" : undefined}
      style={{
        ...(overlay ? { position: "absolute", left: 0, right: 0, top: overlay.top, zIndex: 20 } : { position: "relative", marginTop: NOTE_GAP, marginBottom: NOTE_GAP }),
        boxSizing: "border-box", maxWidth: "100%", padding: "10px 30px 10px 12px", borderRadius: 12,
        background: "#0f172a", border: "1px solid rgba(148,163,184,0.35)", boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
        fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", color: "rgba(226,232,240,0.92)", textAlign: "left", whiteSpace: "normal",
      }}>
      <span aria-hidden="true" className="tapNotePointer" style={{
        position: "absolute", left: pointerX, width: 10, height: 10, background: "#0f172a", transform: "rotate(45deg)",
        ...(flipped ? { bottom: -6, borderRight: "1px solid rgba(148,163,184,0.35)", borderBottom: "1px solid rgba(148,163,184,0.35)" }
          : { top: -6, borderLeft: "1px solid rgba(148,163,184,0.35)", borderTop: "1px solid rgba(148,163,184,0.35)" }),
      }} />
      <button type="button" className="tapNoteClose" aria-label="Close" onClick={note.close}
        style={{ all: "unset", cursor: "pointer", position: "absolute", top: 6, right: 9, fontSize: "0.8125rem", lineHeight: 1, color: "rgba(203,213,225,0.75)", padding: 2 }}>✕</button>
      {children}
    </div>
  );
}

/** A small CSS dot in a note's bullet, or the "How to read this" legend. */
export function NoteDot({ colour, shape = "dot" }: { colour: string; shape?: "dot" | "diamond" | "tick" | "up" | "down" }) {
  const base: CSSProperties = { display: "inline-block", flex: "0 0 auto", marginRight: 7, verticalAlign: "middle", boxSizing: "border-box" };
  if (shape === "diamond") return <span aria-hidden="true" className="noteDot" style={{ ...base, width: 7, height: 7, transform: "rotate(45deg)", border: `1.5px solid ${colour}` }} />;
  if (shape === "tick") return <span aria-hidden="true" className="noteDot" style={{ ...base, width: 2, height: 11, background: colour, borderRadius: 1, marginLeft: 3, marginRight: 10 }} />;
  if (shape === "up" || shape === "down")
    return <span aria-hidden="true" className="noteDot" style={{ ...base, width: 0, height: 0, borderLeft: "4.5px solid transparent", borderRight: "4.5px solid transparent", ...(shape === "up" ? { borderBottom: `7px solid ${colour}` } : { borderTop: `7px solid ${colour}` }) }} />;
  return <span aria-hidden="true" className="noteDot" style={{ ...base, width: 8, height: 8, borderRadius: 999, background: colour }} />;
}

/** "How to read this ▾": a native <details>, closed by default (#88 §1). */
export function HowToRead({ children }: { children: ReactNode }) {
  return (
    <details className="howToRead" style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontSize: "var(--fs-read)", fontWeight: 700, color: "rgba(147,197,253,0.85)", listStyle: "none" }}>How to read this ▾</summary>
      <div style={{ marginTop: 6, fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", color: "rgba(203,213,225,0.72)" }}>{children}</div>
    </details>
  );
}

/**
 * A note whose label sits in the page's flow (a Key levels row, "What are
 * these?"). Placed right after the label's row: inline on a phone; on desktop
 * anchored just below that row, flipped above it when below would leave the
 * viewport. `anchor` is the label's row.
 */
export function FlowPanel({ note, anchor, phone, label, pointerX, children }: {
  note: ReturnType<typeof useTapNote>;
  anchor: { current: HTMLElement | null };
  phone: boolean;
  label: string;
  pointerX?: number;
  children: ReactNode;
}) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState(0);
  const [place, setPlace] = useState<{ top: number; flipped: boolean }>({ top: NOTE_GAP, flipped: false });
  useLayoutEffect(() => {
    if (phone || !wrap.current) return;
    const ah = anchor.current?.offsetHeight ?? 0;
    setPlace(anchoredPlacement({ labelTop: -ah, labelBottom: 0, height: h, containerTop: wrap.current.getBoundingClientRect().top, viewportHeight: window.innerHeight }));
  }, [phone, h, anchor]);
  if (!note.open) return null;
  if (phone) return <NotePanel note={note} label={label} pointerX={pointerX} mode="inline">{children}</NotePanel>;
  return (
    <div ref={wrap} className="tapNoteAnchor" style={{ position: "relative", height: 0 }}>
      <NotePanel note={note} label={label} pointerX={pointerX} overlay={place} onHeight={setH}>{children}</NotePanel>
    </div>
  );
}
