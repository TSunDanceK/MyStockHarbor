"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type WatermarkContextValue = {
  hidden: boolean;
  toggle: () => void;
};

const WatermarkContext = createContext<WatermarkContextValue | null>(null);

// Per-page, per-load only: hiding watermarks lives in plain component state,
// never localStorage/cookies, so it resets back to visible on refresh or
// navigation. This lets someone grab a watermark-free screenshot for a
// social post without permanently switching the site's default off for
// everyone else. Deliberately low-key (see HideWatermarksButton) since this
// is an escape hatch, not a feature most visitors need to notice.
export function WatermarkVisibilityProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);

  return (
    <WatermarkContext.Provider value={{ hidden, toggle: () => setHidden((v) => !v) }}>
      {children}
    </WatermarkContext.Provider>
  );
}

// Components rendered outside a WatermarkVisibilityProvider (shouldn't
// normally happen, but keeps standalone usage safe) just always show the
// watermark.
export function useWatermarkHidden() {
  const ctx = useContext(WatermarkContext);
  return ctx?.hidden ?? false;
}

// Small, muted, easy-to-miss toggle placed at the very bottom of a page.
// Renders nothing if there's no provider above it in the tree.
export function HideWatermarksButton() {
  const ctx = useContext(WatermarkContext);
  if (!ctx) return null;

  return (
    <button
      type="button"
      onClick={ctx.toggle}
      aria-pressed={ctx.hidden}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "5px 9px",
        fontSize: 10.5,
        fontWeight: 650,
        letterSpacing: "0.02em",
        color: "rgba(148,163,184,0.38)",
        background: "transparent",
        border: "1px solid rgba(148,163,184,0.12)",
        borderRadius: 7,
        cursor: "pointer",
      }}
    >
      {ctx.hidden ? "Show watermarks" : "Hide watermarks"}
    </button>
  );
}

// Shared wrapper so the "very bottom of the page" placement stays
// consistent (centered, quiet, out of the way of real content) everywhere
// this is used.
export function HideWatermarksBar() {
  return (
    <div style={{ display: "flex", justifyContent: "center", marginTop: 28, opacity: 0.7 }}>
      <HideWatermarksButton />
    </div>
  );
}

// Used on the earnings page's score card, in place of a plain
// "MyStockHarbor.com" div, so it can be hidden via the toggle above.
export function EarningsScoreWatermark() {
  const hidden = useWatermarkHidden();
  if (hidden) return null;

  return <div className="scoreWatermark">MyStockHarbor.com</div>;
}

// Used on the stock news page's score panel, in place of the plain
// absolutely-positioned brand label, so it can be hidden via the toggle
// above.
//
// POSITIONING: the panel (scorePanelStyle in NewsScoreGauge.tsx) has 18px of
// padding and opens with the kicker -- "NEWS SCORE" on the stock page,
// "SECTOR NEWS SCORE" on the sector pages. At top: 14 this label sat on the
// same line as that kicker and, once the kicker got longer, ran straight
// through it: on a phone "SECTOR NEWS SCORE" and "MyStockHarbor.com"
// overlapped mid-word.
//
// top: 40 drops it onto the line below. The kicker is 11px at ~1.2 line
// height starting at y=18, so it ends around y=31; the gauge SVG below it
// starts at y=45 but its arc doesn't reach the top of its own viewBox
// (apex is 15 user units down, and the arc is centred), so the strip this
// now occupies is empty on both sides. Anything that changes the kicker's
// size or the panel's padding should re-check this number.
export function NewsScoreWatermark() {
  const hidden = useWatermarkHidden();
  if (hidden) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 40,
        right: 16,
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      <span
        style={{
          fontSize: 16,
          fontWeight: 800,
          letterSpacing: "0.03em",
          color: "rgba(226,232,240,0.30)",
        }}
      >
        MyStockHarbor.com
      </span>
    </div>
  );
}
