// Matching a universe symbol to an SEC filer by COMPANY NAME, not by ticker.
//
// ── WHY THE TICKER KEY IS THE WRONG FIELD ──────────────────────────────────
// data/cik-map.json is built by intersecting our symbols with SEC's
// company_tickers.json ON THE TICKER STRING. Relay run 47 left 11 misses, and
// every single one anybody has actually resolved was present at SEC all along
// under a DIFFERENT symbol:
//
//   ours   SEC's    CIK        title
//   MMC    MRSH     62709      MARSH & MCLENNAN COMPANIES, INC.
//   FI     FISV     798354     FISERV INC
//   BK     BNY      1390777    Bank of New York Mellon Corp
//
// Not one of them is a dead company, a delisting, or a gap in SEC's data. The
// join key is simply wrong: a ticker is a mutable label and the two sides
// update on different clocks. The company NAME is the stable thing.
//
// ── THE EXCEPTION THIS IS, STATED SO IT IS NOT READ AS AN INCONSISTENCY ────
// lib/server/news/wireProvider.ts REFUSES name matching in as many words:
// "`companyName` is unused — matching is by ticker, and a name match would
// reintroduce exactly the text guessing the structured field avoids." That is
// correct THERE and is not being softened here. The risk profiles are not
// comparable:
//
//                        wireProvider                  this
//   when                 every render, per symbol      once, at build time
//   on a wrong match     a foreign company's press     nothing — the candidate
//                        release on a stock page,      is printed, and a human
//                        served to a reader            approves before commit
//   checkable            no                            yes: every proposed CIK
//                                                      is verifiable against
//                                                      data.sec.gov/submissions
//   alternative          a structured <category>       none. The ticker key is
//                        field that is always right    the thing that failed.
//
// The wire has a correct structured field available and should use it. Here the
// structured field IS the thing that failed, the output is a reviewable list
// rather than a rendered page, and a wrong match is caught before it ships.
//
// ── NOTHING HERE APPLIES A MATCH ──────────────────────────────────────────
// This module SCORES and RANKS. It cannot write, it does not know what a CIK
// map is, and its output is deliberately shaped as a list of candidates rather
// than a symbol -> CIK object, so that no caller can commit it by mistake.

/**
 * Tokens that carry no identifying information in a company name.
 *
 * LEGAL-FORM WORDS ONLY, AND THAT IS THE WHOLE LIST. An earlier version had a
 * second list of "structural" words -- HOLDINGS, GROUP, TRUST, PARTNERS -- that
 * were dropped for the exact tier on the theory that both sides must then agree
 * on everything surviving.
 *
 * IT WAS BOTH UNNECESSARY AND WRONG, and a sharpened assertion caught it. Not
 * one of the three known cases needs it: MMC, FI and BK reduce identically
 * without dropping a single structural word, because COMPANIES, INC and
 * CORPORATION are all legal forms. And with it, "Brookfield Corporation" and
 * "Brookfield Partners" both collapse to {BROOKFIELD} and are reported as an
 * EXACT match -- two distinct filers, presented at the one tier that is meant to
 * be near-certain. The knob bought nothing and cost the tier its meaning.
 *
 * The general lesson, for the next person adding a normalisation step: a token
 * you drop is a distinction you can no longer make. Dropping INC is safe
 * because no two companies differ only by it. PARTNERS is not that.
 */
export const LEGAL_FORM_TOKENS = new Set([
  "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "COMPANIES",
  "PLC", "LTD", "LIMITED", "LLC", "LP", "LLP", "NV", "SA", "AG", "AB", "AS",
  "SE", "OYJ", "SPA", "KGAA", "THE", "CLASS", "COM", "ORD", "SHS", "ADR", "ADS",
]);

/** Joining words that are never identifying. */
const STOPWORDS = new Set(["OF", "AND", "THE", "FOR", "A", "AN"]);

/**
 * Banking legal forms, folded onto one token.
 *
 * NOT DROPPED — FOLDED, and the difference is the whole design. "Northeast
 * Bank" and "Northeast Bancorp" are the bank and its holding company, and SEC's
 * filer is normally the holding company; those should meet. But DROPPING the
 * form token would also make "Northeast" alone match either, which throws away
 * a real distinction. Mapping every spelling onto BANK keeps the token present
 * while making its spellings equivalent.
 *
 * IT DOES NOT DECIDE ANYTHING ON ITS OWN. If both "X Bank" and "X Bancorp"
 * exist as separate filers they now tie at the same tier, which sets
 * `ambiguous` and refuses to confirm — the correct outcome for two real
 * candidates, and the reason folding is safe where dropping would not be.
 *
 * SCOPED TO BANKS BECAUSE THAT IS WHERE IT WAS MEASURED. Run 49's only two
 * matchable symbols were both banks (NBN "Northeast Bank", TOWN "Towne Bank"),
 * and Bank/Bancorp/Bancshares variation is a property of that sector's naming,
 * not a general rule. No other sector gets an alias list without its own
 * evidence.
 */
/**
 * ── THE INVERSE OF THE DROP RULE, AND IT COST TWO WRONG COMPANIES ─────────
 *
 *   A token you DROP is a distinction you can no longer make.
 *   A token you FOLD becomes a token that matches EVERYTHING.
 *
 * The first half was learned by dropping HOLDINGS/GROUP/PARTNERS and collapsing
 * "Brookfield Corporation" onto "Brookfield Partners". The second half was
 * learned immediately afterwards by folding BANCORP onto BANK, which turned the
 * most generic word in the sector into match evidence:
 *
 *   TOWN  "Towne Bank"     -> 0.50  TBBK  "Bancorp, Inc."   <- one shared token,
 *   NBN   "Northeast Bank" -> 0.50  TBBK  "Bancorp, Inc."      and it is BANK
 *
 * TowneBank is not The Bancorp Inc. The fold is still right — "Northeast Bank"
 * and "NORTHEAST BANCORP" must meet — but the folded token must NEVER be the
 * thing that makes two names meet. BANK, BANCORP, BANCSHARES, FINANCIAL, INC
 * and CORP are the shared vocabulary of every filer in the sector: use them to
 * NORMALISE, never let them COUNT.
 *
 * So folding is paired with GENERIC_TOKENS below, and neither ships without the
 * other.
 */
const BANK_FORM_ALIASES = new Map([
  ["BANCORP", "BANK"],
  ["BANCORPORATION", "BANK"],
  ["BANCSHARES", "BANK"],
  ["BANKSHARES", "BANK"],
  ["BANCORPINC", "BANK"],
  ["BANKING", "BANK"],
  ["BANKS", "BANK"],
]);

/**
 * A name to its identifying tokens.
 *
 * WHAT ACTUALLY MAKES "Marsh & McLennan" WORK IS THE PUNCTUATION STRIP, not any
 * special handling of `&`. The first version expanded `&` to " AND " and then
 * dropped AND as a stopword, with a comment claiming that step was what bridged
 * MMC. A mutation replacing the expansion with a plain space SURVIVED every
 * assertion, because the two are identical in every case: `&` → " AND " → AND
 * dropped, and `&` → " ", both leave MARSH MCLENNAN. It was elaboration wearing
 * a load-bearing comment.
 *
 * lib/server/news/companyName.ts already records this exact species of mistake
 * about its own suffix list -- "a comment claiming the ordering is what protects
 * the name would have been credit in the wrong place". Same error, one file
 * over. Removed rather than kept with a corrected note, because a step that
 * changes no output is a step the next reader has to disprove again.
 *
 * "AND" stays in the stopword list on its own merits: a name spelled out as
 * "Marsh and McLennan" has to reduce the same way as one written with `&`.
 *
 * Trailing state-of-incorporation markers (`/DE/`, `/MD/`) are stripped: SEC
 * writes them on some titles and nobody else writes them at all.
 */
export function nameTokens(name) {
  if (typeof name !== "string") return [];
  const cleaned = name
    .toUpperCase()
    .replace(/\/[A-Z]{2}\/?$/g, " ")     // /DE/ state markers
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  if (!cleaned) return [];

  return cleaned
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t) && !LEGAL_FORM_TOKENS.has(t))
    .map((t) => BANK_FORM_ALIASES.get(t) ?? t);
}

/**
 * Tokens that every filer in the sector shares, so they can never be evidence.
 *
 * DELIBERATELY TINY. BANK is here because BANK_FORM_ALIASES folds four
 * spellings onto it, which is exactly what makes it generic. FINANCIAL is here
 * because it is the same kind of word and "Summit Financial" must not become
 * "Summit Bank". INC, CORP and the rest never reach scoring — LEGAL_FORM_TOKENS
 * removes them earlier.
 *
 * Nothing else goes in without its own evidence. Every list in this file that
 * grew on plausibility rather than on a measured case has been wrong.
 */
const GENERIC_TOKENS = new Set(["BANK", "FINANCIAL"]);

const setOf = (tokens) => new Set(tokens);
const distinctive = (tokens) => [...tokens].filter((t) => !GENERIC_TOKENS.has(t));
/**
 * Tokens joined with nothing, so a spacing difference stops being a difference.
 *
 * ORDER IS PRESERVED, and the first version sorted — which broke the one case
 * this exists for. "Towne Bank" sorted to BANK+TOWNE = "BANKTOWNE" and never
 * met "TOWNEBANK". A compound word is the SAME CHARACTERS IN THE SAME ORDER
 * with a boundary removed; sorting throws away the half of that which does the
 * work. It also makes the comparison far too generous: sorted, "Bank Towne"
 * would match "TOWNEBANK" too, and word order is real information.
 */
const squash = (tokens) => [...tokens].join("");
const eqSet = (a, b) => a.size === b.size && [...a].every((t) => b.has(t));
const subset = (a, b) => [...a].every((t) => b.has(t));

/**
 * How well two names agree, as a TIER plus a score.
 *
 *   exact    identical identifying tokens once legal-form words go.
 *            This is the tier that bridged the corroborated cases, and it is
 *            the only one that should ever be treated as near-certain.
 *   compound the same characters with a different word boundary — "Towne Bank"
 *            against "TOWNEBANK". Nearly as strong as exact, kept separate so a
 *            reviewer can see which rule fired.
 *   subset   one side's tokens are wholly contained in the other's. Common and
 *            usually right ("Fiserv" vs "Fiserv Solutions"), but it is also how
 *            a parent swallows a subsidiary, so it is a candidate, not a match.
 *   partial  Jaccard over the union. Printed for a human to judge; never more.
 *   none     below the floor.
 *
 * THE FLOOR IS NOT A TUNING KNOB. A single shared token between two
 * multi-token names is noise -- "American Airlines" vs "American Express".
 *
 * THE `shared >= 2` GUARD BELOW IS UNREACHABLE AT THE CURRENT FLOOR, and saying
 * so is the point. With one shared token and neither side a subset of the
 * other, the union is at least three, so the score cannot exceed 1/3 and the
 * 0.6 floor already excludes it -- proved by enumeration, not assumed. A
 * mutation weakening it to `shared >= 1` therefore changes nothing and no test
 * can kill it.
 *
 * It stays as insurance on the floor rather than as a second filter: lowering
 * PARTIAL_FLOOR is a one-character edit that looks harmless, and it is the
 * edit that would let single-token noise through. The invariant -- one shared
 * token never reaches `partial` -- is asserted directly in
 * scripts/check-sec-title-match.mjs, since the guard itself cannot be.
 */
export const PARTIAL_FLOOR = 0.6;

export function scoreNames(ours, theirs) {
  const a = setOf(nameTokens(ours));
  const b = setOf(nameTokens(theirs));
  if (!a.size || !b.size) return { tier: "none", score: 0, shared: 0 };

  // ── A NAME MADE ONLY OF SECTOR BOILERPLATE IDENTIFIES NOBODY ────────────
  // "Bancorp, Inc." reduces to {BANK} and nothing else. It was matching both
  // TOWN and NBN at 0.50 on that single token. A side with no distinctive token
  // cannot be a candidate for anything, because there is no name left in it.
  const aDistinct = distinctive(a);
  const bDistinct = distinctive(b);
  if (!aDistinct.length || !bDistinct.length) return { tier: "none", score: 0, shared: 0 };

  // ── AND THE MATCH MUST REST ON SOMETHING DISTINCTIVE ────────────────────
  // Two names that agree only on generic words agree on nothing.
  //
  // UNREACHABLE AS THE CONSTANTS STAND, and the proof is worth writing down
  // because it names the edit that makes it live. Given the rule above (both
  // sides hold a distinctive token) this can only fire on a `partial`, which
  // needs shared >= 2 and score >= 0.6. If every shared token is generic then
  // shared <= |GENERIC_TOKENS| = 2, so shared is exactly 2, so both sides hold
  // both generics PLUS a distinctive one, so |a|,|b| >= 3 and the union is >= 4
  // — score <= 0.5, under the floor. `exact` and `subset` cannot reach it
  // either: both imply the smaller side's tokens are all shared, and that side
  // has a distinctive one.
  //
  // A THIRD GENERIC TOKEN BREAKS THAT. At |GENERIC_TOKENS| = 3 a pair like
  // {D1,G1,G2,G3} / {D2,G1,G2,G3} shares 3 of a union of 5 = 0.60, which lands
  // exactly ON the floor and would be admitted on generic agreement alone. So
  // this guard is the thing that makes growing that list safe, and
  // scripts/check-sec-title-match.mjs asserts the invariant rather than the
  // line — because a line no input can reach is a line no mutation can kill.
  const sharedDistinct = aDistinct.filter((t) => b.has(t)).length;
  if (!sharedDistinct && squash(a) !== squash(b)) return { tier: "none", score: 0, shared: 0 };

  if (eqSet(a, b)) return { tier: "exact", score: 1, shared: a.size };

  // COMPOUND SPACING. "Towne Bank" vs "TOWNEBANK" shares ZERO tokens and scores
  // 0 — not a weak match, an invisible one, because tokenising put a boundary
  // where the other side has none. Comparing the tokens joined end to end sees
  // through it. Ranked just under `exact`: the evidence is nearly as strong
  // (every character in the same order) but the boundary difference is real and
  // a human should see which rule fired.
  if (squash(a) === squash(b)) return { tier: "compound", score: 1, shared: 0 };

  const shared = [...a].filter((t) => b.has(t)).length;
  const union = new Set([...a, ...b]).size;
  const score = union ? shared / union : 0;

  if (shared && (subset(a, b) || subset(b, a))) return { tier: "subset", score, shared };
  // Two shared tokens minimum: one is noise between any two American Somethings.
  if (shared >= 2 && score >= PARTIAL_FLOOR) return { tier: "partial", score, shared };
  return { tier: "none", score, shared };
}

const TIER_RANK = { exact: 4, compound: 3, subset: 2, partial: 1, none: 0 };

/**
 * Rank every SEC row against one of our names.
 *
 * AMBIGUITY IS REPORTED, NOT RESOLVED. Two filers reaching the same top tier is
 * the case where an automatic pick would be confidently wrong — "Brookfield"
 * matches five entities — so the result carries `ambiguous` and the caller is
 * expected to refuse to confirm it. Silently taking the first would be exactly
 * the text guessing wireProvider is right to refuse.
 */
export function rankCandidates(ourName, secRows, { limit = 5 } = {}) {
  const scored = [];
  for (const row of secRows) {
    const verdict = scoreNames(ourName, row.title);
    if (verdict.tier === "none") continue;
    scored.push({ ...row, ...verdict });
  }

  scored.sort((x, y) =>
    TIER_RANK[y.tier] - TIER_RANK[x.tier] || y.score - x.score || x.ticker.localeCompare(y.ticker));

  const top = scored[0];
  const ambiguous = Boolean(
    top && scored.filter((c) => c.tier === top.tier && c.score === top.score).length > 1
  );

  return { candidates: scored.slice(0, limit), ambiguous, topTier: top?.tier ?? "none" };
}
