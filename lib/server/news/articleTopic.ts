// What an article is ABOUT, from its own words. Subjects and motifs, no symbol.
//
// The tagged-library brief of 2026-09-21, mirrored at
// claude/news-art-v2-headlines-2026-09-21.md §4.3. Pure function: no I/O, no
// network, no per-item AI call.
//
// ── WHY THIS EXISTS AT ALL ─────────────────────────────────────────────────
// /headlines has no symbol, so it has no sector, so `bucketFor()` can never
// reach it and the whole sector half of the library is unreachable from this
// page. PR #481 wired the event half in, which left exactly one way for a
// headline to get a picture: eventTypeFromTitle returning earnings, analyst or
// deal. Measured upper bound 7%, and the other 93% of the grid renders nothing.
//
// The v2 library is tagged by SUBJECT (`chips`, `refining`, `banks`) rather
// than bucketed by sector, and a subject is a thing a headline can say on its
// own. This module is what reads it out of the headline. Without it, dropping
// 330 images into public/news-art changes nothing at all: there is not one
// `any-any-*` image in the set, so with no tags nothing scores and nothing is
// picked.
//
// ── THE HOUSE RULES, CARRIED STRAIGHT FROM eventType.ts ────────────────────
// They were learned the hard way in this repo and none of them is restated as
// an opinion here:
//
//   1. WHOLE-WORD, PHRASE-ANCHORED. `chip` must not match `chipotle`; `EV`
//      must not match inside a word. Every pattern below is \b-anchored.
//
//   2. RETURNING NOTHING IS THE CORRECT ANSWER MOST OF THE TIME. A wrong
//      picture asserts something false about the article; a missing one
//      asserts nothing. This is the same reason eventTypeFromTitle is
//      deliberately short and biased towards null.
//
//   3. THE TITLE OUTRANKS THE DESCRIPTION. "Tesla falls as oil rises" is not
//      an oil story. A description match needs TWO independent occurrences
//      before it counts; a title match needs one.
//
//   4. FIRST MATCH WINS, ORDER IS MEANINGFUL, NARROW BEFORE BROAD — the same
//      discipline INDUSTRY_BUCKETS uses in art.ts.
//
// ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────
// It does not read a symbol, a sector, an industry or a provider label. The
// provider-map (FMP labels + SIC -> concepts) is a separate change for the
// three symbol-led surfaces and is deliberately not in this one.

/**
 * The tags an article carries, as the picker wants them.
 *
 * BOTH ARE ARRAYS AND BOTH ARE USUALLY EMPTY OR OF LENGTH ONE. Arrays because
 * artTags.ts scores by set intersection and the provider-map will one day
 * supply several subjects for one item; length one because rule 4 stops at the
 * first match, and a second subject would dilute a score whose entire job is to
 * say which ONE picture the article earns.
 */
export type ArticleTopic = {
  subjects: string[];
  motifs: string[];
};

/**
 * Subject patterns, in priority order.
 *
 * ── THIS TABLE IS A DRAFT, AND ITS FIRST NUMBER WAS FITTED ────────────────
 * It was written while looking at the 50 headlines live on /headlines on
 * 2026-09-21 and then measured against those same 50: 58% subject matches.
 * That is an upper bound on any other day's feed, in the same way the earlier
 * 7% was, and claude/news-art-v2-headlines-2026-09-21.md §6 records the
 * held-out re-run beside it. Neither number belongs in a sentence that does not
 * say which sample produced it.
 *
 * ORDER IS THE RULE, not a formatting choice: `refining` sits above
 * `oil-gas-upstream` because "refining margins" is also a crude story and the
 * narrower picture is the truer one, and `biotech` sits below `pharma` for the
 * same reason in reverse — a headline saying both is a pharma headline.
 *
 * Every name on the left must exist in manifest-v2.json. That is asserted by
 * scripts/check-news-art.mjs, not trusted: a pattern that can only ever score 0
 * is dead code that looks alive, which is the same failure shape as the
 * event-deals/deal plural trap art.ts records.
 */
const SUBJECT_PATTERNS: Array<[string, RegExp]> = [
  ["chips",            /\b(semiconductors?|semis|chipmakers?|chip[- ]industry|memory[- ]chips?|dram|wafers?|foundry)\b/i],
  ["ai-compute",       /\b(ai (buildout|infrastructure|capex|compute|chips?)|data ?cent(er|re)s?)\b/i],
  ["crypto",           /\b(bitcoin|crypto|ethereum|stablecoins?|digital assets?)\b/i],
  ["refining",         /\b(refiner(y|ies)|diesel|jet fuel|gasoline|refining margins?)\b/i],
  ["oil-gas-upstream", /\b(crude|opec|barrels?|natural gas|lng|oil (price|export|forecast|market)s?)\b/i],
  ["pipelines",        /\bpipelines?\b/i],
  ["utilities-grid",   /\b(utilit(y|ies)|power grid|electricity|electrification)\b/i],
  ["nuclear",          /\b(nuclear|reactors?|uranium)\b/i],
  ["solar",            /\bsolar\b/i],
  ["wind",             /\bwind (farms?|turbines?|power)\b/i],
  ["shipping",         /\b(tankers?|container ships?|freight rates?|strait of hormuz)\b/i],
  ["airlines",         /\b(airlines?|air travel)\b/i],
  // ── NARROWED FROM THE DRAFT, AND THE MEASUREMENT IS WHY ─────────────────
  // The draft was /\b(banks?|lenders?)\b/i. On the held-out sample
  // (scripts/newsart-topic-sample.mjs, 192 headlines captured 2026-09-13) it
  // fired three times and ALL THREE were a bank appearing in someone else's
  // story: "Bank of America resets Apple stock price target", "Deutsche Bank's
  // 304% Profit Growth Outlook" on NIO, and Costco "Shares Acquired by Saudi
  // Central Bank". A bank-vault illustration on an Apple analyst note asserts
  // something the article does not say, which is exactly the precision failure
  // the 3-vs-2 weighting exists to bound rather than to license.
  //
  // So the bare singular is gone. "Bank of America" now matches nothing here,
  // while "banks", "regional lenders" and "the banking sector" still do. It
  // costs no true positive on that sample — there were none to lose — and the
  // whole read-through is in claude/news-art-v2-headlines-2026-09-21.md §6.
  ["asset-management", /\b(etfs?|fund managers?|asset managers?|investment managers?|private equity)\b/i],
  ["exchanges",        /\b(s&p 500|nasdaq composite|stock futures|market breadth|wall street)\b/i],
  ["pharma",           /\b(drugs?|pharma|biopharma|vaccines?)\b/i],
  ["biotech",          /\bbiotech\b/i],
  ["autos",            /\b(carmakers?|automakers?|auto industry)\b/i],
  // ── LEFT AS THE DRAFT, ON PURPOSE, AND THE ONE HIT IS RECORDED ─────────
  // `evs?` fired once on the held-out sample, on "China's 'Hottest' Memory-Chip
  // Company Just Won An EV Backer" — where EV describes the investor, not the
  // story. That headline still got the right picture, because `chips` sits
  // higher and won, which is luck rather than design.
  //
  // ONE AMBIGUOUS INSTANCE IS NOT A MEASUREMENT, and narrowing a pattern to fit
  // it is how a table stops describing the feed and starts describing the
  // sample. It is written down in §6 of the doc as the thing to look at on the
  // next capture instead.
  ["ev",               /\b(electric vehicles?|evs?|charging network)\b/i],
  ["retail-stores",    /\b(retailers?|consumer spending|holiday shopping)\b/i],
  ["software",         /\b(software|saas)\b/i],
  ["homebuilders",     /\b(housing starts|homebuilders?|home sales)\b/i],
  ["mining-precious",  /\b(gold|silver|bullion)\b/i],
  ["steel",            /\bsteel\b/i],
  ["agriculture",      /\b(wheat|corn|soybeans?|crops?|farmers?)\b/i],
];

/**
 * Motif patterns, in priority order.
 *
 * A MOTIF IS WHAT HAPPENED, a subject is what it happened to, and they are
 * scored on separate axes precisely so a story can be both. `macro` sits at the
 * top because a Fed headline is a macro headline whatever else it mentions.
 *
 * EIGHT OF THE SIXTEEN MOTIFS THE LIBRARY HOLDS HAVE NO PATTERN HERE — `cash`,
 * `contract`, `filing`, `launch`, `leadership`, `partnership`, `split`,
 * `supply`. That is deliberate and is not a backlog item to clear for its own
 * sake: a motif reachable by a phrase that carries two meanings in a financial
 * headline costs more than a motif that is never reached. Add one only with a
 * phrase that carries one.
 */
const MOTIF_PATTERNS: Array<[string, RegExp]> = [
  ["macro",      /\b(fed|federal reserve|rate (hike|cut)|interest rates?|inflation|treasury yields?|tariffs?|trade (war|truce)|gdp|central bank)\b/i],
  ["deal",       /\b(takeover|mergers?|acquisitions?|to acquire|funding round|bid for)\b/i],
  ["legal",      /\b(lawsuits?|sues?|court|settlements?|antitrust)\b/i],
  ["jobs",       /\b(layoffs?|hiring|labor unions?|workforce)\b/i],
  ["earnings",   /\b(earnings|quarterly results|beats? estimates)\b/i],
  ["guidance",   /\b(forecasts?|outlook|guidance)\b/i],
  ["ipo",        /\b(ipo|public offering|plans? (an? )?listing)\b/i],
  ["analyst",    /\b(price target|initiates coverage|rated buy)\b/i],
];

/** Exposed for scripts/check-news-art.mjs, which asserts every name is real. */
export const SUBJECT_TAGS: string[] = SUBJECT_PATTERNS.map(([tag]) => tag);
export const MOTIF_TAGS: string[] = MOTIF_PATTERNS.map(([tag]) => tag);

/**
 * How many times a pattern matches, counted at DISTINCT OFFSETS.
 *
 * Rule 3 needs "two independent matches in the description" to be a number, and
 * the only honest reading of independent is "not the same occurrence twice".
 * Two mentions of oil in a paragraph is an oil story; one is a passing clause.
 *
 * The source pattern is cloned with the `g` flag rather than mutated, because a
 * module-level RegExp carrying `lastIndex` between calls is a stateful bug that
 * only shows up on the second article.
 */
function countMatches(pattern: RegExp, text: string): number {
  if (!text) return 0;
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let count = 0;
  let last = -1;
  for (let m = global.exec(text); m; m = global.exec(text)) {
    if (m.index !== last) {
      count += 1;
      last = m.index;
    }
    // A zero-width match would spin forever. None of the patterns above can
    // produce one, and the guard costs nothing if one is ever added.
    if (m[0].length === 0) global.lastIndex += 1;
    if (count >= 2) return count;
  }
  return count;
}

/**
 * First match over the title, then — only if the title said nothing — first
 * match over the description with two occurrences required.
 *
 * THE TWO PASSES ARE WHOLE PASSES, not one pass over both strings. A title
 * match on the fourth pattern must beat a description match on the first, or
 * the weaker evidence quietly wins whenever it happens to sit higher in the
 * table, and rule 3 stops meaning anything.
 */
function firstTag(patterns: Array<[string, RegExp]>, title: string, description: string): string[] {
  for (const [tag, pattern] of patterns) {
    if (pattern.test(title)) return [tag];
  }
  for (const [tag, pattern] of patterns) {
    if (countMatches(pattern, description) >= 2) return [tag];
  }
  return [];
}

/**
 * An article's tags, from its own words.
 *
 * EMPTY IS A RESULT, NOT A FAILURE. artTags.pickTagged turns a score of 0 into
 * null and /headlines turns null into the event-art path it already had, so an
 * article this module says nothing about is exactly as it is today — never a
 * random picture.
 */
export function articleTopic(
  title: string | null | undefined,
  description?: string | null
): ArticleTopic {
  const titleText = String(title ?? "");
  const descriptionText = String(description ?? "");
  if (!titleText && !descriptionText) return { subjects: [], motifs: [] };

  return {
    subjects: firstTag(SUBJECT_PATTERNS, titleText, descriptionText),
    motifs: firstTag(MOTIF_PATTERNS, titleText, descriptionText),
  };
}
