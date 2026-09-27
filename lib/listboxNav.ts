// Keyboard navigation for every ticker search box (Relay B, #553 COWORK #36).
//
// ONE implementation so the boxes cannot drift apart. The pure part (`navKey`)
// decides what a key does; the React hook (`useListboxNav`, in
// app/components/useListboxNav.ts) holds the highlighted row and wires the ARIA.
//
// THE RULES (owner, COWORK #36):
//   Down / Up   move the highlight; Up from the first row returns to the text
//               typed (no row highlighted). Down on the last row stays there.
//   Enter       picks the highlighted row, exactly as a click on it would.
//               With nothing highlighted it is NOT handled here, so each box's
//               existing Enter behaviour (top match, exact ticker) still runs.
//   Escape      closes the list and keeps the text.
//   Tab         closes the list and picks nothing (focus moves on as normal).
//   Typing      resets the highlight (the caller passes the query as resetKey).

export type NavAction =
  | { kind: "move"; index: number }
  | { kind: "select"; index: number }
  | { kind: "close"; preventDefault: boolean }
  | { kind: "none" };

/** -1 means "no row highlighted: the text you typed". */
export function navKey(key: string, active: number, count: number, open: boolean): NavAction {
  const has = open && count > 0;
  const cur = active >= 0 && active < count ? active : -1;
  switch (key) {
    case "ArrowDown":
    case "Down":
      return has ? { kind: "move", index: Math.min(cur + 1, count - 1) } : { kind: "none" };
    case "ArrowUp":
    case "Up":
      return has ? { kind: "move", index: cur <= 0 ? -1 : cur - 1 } : { kind: "none" };
    case "Enter":
      return has && cur >= 0 ? { kind: "select", index: cur } : { kind: "none" };
    case "Escape":
    case "Esc":
      return open ? { kind: "close", preventDefault: true } : { kind: "none" };
    case "Tab":
      return open ? { kind: "close", preventDefault: false } : { kind: "none" };
    default:
      return { kind: "none" };
  }
}

/** A DOM id safe for aria-activedescendant. */
export function optionId(listId: string, index: number): string {
  return `${listId}-opt-${index}`;
}

/**
 * The highlighted row's look: a solid tint plus an inset ring, so it reads in
 * both light and dark themes (not a faint hover tint).
 */
export function activeRowStyle(isDark = true): { background: string; boxShadow: string; outline: string } {
  return isDark
    ? { background: "rgba(47,107,255,0.30)", boxShadow: "inset 0 0 0 2px rgba(147,183,255,0.85)", outline: "none" }
    : { background: "rgba(37,99,235,0.14)", boxShadow: "inset 0 0 0 2px rgba(37,99,235,0.75)", outline: "none" };
}
