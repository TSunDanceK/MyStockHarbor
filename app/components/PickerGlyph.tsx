// SIGNAL GLYPHS FOR THE PICKERS MENU (#553 COWORK #155, owner's pick: Option B).
//
// Each screen gets a 30x18 drawing of the signal itself, replacing the text
// characters (▲ ▼ ● ★ ⊖ ↗ ↘ ◆ ▮ ↕) the menu used to show. One visual language:
// grey context (CTX / CTX2) plus ONE coloured mark, and colour carries meaning
// only -- BULL green, BEAR red, ACCENT for neutral. The reference drawings are
// on branch claude/pickers-icons-mockup (claude/pickers-icons-option-b.html);
// the screens it did not cover follow the same rules:
//   above / below an average  a price line, a dashed average, the mark on the
//                             side the price sits (MA50 a wavier dash, MA200 a
//                             flatter long dash);
//   a trend flip              a line that turns, the mark at the turn (weekly:
//                             blocky week-sized steps);
//   chart plays               the pattern's outline, the mark where it resolves.
//
// Keyed by screen id, so a name and its glyph cannot drift apart: ScreenerNav's
// rows name a GlyphId, and scripts/check-picker-glyphs.mjs holds every row to a
// glyph and every glyph to the palette. aria-hidden: the row's name carries the
// meaning.
import type { ReactElement } from "react";

export const GLYPH_COLOURS = {
  CTX: "#475569",
  CTX2: "#94a3b8",
  BULL: "#22c55e",
  BEAR: "#ef4444",
  ACCENT: "#38bdf8",
  BAND: "rgba(148,163,184,.08)",
} as const;
const { CTX, CTX2, BULL, BEAR, ACCENT, BAND } = GLYPH_COLOURS;

const ROUND = { strokeLinecap: "round", strokeLinejoin: "round" } as const;

const G = {
  // ── Screener ──────────────────────────────────────────────────────────────
  "advanced-screener": (
    <>
      <rect x="3" y="2" width="24" height="14" rx="2" stroke={CTX2} strokeWidth="1.2" />
      <path d="M3 7h24M3 11.5h24M11 2v14" stroke={CTX} strokeWidth="1" />
      <rect x="12.5" y="8.2" width="13" height="2.2" rx=".6" fill={ACCENT} />
    </>
  ),
  "popular-searches": (
    <>
      <circle cx="13" cy="8" r="5" stroke={CTX2} strokeWidth="1.4" />
      <path d="M17 12l5 4" stroke={CTX2} strokeWidth="1.6" {...ROUND} />
      <circle cx="13" cy="8" r="1.8" fill={ACCENT} />
    </>
  ),
  // ── Popular screens (from the mock-up) ───────────────────────────────────
  "low-pe": (
    <>
      <path d="M2 6h26" stroke={CTX} strokeDasharray="2 2.5" {...ROUND} />
      <rect x="5" y="9" width="5" height="8" rx="1" fill={CTX} />
      <rect x="13" y="3" width="5" height="14" rx="1" fill={CTX} />
      <rect x="21" y="11" width="5" height="6" rx="1" fill={ACCENT} />
    </>
  ),
  "high-dividend-yield": (
    <>
      <rect x="3" y="12" width="5" height="5" rx="1" fill={CTX} />
      <rect x="11" y="10" width="5" height="7" rx="1" fill={CTX} />
      <rect x="19" y="3" width="5" height="14" rx="1" fill={BULL} />
      <path d="M1 8h28" stroke={CTX2} strokeWidth=".9" strokeDasharray="2 2.5" />
    </>
  ),
  "dividend-growth": (
    <>
      <rect x="2" y="13" width="5" height="4" rx="1" fill={CTX} />
      <rect x="9" y="10" width="5" height="7" rx="1" fill={CTX} />
      <rect x="16" y="7" width="5" height="10" rx="1" fill={CTX} />
      <rect x="23" y="3" width="5" height="14" rx="1" fill={BULL} />
    </>
  ),
  "cash-rich-value": (
    <>
      <ellipse cx="11" cy="14" rx="7" ry="2.2" stroke={CTX} strokeWidth="1.2" />
      <ellipse cx="11" cy="10.5" rx="7" ry="2.2" stroke={CTX} strokeWidth="1.2" />
      <ellipse cx="11" cy="7" rx="7" ry="2.2" stroke={CTX2} strokeWidth="1.2" />
      <rect x="22" y="9" width="5" height="8" rx="1" fill={ACCENT} />
    </>
  ),
  semiconductor: (
    <>
      <rect x="9" y="3" width="12" height="12" rx="2" stroke={CTX2} strokeWidth="1.4" />
      <rect x="12.5" y="6.5" width="5" height="5" rx="1" fill={ACCENT} />
      <path d="M6 6h3M6 9h3M6 12h3M21 6h3M21 9h3M21 12h3" stroke={CTX} strokeWidth="1.4" {...ROUND} />
    </>
  ),
  "cheap-tech": (
    <>
      <rect x="3" y="4" width="10" height="10" rx="1.6" stroke={CTX2} strokeWidth="1.3" />
      <path d="M1 7h2M1 11h2M13 7h2M13 11h2" stroke={CTX} strokeWidth="1.2" {...ROUND} />
      <path d="M17 6h11" stroke={CTX} strokeDasharray="2 2.5" {...ROUND} />
      <rect x="20" y="10" width="5" height="7" rx="1" fill={ACCENT} />
    </>
  ),
  // ── Signals (from the mock-up) ───────────────────────────────────────────
  "buy-signals": (
    <>
      <path d="M2 13l5-3 4 2 5-5 4 3 4-6" stroke={CTX} strokeWidth="1.5" {...ROUND} />
      <path d="M24 4l4-2" stroke={CTX} strokeWidth="1.5" {...ROUND} />
      <path d="M20 16l3-4 3 4z" fill={BULL} />
    </>
  ),
  "sell-signals": (
    <>
      <path d="M2 5l5 3 4-2 5 5 4-3 4 6 4 2" stroke={CTX} strokeWidth="1.5" {...ROUND} />
      <path d="M20 2l3 4 3-4z" fill={BEAR} />
    </>
  ),
  // ── Momentum (from the mock-up, plus the two MACD divergences) ──────────
  oversold: (
    <>
      <rect x="1" y="4" width="28" height="9" fill={BAND} />
      <path d="M1 4h28M1 13h28" stroke={CTX} strokeWidth=".8" strokeDasharray="2 2" />
      <path d="M2 7l5 2 4-1 5 4 4 4 4-3 4-2" stroke={CTX2} strokeWidth="1.4" {...ROUND} />
      <circle cx="20" cy="16" r="1.8" fill={BULL} />
    </>
  ),
  overbought: (
    <>
      <rect x="1" y="5" width="28" height="9" fill={BAND} />
      <path d="M1 5h28M1 14h28" stroke={CTX} strokeWidth=".8" strokeDasharray="2 2" />
      <path d="M2 11l5-2 4 1 5-4 4-4 4 3 4 2" stroke={CTX2} strokeWidth="1.4" {...ROUND} />
      <circle cx="20" cy="2" r="1.8" fill={BEAR} />
    </>
  ),
  "best-trend": (
    <>
      <path d="M2 15 C10 13,18 9,28 5" stroke={CTX} strokeWidth="1.4" {...ROUND} />
      <path d="M2 12l5-2 4 1 5-4 4 1 4-4 4-1" stroke={BULL} strokeWidth="1.6" {...ROUND} />
    </>
  ),
  divergence: (
    <>
      <path d="M3 8 27 3" stroke={CTX2} strokeWidth="1.5" {...ROUND} />
      <path d="M3 11 27 16" stroke={ACCENT} strokeWidth="1.5" {...ROUND} />
      <circle cx="3" cy="8" r="1.4" fill={CTX2} />
      <circle cx="3" cy="11" r="1.4" fill={ACCENT} />
    </>
  ),
  "bullish-rsi-divergence": (
    <>
      <path d="M2 3l6 4 5-2 7 5" stroke={CTX} strokeWidth="1.4" {...ROUND} />
      <path d="M8 7l12 3" stroke={CTX2} strokeWidth=".9" strokeDasharray="1.5 2" {...ROUND} />
      <path d="M2 12l6 4 5-3 7 1 6-3" stroke={BULL} strokeWidth="1.4" {...ROUND} />
      <path d="M8 16l12-2" stroke={BULL} strokeWidth=".9" strokeDasharray="1.5 2" {...ROUND} />
    </>
  ),
  "bearish-rsi-divergence": (
    <>
      <path d="M2 8l6-4 5 2 7-5" stroke={CTX} strokeWidth="1.4" {...ROUND} />
      <path d="M8 4l12-3" stroke={CTX2} strokeWidth=".9" strokeDasharray="1.5 2" {...ROUND} />
      <path d="M2 16l6-6 5 3 7 1 6 2" stroke={BEAR} strokeWidth="1.4" {...ROUND} />
      <path d="M8 10l12 4" stroke={BEAR} strokeWidth=".9" strokeDasharray="1.5 2" {...ROUND} />
    </>
  ),
  // MACD: the lower half is a histogram, its second trough shallower (bullish)
  // or its second peak lower (bearish) while price makes the opposite extreme.
  "bullish-macd-divergence": (
    <>
      <path d="M2 2l6 4 5-2 7 5" stroke={CTX} strokeWidth="1.4" {...ROUND} />
      <path d="M1 11.5h28" stroke={CTX} strokeWidth=".7" />
      <rect x="4" y="11.5" width="2.4" height="5.5" fill={CTX2} />
      <rect x="8" y="11.5" width="2.4" height="4" fill={CTX2} />
      <rect x="12" y="11.5" width="2.4" height="2" fill={CTX} />
      <rect x="16" y="11.5" width="2.4" height="3" fill={BULL} />
      <rect x="20" y="11.5" width="2.4" height="1.6" fill={BULL} />
      <rect x="24" y="9.5" width="2.4" height="2" fill={BULL} />
    </>
  ),
  "bearish-macd-divergence": (
    <>
      <path d="M2 9l6-4 5 2 7-6" stroke={CTX} strokeWidth="1.4" {...ROUND} />
      <path d="M1 12.5h28" stroke={CTX} strokeWidth=".7" />
      <rect x="4" y="7" width="2.4" height="5.5" fill={CTX2} />
      <rect x="8" y="8.5" width="2.4" height="4" fill={CTX2} />
      <rect x="12" y="10.5" width="2.4" height="2" fill={CTX} />
      <rect x="16" y="9.5" width="2.4" height="3" fill={BEAR} />
      <rect x="20" y="10.9" width="2.4" height="1.6" fill={BEAR} />
      <rect x="24" y="12.5" width="2.4" height="2" fill={BEAR} />
    </>
  ),
  // ── Highs & breakouts (from the mock-up) ─────────────────────────────────
  "ath-breakout": (
    <>
      <path d="M1 6h28" stroke={CTX2} strokeWidth=".9" strokeDasharray="2 2.5" />
      <path d="M2 15l5-5 4 3 5-6 4 2 4-6 4-1" stroke={CTX} strokeWidth="1.4" {...ROUND} />
      <circle cx="24" cy="3" r="1.8" fill={BULL} />
    </>
  ),
  "three-month-high": (
    <>
      <path d="M2 15l3-6 3 5 4-7 3 6 5-9 4 6 4-6" stroke={CTX} strokeWidth="1.4" {...ROUND} />
      <circle cx="28" cy="3" r="1.8" fill={BULL} />
    </>
  ),
  "down-20-from-ath": (
    <>
      <path d="M1 3h28" stroke={CTX2} strokeWidth=".9" strokeDasharray="2 2.5" />
      <path d="M2 12l6-9 5 5 5 3 5 4" stroke={CTX} strokeWidth="1.4" {...ROUND} />
      <path d="M26 4v11" stroke={BEAR} strokeWidth="1.4" {...ROUND} />
      <path d="M24 13l2 2.5 2-2.5" stroke={BEAR} strokeWidth="1.4" {...ROUND} />
    </>
  ),
  // ── Volume & volatility (from the mock-up) ───────────────────────────────
  breakout: (
    <>
      <path d="M1 8h28" stroke={CTX2} strokeWidth=".9" strokeDasharray="2 2.5" />
      <path d="M2 13l4-3 4 2 4-3 4 2 4-8 5-1" stroke={CTX} strokeWidth="1.4" {...ROUND} />
      <circle cx="22" cy="3" r="1.8" fill={ACCENT} />
    </>
  ),
  "volume-spike": (
    <>
      <rect x="2" y="12" width="3.5" height="5" rx=".8" fill={CTX} />
      <rect x="7" y="10" width="3.5" height="7" rx=".8" fill={CTX} />
      <rect x="12" y="13" width="3.5" height="4" rx=".8" fill={CTX} />
      <rect x="17" y="11" width="3.5" height="6" rx=".8" fill={CTX} />
      <rect x="23" y="1" width="4" height="16" rx=".8" fill={ACCENT} />
      <path d="M1 10.5h21" stroke={CTX2} strokeWidth=".8" strokeDasharray="2 2" />
    </>
  ),
  "atr-spike": (
    <>
      <path d="M4 7v4M10 6v6M16 4v10M23 1v16" stroke={CTX2} strokeWidth="1" {...ROUND} />
      <rect x="3" y="8" width="2" height="2" fill={CTX} />
      <rect x="9" y="7.5" width="2" height="3" fill={CTX} />
      <rect x="15" y="6" width="2" height="6" fill={CTX} />
      <rect x="21.5" y="3" width="3" height="12" fill={ACCENT} />
    </>
  ),
  // ── Moving averages ──────────────────────────────────────────────────────
  "near-200-day": (
    <>
      <path d="M1 9h28" stroke={CTX2} strokeWidth="1" strokeDasharray="4 2.5" />
      <path d="M2 3l5 2 5 1 5 2 4 2 4-1 3 0" stroke={CTX} strokeWidth="1.4" {...ROUND} />
      <circle cx="24" cy="9" r="1.9" fill={ACCENT} />
    </>
  ),
  "near-weekly-200": (
    <>
      <path d="M1 9h28" stroke={CTX2} strokeWidth="1" strokeDasharray="4 2.5" />
      <path d="M2 3h4v2h5v2h5v2h5v1h4" stroke={CTX} strokeWidth="1.4" {...ROUND} />
      <circle cx="26" cy="9" r="1.9" fill={ACCENT} />
    </>
  ),
  "above-ma50": (
    <>
      <path d="M1 12 C6 10,10 14,15 11 S24 10,29 9" stroke={CTX2} strokeWidth="1" strokeDasharray="2 2" />
      <path d="M2 10l4-2 4 1 5-4 4 1 5-3 4-1" stroke={CTX} strokeWidth="1.4" {...ROUND} />
      <circle cx="25" cy="3" r="1.8" fill={BULL} />
    </>
  ),
  "below-ma50": (
    <>
      <path d="M1 6 C6 8,10 4,15 7 S24 8,29 9" stroke={CTX2} strokeWidth="1" strokeDasharray="2 2" />
      <path d="M2 8l4 2 4-1 5 4 4-1 5 3 4 1" stroke={CTX} strokeWidth="1.4" {...ROUND} />
      <circle cx="25" cy="15" r="1.8" fill={BEAR} />
    </>
  ),
  "above-ma200": (
    <>
      <path d="M1 12 C10 11,20 10,29 9" stroke={CTX2} strokeWidth="1" strokeDasharray="4 2.5" />
      <path d="M2 9l4-3 4 2 5-4 4 1 5-3 4 0" stroke={CTX} strokeWidth="1.4" {...ROUND} />
      <circle cx="25" cy="2.5" r="1.8" fill={BULL} />
    </>
  ),
  "below-ma200": (
    <>
      <path d="M1 6 C10 7,20 8,29 9" stroke={CTX2} strokeWidth="1" strokeDasharray="4 2.5" />
      <path d="M2 9l4 3 4-2 5 4 4-1 5 3 4 0" stroke={CTX} strokeWidth="1.4" {...ROUND} />
      <circle cx="25" cy="15.5" r="1.8" fill={BEAR} />
    </>
  ),
  // ── Trend flips: the line turns; the mark sits at the turn ──────────────
  "bullish-flip": (
    <>
      <path d="M2 4l5 3 5 3 4 4" stroke={CTX} strokeWidth="1.4" {...ROUND} />
      <path d="M16 14l4-3 4-4 4-4" stroke={CTX2} strokeWidth="1.4" {...ROUND} />
      <circle cx="16" cy="14" r="2" fill={BULL} />
    </>
  ),
  "bearish-flip": (
    <>
      <path d="M2 14l5-3 5-3 4-4" stroke={CTX} strokeWidth="1.4" {...ROUND} />
      <path d="M16 4l4 3 4 4 4 4" stroke={CTX2} strokeWidth="1.4" {...ROUND} />
      <circle cx="16" cy="4" r="2" fill={BEAR} />
    </>
  ),
  "bullish-flip-weekly": (
    <>
      <path d="M2 4h4v3h4v3h4v4h2" stroke={CTX} strokeWidth="1.4" {...ROUND} />
      <path d="M16 14h2v-3h4v-4h4v-4h2" stroke={CTX2} strokeWidth="1.4" {...ROUND} />
      <circle cx="16" cy="14" r="2" fill={BULL} />
    </>
  ),
  "bearish-flip-weekly": (
    <>
      <path d="M2 14h4v-3h4v-3h4v-4h2" stroke={CTX} strokeWidth="1.4" {...ROUND} />
      <path d="M16 4h2v3h4v4h4v4h2" stroke={CTX2} strokeWidth="1.4" {...ROUND} />
      <circle cx="16" cy="4" r="2" fill={BEAR} />
    </>
  ),
  // ── Earnings ─────────────────────────────────────────────────────────────
  "last-earnings": (
    <>
      <rect x="3" y="9" width="5" height="8" rx="1" fill={CTX} />
      <rect x="11" y="7" width="5" height="10" rx="1" fill={CTX} />
      <path d="M18 5h10" stroke={CTX2} strokeWidth=".9" strokeDasharray="2 2" />
      <rect x="20" y="3" width="5" height="14" rx="1" fill={BULL} />
    </>
  ),
  "earnings-growth": (
    <>
      <path d="M2 16h26" stroke={CTX} strokeWidth=".8" />
      <rect x="3" y="12" width="4" height="4" rx=".8" fill={CTX} />
      <rect x="9" y="10" width="4" height="6" rx=".8" fill={CTX} />
      <rect x="15" y="7" width="4" height="9" rx=".8" fill={CTX2} />
      <rect x="21" y="3" width="4" height="13" rx=".8" fill={BULL} />
    </>
  ),
  // ── Chart plays ──────────────────────────────────────────────────────────
  "macro-sr": (
    <>
      <path d="M1 4h28M1 14h28" stroke={CTX2} strokeWidth=".9" strokeDasharray="2 2.5" />
      <path d="M2 12l4-7 4 8 4-8 4 8 4-7 4 3" stroke={CTX} strokeWidth="1.3" {...ROUND} />
      <circle cx="18" cy="13" r="1.8" fill={ACCENT} />
    </>
  ),
  "ascending-triangle": (
    <>
      <path d="M2 4h22" stroke={CTX2} strokeWidth="1" strokeDasharray="2 2" />
      <path d="M2 16 24 5" stroke={CTX2} strokeWidth="1" strokeDasharray="2 2" />
      <path d="M2 15l4-11 4 9 4-9 4 6 4-6 4-2" stroke={CTX} strokeWidth="1.3" {...ROUND} />
      <circle cx="27" cy="2" r="1.8" fill={BULL} />
    </>
  ),
  "bull-flag": (
    <>
      <path d="M3 16 11 3" stroke={CTX} strokeWidth="1.6" {...ROUND} />
      <path d="M11 3l9 3M11 8l9 3" stroke={CTX2} strokeWidth="1" strokeDasharray="2 1.8" {...ROUND} />
      <path d="M20 8l7-6" stroke={BULL} strokeWidth="1.6" {...ROUND} />
    </>
  ),
  "descending-triangle": (
    <>
      <path d="M2 14h22" stroke={CTX2} strokeWidth="1" strokeDasharray="2 2" />
      <path d="M2 2 24 13" stroke={CTX2} strokeWidth="1" strokeDasharray="2 2" />
      <path d="M2 3l4 11 4-9 4 9 4-6 4 6 4 2" stroke={CTX} strokeWidth="1.3" {...ROUND} />
      <circle cx="27" cy="16" r="1.8" fill={BEAR} />
    </>
  ),
} satisfies Record<string, ReactElement>;

export type GlyphId = keyof typeof G;
export const GLYPH_IDS = Object.keys(G) as GlyphId[];

export default function PickerGlyph({ id, dim = false }: { id: GlyphId; dim?: boolean }) {
  const body: ReactElement | undefined = G[id];
  if (!body) return null;
  return (
    <svg
      className="pickerGlyph"
      width="30"
      height="18"
      viewBox="0 0 30 18"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={dim ? { opacity: 0.45 } : undefined}
    >
      {body}
    </svg>
  );
}

/** The small "opens page" arrow (replaces the OPENS PAGE text). */
export function OpensPageArrow() {
  return (
    <svg className="pickerOpensPage" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}
