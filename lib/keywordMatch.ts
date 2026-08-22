// Word-boundary keyword matching, in one place.
//
// WHAT WAS WRONG. keywordHits was `lower.includes(word)` -- a raw substring
// test -- and it decided which stories are earnings stories, which are low
// value, and how every headline scores. Substring matching on English words
// misfires constantly, and it did:
//
//   "quarter"  matched  "headquartered"   <- reported live on MU: a story
//                                            headlined "Micron Committed $10
//                                            Billion Over 10 Years to a
//                                            Research Lab" sat in the earnings
//                                            section because its body said
//                                            "headquartered"
//   "eps"      matched  "steps", "keeps", "sleeps"
//   "profit"   matched  "nonprofit"
//   "margin"   matched  "marginal", "marginally"
//   "ai"       matched  "said", "maintain", "chair", "retail", "air", "raise"
//   "meta"     matched  "metal", "metaverse"
//
// None of these are visible failures. The story renders, the section fills, the
// score comes out a number. The only symptom is that the earnings section is
// full of things that are not earnings -- which reads as "this is what the
// filter found" rather than "the filter is matching letters, not words"
// (claude/traps/a-visible-failure-is-not-a-harmless-one.md).
//
// WHY NOT PLAIN \bword\b. Because the substring behaviour was doing real work
// too, and a naive boundary fix trades one error for the opposite one:
// "profit" would stop matching "profits", "loss" would stop matching "losses",
// "miss" would stop matching "missed", "surge" would stop matching "surged".
// So a short inflection suffix is allowed -- s / es / d / ed -- which keeps the
// plurals and past tenses while still refusing "headquartered" ("quarter" there
// has no boundary in front of it) and "marginal" ("al" is not an inflection).
//
// WHAT THIS DOES NOT FIX, stated plainly rather than left to be discovered:
// "results" genuinely appears as a word in "which results in higher costs", and
// no matcher can tell that from "Q3 results". That is a bad KEYWORD, not a bad
// match, and narrowing the earnings vocabulary is a separate decision from
// fixing the matcher -- see claude/picker-signals-and-news-bandwidth-2026-08-22.md.
//
// Verified by scripts/check-keyword-matching.mjs, which runs this exact
// function against every reported false positive and against the true
// positives that must survive.

// Compiled once per distinct keyword. The lists are long, they are re-tested
// per headline, and up to 120 items are scored per request -- building a
// RegExp per word per call would be the instrument costing more than the thing.
const cache = new Map<string, RegExp>();

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function matcher(word: string): RegExp {
  let re = cache.get(word);
  if (!re) {
    // Inflections only. Deliberately NOT \w* -- that is substring matching with
    // extra steps and would put "headquartered" straight back.
    re = new RegExp(`\\b${escape(word)}(?:es|ed|s|d)?\\b`, "i");
    cache.set(word, re);
  }
  return re;
}

/**
 * True when any of `words` appears in `text` as a whole word.
 *
 * Multi-word entries ("price target cut", "white house", "52-week") work
 * unchanged: the boundaries land at the ends of the phrase, and the spaces and
 * hyphens inside it are boundaries already.
 */
export function keywordHits(text: string, words: string[]): boolean {
  return words.some((word) => matcher(word).test(text));
}
