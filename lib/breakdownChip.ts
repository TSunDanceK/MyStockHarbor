// The /dashboard Breakdown chips' value text (Relay B, #553 COWORK #39).
//
// THE OVERFLOW. SPCX's Earnings chip read "Partial · 1 of 5 measured" (the
// partial-score label from lib/server/secPresentation.ts, shared with the
// earnings page). The chip grid was `1fr 1fr` with unwrapped values, and a
// `1fr` column never shrinks below its content, so the long value widened the
// left column and pushed the right-hand chips past the card's edge, hiding
// MACD's and RSI's values. Every new listing with a partial score did the same.
//
// THE FIX, in two parts:
//   1. The grid is `repeat(2, minmax(0, 1fr))` and every chip part may shrink:
//      a value that still does not fit is cut with an ellipsis, never widens.
//   2. The partial label is SHORTENED FOR THE CHIP ONLY ("Partial 1/5"); the
//      full wording stays in the chip's tooltip. The shared label, and so the
//      earnings page, is unchanged.

/** One chip value: the text shown and, when shortened, the full text for the tooltip. */
export type ChipValue = { text: string; full: string };

const PARTIAL = /^Partial\s*[·:]\s*(\d+)\s+of\s+(\d+)\s+(?:inputs\s+)?measured\b/i;

export function breakdownChipValue(raw: unknown): ChipValue {
  const full = raw === null || raw === undefined || raw === "" ? "—" : String(raw);
  const m = PARTIAL.exec(full);
  return { text: m ? `Partial ${m[1]}/${m[2]}` : full, full };
}
