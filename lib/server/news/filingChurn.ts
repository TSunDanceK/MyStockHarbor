// Institutional-holding churn, and the one grammar that recognises it.
//
// ── WHAT THIS IS FOR ───────────────────────────────────────────────────────
// "Chokshi & Queen Wealth Advisors Inc Takes Position in Micron Technology".
// One article per institutional filer per stock, hundreds per company per
// quarter, generated from 13F filings. On the step-7 preview 13 of 15 cards on
// /stock/MU/news were these. Several republish with their own template broken:
// the body reads "during the undefined quarter".
//
// ── WHY NO PROBE CAUGHT IT, which is the part worth keeping ────────────────
// Every news probe so far measured PRECISION — is this item about MU — and
// returned 96-100%. These pass that perfectly: they ARE about MU. Nothing ever
// measured whether an item was worth READING, so nothing could have caught
// this. See claude/traps/precision-is-not-worth-reading.md.
//
// ── NOT A PUBLISHER LIST, and that is a requirement rather than a preference ─
// lib/stock-news-data.ts already carries a `lowValueSources` denylist, and it
// already names this exact class of publisher. It did not fire, because a
// denylist matches a SPELLING: the entry reads "defense world" and Google News
// does not label the publisher with that space in it. This repo has retired a
// curated allowlist and a curated theme-word list for the same reason, and the
// denylist that is still here is the one that just failed in production.
//
// So the rule reads the HEADLINE'S SHAPE and never the publisher. It catches
// the same churn from a farm nobody has seen yet, which a list cannot.
//
// ── MEASURED, ON 353 REAL HEADLINES ────────────────────────────────────────
// scripts/fixtures/churn-sample.tsv — four full Google News feeds captured
// through the relay (the sandbox is refused news.google.com). Results:
//
//   MU     0/100    BRK-B  0/100    CYRX  4/53 (7%)    JPM  48/100 (48%)
//
// JPM at 48% is the scale of the thing: at the time of capture nearly half of
// one of the most heavily covered stocks on the site was filing churn. BRK-B
// and MU at zero are the false-positive control, and they were not free —
// three earlier drafts scored 1-2 false positives on them and each one taught
// the rule something:
//   · "Have Insiders Sold Micron Technology Shares Recently?" — a real article.
//     Fixed by requiring a FIRM designator: an insider is not an LLC.
//   · "Berkshire Hathaway's housing bet deepens as it boosts Lennar stake to
//     $1.2B" — real news. Same fix; "Berkshire Hathaway" carries no designator.
//   · "Berkshire Hathaway Earnings: Cash Balances Retreat on Increased
//     Investments and Share Buybacks in Q2" — real. Fixed by dropping
//     `Investments`, `Financial`, `Retirement` and `Securities` from the
//     designator list: they are ordinary English nouns wearing a firm's coat.
//
// ── THE FALSE POSITIVE THAT IS LEFT IS NOT A BUG TO TUNE OUT ───────────────
// "Warren Buffett's Berkshire Hathaway Inc. discloses new stake in Alphabet"
// matches, and it is real news. Structurally it IS the same sentence as
// "OceanIQ Capital LLC Buys New Stake in Micron Technology" — the only
// difference is that a reader cares who Berkshire is, which is not in the
// grammar. It cannot be fixed by a better regex, and tuning until this one
// case passes would be fitting the rule to its own test.
//
// IT IS WHY THE CALLERS CAP RATHER THAN EXCLUDE. A cap keeps a couple, so the
// Berkshire story survives as one of them; an exclusion would delete it. That
// is also why the rule does not need to be perfect: residual churn costs one
// kept slot, not a page.

/**
 * A legal-entity designator or firm-type word.
 *
 * CASE-SENSITIVE, because these are proper-noun designators: "Trust Co. of
 * Vermont" is a filer and "we trust the numbers" is not.
 *
 * `(?!\w)` RATHER THAN `\b`, and the difference was not cosmetic. `\bInc\.\b`
 * cannot match "…Shares Sold by BlackRock Inc." — a word boundary after "."
 * needs a word character to follow it, and there is none at the end of a title.
 * That single boundary was silently dropping the commonest churn shape in the
 * sample: six of the JPM items, all of them textbook cases.
 */
const FIRM_DESIGNATOR =
  /(?:\b(?:LLC|L\.L\.C|Incorporated|Corporation|Aktiengesellschaft|GmbH|PLC|AG|LLP|LP|Advisors?|Advisers?|Capital|Management|Partners?|Group|Bancorp|Bank|Trust|Associates|Ops|Holdings)(?!\w))|(?:\b(?:Inc|Corp|Ltd|Co|N\.V|S\.A|L\.P)\.(?!\w))/;

const HOLDING = String.raw`\b(?:stock\s+)?(?:positions?|stakes?|shares?|holdings?|shareholdings?)\b`;
const TRANSACTION_VERB = String.raw`\b(?:buys?|bought|purchas\w+|acquir\w+|sells?|sold|boosts?|grows?|raises?|lifts?|increases?|decreas\w+|reduces?|trims?|cuts?|takes?|holds?|owns?|has|have)\b`;

/**
 * A holding changing hands, in any of the four shapes the sample actually uses.
 *
 * Both word orders are real and a rule that knew only one would miss half the
 * feed: the firm-first active voice ("X Buys New Position in COMPANY") and the
 * company-first passive ("COMPANY $JPM Shares Sold by X") are roughly evenly
 * split in the JPM capture.
 */
const HOLDING_TRANSACTION = new RegExp(
  `(?:${TRANSACTION_VERB}[^.]{0,60}${HOLDING})` +              // Buys New Position in / Purchases 321,497 Shares of
    `|(?:${HOLDING}[^.]{0,40}\\b(?:by|of|in)\\b)` +            // Shares Sold by / Stock Position Lifted by
    `|(?:\\binvests?\\b[^.]{0,40}\\$)` +                       // Invests $668,000 in
    `|(?:\\$[\\d.,]+\\s*(?:million|billion|thousand)?\\s*${HOLDING})`, // Has $160.13 Million Stock Position in
  "i"
);

/**
 * Is this headline an institutional-holding notice?
 *
 * BOTH GATES, never either alone. The designator alone matches any headline
 * mentioning a company with "Inc." in its name; the transaction alone matched
 * the two real Berkshire and Micron stories above. It is the conjunction that
 * carries the measured zero false positives across 200 MU and BRK-B headlines.
 */
export function isFilingChurn(title: string | null | undefined): boolean {
  const text = String(title ?? "").trim();
  if (!text) return false;
  return FIRM_DESIGNATOR.test(text) && HOLDING_TRANSACTION.test(text);
}

/**
 * How many churn items the store keeps, per symbol.
 *
 * THE SAME SHAPE AND THE SAME NUMBER AS THE SEC ADAPTER'S ROUTINE-FORM CAP,
 * deliberately: MU's filings feed was 22 Form 4/144 out of 25, crowding out the
 * 10-Q and the earnings 8-K, and step 5 capped routine forms at 3 rather than
 * excluding them. This is the identical bug one level up — at the publisher
 * instead of the form — and it gets the identical answer.
 *
 * A HANDFUL IS SIGNAL; A WALL IS NOISE. That several institutions bought into a
 * name is worth a reader's glance. Thirteen cards of it is a feed nobody reads.
 */
export const MAX_CHURN_STORED = 3;
