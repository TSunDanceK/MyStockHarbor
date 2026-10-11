// "POWERED BY TIINGO", ONE COMPONENT FOR THE WHOLE SITE (#553 COWORK #200 item 2).
//
// The owner's choice over the "Market data from Tiingo.com" lines: a small,
// muted credit at the bottom right of the card whose figures are Tiingo's.
// It STAYS A LINK to Tiingo's site, as the contract's credit always has been
// (lib/server/tiingoSurfacePrice.ts, TIINGO_URL). Styled text, not Tiingo's
// logo: claude/tiingo-contract-and-limits-2026-09-23.md, the note that would
// say whether logo use is allowed, is not on main (checked 2026-10-11), so
// nothing here grants it and text is the safe reading.
//
// Two shapes:
//   <TiingoCredit />   its own fine-print line, right-aligned: the card's corner
//   <TiingoLink />     the bare link, for a component that already places its
//                      credit (the sector map's corner, a card's `credit` prop)
//
// No imports and no "use client": the server pages and the client cards both
// render it, and the text and address live here once. scripts/check-tiingo-
// credit.mjs pins TIINGO_HOME to TIINGO_URL, so the two cannot drift.
import type { CSSProperties } from "react";

export const TIINGO_POWERED_BY = "powered by Tiingo";
export const TIINGO_HOME = "https://www.tiingo.com/";

export function TiingoLink({ style }: { style?: CSSProperties }) {
  return (
    <a
      href={TIINGO_HOME}
      target="_blank"
      rel="noopener noreferrer"
      className="tiingoCredit"
      style={{ color: "inherit", textDecorationColor: "rgba(148,163,184,0.45)", textUnderlineOffset: 2, ...style }}
    >
      {TIINGO_POWERED_BY}
    </a>
  );
}

export default function TiingoCredit({ style }: { style?: CSSProperties }) {
  return (
    <p
      className="tiingoCreditRow"
      data-fine-print
      style={{ margin: "8px 0 0", textAlign: "right", fontSize: "var(--fs-fine)", lineHeight: 1.5, color: "rgba(148,163,184,0.72)", ...style }}
    >
      <TiingoLink />
    </p>
  );
}
