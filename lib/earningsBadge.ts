// THE EARNINGS INPUT TO THE STRENGTH BADGE (#552 COWORK #154, #563 COWORK #102).
//
// One pure function from what the stock page already holds — the SEC
// earnings snapshot it passes to the sidebar card — to Good / Mixed / Weak,
// or none with the reason. No reads of its own: the snapshot is built once per
// render (lib/server/secEarningsSnapshot.ts) and this only looks at it.
//
// THE WORD IS THE CARD'S OWN. Good / Mixed / Weak are the score's bands
// (SCORE_BANDS in lib/server/secEarningsScore.ts), read from `snapshot.tone`,
// so the badge and the earnings card beside it cannot disagree.
//
// NONE, AND WHY, in three cases:
//   - "not-read": nothing scored — no stored set yet, a fund or a census-named
//     note (never read), or a filer with no prior-year period to measure from;
//   - "partial": the score ran on some inputs only. The card shows no verdict
//     then ("Partial · 3 of 5 measured") because the band can be decided by
//     what is missing, so the badge counts none either.
// The points are the badge's rule (lib/strengthBadge.ts), not this file's.
//
// Type-only imports: safe to call on the server or in a client component.
import type { SecEarningsSnapshot } from "@/lib/server/secEarningsSnapshot";

export type EarningsBadgeWord = "Good" | "Mixed" | "Weak";

export type EarningsBadgeInput =
  | {
      word: EarningsBadgeWord;
      /** 0-100, the card's own number. */
      score: number;
      /** "Q3 FY2026" — the period the score reads. */
      period: string | null;
      /** For the tap note: "Earnings: Good (76/100, Q3 FY2026)". */
      note: string;
    }
  | {
      word: null;
      why: "not-read" | "partial";
      /** For the tap note: "no earnings read", or the partial count. */
      note: string;
    };

const WORD: Record<SecEarningsSnapshot["tone"], EarningsBadgeWord> = { good: "Good", neutral: "Mixed", weak: "Weak" };

/** The snapshot's fields this reads, so a caller can pass a slimmed copy. */
export type EarningsBadgeSource = Pick<SecEarningsSnapshot, "score" | "tone" | "partial" | "toneLabel" | "periodLabel">;

export function earningsBadgeInput(snapshot: EarningsBadgeSource | null | undefined): EarningsBadgeInput {
  if (!snapshot || snapshot.score == null) return { word: null, why: "not-read", note: "no earnings read" };
  if (snapshot.partial) {
    const measured = /(\d+) of (\d+) measured/.exec(snapshot.toneLabel);
    return {
      word: null,
      why: "partial",
      note: measured ? `earnings score partial (${measured[1]} of ${measured[2]} measured), not counted` : "earnings score partial, not counted",
    };
  }
  const word = WORD[snapshot.tone];
  const period = snapshot.periodLabel ?? null;
  return { word, score: snapshot.score, period, note: `Earnings: ${word} (${snapshot.score}/100${period ? `, ${period}` : ""})` };
}
