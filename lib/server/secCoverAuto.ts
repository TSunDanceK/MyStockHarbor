// A TWO-CLASS FILER'S COVER COUNT WITHOUT A MAP ENTRY — ONLY ON ITS OWN WORDS
// (#552 COWORK #37, addendum).
//
// The cited map (data/sec/share-classes.json) covers the filers someone has
// read. A new listing is on nobody's list: SPCX's first 10-Q states its cover
// count per class (Class A and Class B) and no total, so its market cap read
// "Not available". This is the general rule for that case, and it is narrow:
//
//   - only when the filer has NO usable plain total (none, a multi-class
//     ambiguity, or one too old to value with) and NO map entry;
//   - only TWO classes on the newest cover date (three or more is the map's
//     job: a third class is exactly where weights stop being obvious);
//   - only when the SAME filing's text says the classes convert one-for-one,
//     and that sentence is stored with the number as its citation.
//
// Anything short of that returns a named refusal, which the caller records on
// the needs-review list (secCoverReview) for a person to read and, if right,
// add to the map. Nothing is summed on a guess, and nothing here is stored as
// a flag: every re-read derives it again from the live filing.
//
// PURE. The fetching is withClassCover's (secCoverClasses).
import type { CoverShares } from "./secExtract";
import type { ClassCoverFact } from "./secCoverClasses";

const DAY = 86_400_000;

/** The plain total the extractor found is usable: present, single, recent enough. */
export function coverIsUsable(cover: CoverShares | null, today: string, maxAgeDays: number): boolean {
  if (!cover || cover.val == null || !(cover.val > 0) || cover.candidates?.length) return false;
  return (Date.parse(today) - Date.parse(cover.asOf)) / DAY <= maxAgeDays;
}

const WORD = String.raw`(?:one|1|\(1\)|one\s*\(1\))`;
/**
 * Sentences that state a one-for-one conversion between share classes. Each
 * must also name "Class" and "convert" in the same sentence, so a stock split
 * or an exchange ratio elsewhere in the filing cannot match.
 */
const ONE_FOR_ONE = [
  new RegExp(String.raw`convertible\b[^.]{0,120}?\binto\s+${WORD}\s+(?:fully\s+paid\s+and\s+non-?assessable\s+)?shares?\s+of\s+(?:our\s+|the\s+Company'?s\s+)?Class\s+[A-Z]\b`, "i"),
  new RegExp(String.raw`\bconvert(?:s|ed|ible)?\b[^.]{0,160}?\b(?:on\s+a\s+)?(?:${WORD}[- ](?:for|to)[- ]${WORD}|share[- ]for[- ]share)\s+basis`, "i"),
];

/** The first sentence in `text` stating a 1:1 class conversion, trimmed, or null. */
export function oneToOneStatement(text: string): string | null {
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.;])\s+(?=[A-Z(])/);
  for (const s of sentences) {
    if (!/\bClass\s+[A-Z]\b/.test(s) || !/convert/i.test(s)) continue;
    if (ONE_FOR_ONE.some((re) => re.test(s))) return s.trim().slice(0, 400);
  }
  return null;
}

export type AutoCover =
  | { ok: true; cover: CoverShares }
  | { ok: false; why: string; classes: string[] };

/**
 * The newest cover date's two classes, summed one-for-one on the filing's own
 * statement, or why not.
 */
export function autoCoverFromClasses(
  facts: ClassCoverFact[],
  statement: string | null,
  filing: { accession: string | null; filed: string | null },
): AutoCover {
  if (!facts.length) return { ok: false, why: "no per-class cover facts in the filing", classes: [] };
  const asOf = facts.map((f) => f.asOf).sort().at(-1)!;
  const onDate = facts.filter((f) => f.asOf === asOf);
  const classes = [...new Set(onDate.map((f) => f.member))].sort();
  if (classes.length !== onDate.length) return { ok: false, why: "a class is stated twice on one cover date", classes };
  if (classes.length < 2) return { ok: false, why: "one class on the cover and no plain total", classes };
  if (classes.length > 2) return { ok: false, why: `${classes.length} classes on the cover: the cited map decides`, classes };
  if (!statement) return { ok: false, why: "the filing does not state that its classes convert one-for-one", classes };
  const val = onDate.reduce((a, f) => a + f.val, 0);
  if (!(val > 0)) return { ok: false, why: "summed total is not positive", classes };
  return {
    ok: true,
    cover: { asOf, accession: filing.accession, filed: filing.filed, val: Math.round(val), derived: "computed", basis: statement },
  };
}
