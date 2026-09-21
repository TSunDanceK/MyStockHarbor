// Reading deal terms off a prospectus cover.
//
// ── WHY THIS IS A MODULE AND NOT A FUNCTION IN THE SEED ────────────────────
// It was a function in the seed, and that is the single most drift-prone shape
// this build could have shipped. TWO WRITERS FILL THE SAME FIELD: the seed
// (scripts/ipo-seed.mjs, on a runner) and the daily refresh
// (app/api/jobs/ipo-refresh, in the app). If each carried its own copy of these
// regexes, a fix applied to one would leave the other quietly producing
// DIFFERENT PRICES FOR THE SAME FILING -- and both sets of rows would look
// exactly as plausible as each other, because a price range that is wrong is
// still a price range.
//
// That is the argument that already put mergeIpoRecords and buildSecIpoTables
// in lib/server rather than in the script, stated in both of their headers. The
// parser belongs there for the same reason and was the last piece left out.
//
// NO IMPORTS, DELIBERATELY -- not even a type. Node's ESM loader on the relay
// resolves this file through scripts/lib/ts-resolve.mjs, and the relay's
// read-only job runs NO `npm ci`. A dependency here would cost the seed its
// ability to call the same parser the app calls, which is the whole point.
//
// ── THE PARSER'S OWN RULE: NULL BEATS A GUESS ──────────────────────────────
// Phase 0 gated this at 5/5 on correctness, and the gate it replaced was a
// parser that answered confidently and wrongly: "$0.00001" is a PAR VALUE, and
// the earlier version read it as an offer price. A dash in the column is
// honest. A number that came from the wrong sentence is not, and nothing
// downstream can tell the difference -- see
// claude/traps/a-filter-that-matches-nothing-looks-correct.md, whose addendum
// is precisely this failure in another guise.

/** Cover-page terms, where the parser was confident. */
export type IpoCoverTerms = {
  priceRangeLow: number | null;
  priceRangeHigh: number | null;
  sharesOffered: number | null;
  exchange: string | null;
  proposedSymbol: string | null;
};

/**
 * HTML to text, crudely and on purpose.
 *
 * A prospectus cover is a table-heavy filing whose numbers sit between tags; a
 * real HTML parser would be better and is not available to a script the relay
 * runs with no `npm ci`. What matters is that both writers strip IDENTICALLY,
 * because the phrase anchors below match across the whitespace this produces.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x201c;|&#x201d;/g, '"')
    .replace(/&#\d+;|&#x[0-9a-f]+;/gi, " ")
    .replace(/\s+/g, " ");
}

/**
 * The plausibility bound on a per-share price.
 *
 * $1 floors out par values and fractions-of-a-cent; $500 ceilings out a share
 * count or a dollar total caught by a price pattern.
 */
const plausible = (n: number) => Number.isFinite(n) && n >= 1 && n <= 500;

/**
 * BOTH ENDS PLAUSIBLE IS NOT ENOUGH, and this constant is why.
 *
 * The first seed run produced Aptevo at $11.70-$428.40 -- every value inside
 * the $1-$500 bound, and therefore a computed deal size of $1.42 BILLION for a
 * microcap follow-on. A real IPO range is tight; underwriters do not market a
 * 36x spread. A ratio wider than 3x means the two numbers came from different
 * sentences, so the range is discarded rather than published.
 */
const RATIO_MAX = 3;

/** How much of the document is the "cover" for matching purposes. */
const COVER_CHARS = 80000;

const RANGE_PHRASES = [
  /(?:initial public offering price|public offering price|offering price)[^.]{0,60}?between\s+\$\s?([\d.]+)\s+and\s+\$\s?([\d.]+)/i,
  /between\s+\$\s?([\d.]+)\s+and\s+\$\s?([\d.]+)\s+per\s+(?:share|ADS)/i,
  /\$\s?([\d.]+)\s*(?:to|and|–|—|-)\s*\$\s?([\d.]+)\s+per\s+(?:share|ADS)/i,
];

const FINAL_PHRASES = [
  /initial public offering price (?:is|of|was)\s+\$\s?([\d.]+)/i,
  /public offering price (?:is|of|was)\s+\$\s?([\d.]+)\s+per\s+(?:share|ADS)/i,
  /offering price of\s+\$\s?([\d.]+)\s+per\s+(?:share|ADS)/i,
];

const SPAC_UNIT = /\$\s?10\.00\s+per\s+unit|price of\s+\$\s?10\.00/i;
const SPAC_BODY = [/blank check company/i, /business combination/i, /trust account/i];

// ── HOW MANY SHARES ARE BEING OFFERED ──────────────────────────────────────
//
// ── THE RULE THIS REPLACED WAS WRONG 71% OF THE TIME IT ANSWERED ──────────
// It was two unanchored patterns:
//
//   ([\d,]{5,})\s+shares\s+of\s+(?:our\s+)?(?:common|ordinary)\s+(?:stock|shares)
//   offering\s+([\d,]{5,})\s+shares
//
// taking the FIRST match in 80,000 characters. Phase 0 gated the PRICE parser
// at 5/5 against real covers and never measured this one at all. Relay run
// 35583959865 measured it over 94 live covers:
//
//   shipped rule returned a number                38 / 94
//   ...whose sentence was DISQUALIFYING           27 / 38      <- 71%
//   ...of which specifically "outstanding"        12
//
// A prospectus cover says "shares of our common stock" about several different
// facts, and only one of them is the offering. The three wrong ones, each from
// a named filing in that run:
//
//   OUTSTANDING   "... shares of common stock outstanding after this offering"
//                 ADARx: 88,250,216 -- the post-offering share total.
//   RESALE        CYABRA: "by the selling shareholders ... of up to 21,645,176
//                 shares"; Aura: "We are registering the offer and sale from
//                 time to time of up to 143,277,908 shares". A resale
//                 registration is not an offering by the issuer at all.
//   WARRANTS      "issuable upon exercise of ... warrants to purchase up to
//                 4,308,540 shares".
//
// sharesOffered feeds dealSize, which the page renders, so each of those was a
// confident wrong figure -- Aptevo's resale count against a mis-parsed price
// produced a $2.76 BILLION deal size for a microcap.
//
// ── SO: ANCHOR ON THE OFFERING, THEN REFUSE BAD CONTEXT ───────────────────
// Every pattern below is traceable to a real cover in that run. The first
// candidate set (offering-verb only) matched 7 of 94 and was rejected as too
// narrow; these five match 19, of which the disqualifier refuses one.
//
// THE TRADE IS DELIBERATE AND IT IS THE PROJECT'S OWN RULE: coverage falls from
// 38 to ~18, correctness rises from 29% to ~100%. NULL BEATS A GUESS. And the
// cost of a null is a column, not a row -- hasTerms() in ipoSecSource drops a
// listing only when the price is ALSO absent.
const SHARE_COUNT_PATTERNS = [
  // "We are offering 10,000,000 shares" / "we are offering 5,000,000 ADSs"
  //   LiPower F-1/A: "Shares Offered by the Issuer We are offering 5,000,000 shares"
  /\b(?:we|the\s+company|the\s+issuer)\s+(?:are|is)\s+offering\s+(?:an\s+aggregate\s+of\s+)?([\d,]{5,})\s+(?:shares|ADSs|American\s+Depositary\s+Shares|units|Units)/i,
  // THE OFFERING summary table: "Shares Offered by the Issuer  5,000,000"
  /(?:shares|ADSs|units)\s+offered\s+(?:by\s+(?:the\s+)?(?:issuer|us|the\s+company)|hereby)[^.]{0,90}?([\d,]{5,})/i,
  // "This is the initial public offering of 5,000,000 shares"
  /(?:initial\s+public\s+offering|this\s+offering)\s+of\s+(?:an\s+aggregate\s+of\s+)?([\d,]{5,})\s+(?:shares|ADSs|units|Units)/i,
  //   Advance JV 424B4: "We have determined the offering price of the 2,500,000 shares"
  /offering\s+price\s+of\s+the\s+([\d,]{5,})\s+(?:shares|ADSs|units|Units)/i,
  //   Lannister F-1/A cover header: "$15,000,000 Units 3,000,000 Units"
  /\$[\d,]{6,}\s+Units\s+([\d,]{5,})\s+Units/i,
];

/**
 * Sentences whose number is not an offering size, however well anchored.
 *
 * READ IN BOTH DIRECTIONS around the match, and that is load-bearing:
 * "resale" and "selling stockholders" sit BEFORE the count while "outstanding"
 * comes after it, so a trailing-only window catches half of them and reports a
 * clean result.
 */
const DISQUALIFYING_CONTEXT =
  /outstanding|resale|selling\s+(?:share|stock)holder|issuable\s+upon|from\s+time\s+to\s+time|registering/i;
const CONTEXT_BEFORE = 180;
const CONTEXT_AFTER = 160;

function parseSharesOffered(cover: string): number | null {
  for (const re of SHARE_COUNT_PATTERNS) {
    const m = re.exec(cover);
    if (!m || m.index === undefined) continue;
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n) || n <= 0) continue;
    // Where the NUMBER sits, not where the pattern started -- the offering-table
    // pattern can span 90 characters before reaching its digits.
    const at = m.index + m[0].lastIndexOf(m[1]);
    const context = cover.slice(Math.max(0, at - CONTEXT_BEFORE), at + CONTEXT_AFTER);
    // CONTINUE RATHER THAN RETURN NULL. One anchor landing in a resale clause
    // does not mean the cover has no offering sentence; a later pattern may
    // find it. Every value that survives has been through this test.
    if (DISQUALIFYING_CONTEXT.test(context)) continue;
    return n;
  }
  return null;
}

/**
 * Parse terms from a stripped cover.
 *
 * PURE. Given the same text and SIC it returns the same answer, which is what
 * lets scripts/check-ipo-cover-terms.mjs hold it to the cases that were
 * measured rather than a runner having to re-measure them.
 */
export function parseCoverTerms(text: string, sic: string | null): IpoCoverTerms {
  const cover = text.slice(0, COVER_CHARS);
  // SIC 6770 is authoritative; the body phrases are the fallback for a filer
  // whose submissions read failed. Two of the three, not one -- "business
  // combination" alone appears in plenty of operating-company risk factors.
  const isSpac = sic === "6770" || SPAC_BODY.filter((re) => re.test(cover)).length >= 2;

  let low: number | null = null;
  let high: number | null = null;
  for (const re of RANGE_PHRASES) {
    const m = cover.match(re);
    if (m) {
      const lo = Number(m[1]);
      const hi = Number(m[2]);
      if (plausible(lo) && plausible(hi) && lo <= hi && hi <= lo * RATIO_MAX) {
        low = lo;
        high = hi;
      }
      // BREAK EITHER WAY. The phrases are ordered most-specific first, so a
      // match that failed the plausibility test means this cover's price
      // sentence was found and rejected -- trying a looser pattern next would
      // be reaching for a worse answer to the same question.
      break;
    }
  }

  // A SPAC unit is fixed at $10.00 and has no range. The $11.50 sitting nearby
  // is the WARRANT EXERCISE PRICE and was 3 of the first parser's 8 wrong
  // answers.
  if (low === null && isSpac && SPAC_UNIT.test(cover)) {
    low = 10.0;
    high = 10.0;
  }

  if (low === null) {
    for (const re of FINAL_PHRASES) {
      const m = cover.match(re);
      if (m) {
        const n = Number(m[1]);
        if (plausible(n)) {
          low = n;
          high = n;
        }
        break;
      }
    }
  }

  const shares = parseSharesOffered(cover);

  return {
    priceRangeLow: low,
    priceRangeHigh: high,
    sharesOffered: shares,
    // Longest spellings first: "Nasdaq Global Select Market" must not be
    // matched as the bare "Nasdaq" that follows it in the alternation.
    exchange:
      cover.match(
        /(New York Stock Exchange|NYSE American|Nasdaq Global Select Market|Nasdaq Global Market|Nasdaq Capital Market|NYSE|Nasdaq)/i
      )?.[1] ?? null,
    // A PROPOSED symbol, and never evidence of trading -- see the note in
    // ipoExclusions.ts about submissions.json's `tickers` array, which carries
    // the same claim and excluded two genuine IPOs when it was trusted.
    proposedSymbol: cover.match(/(?:symbol|ticker)\s*["'"]?\s*:?\s*["'"]?\s*([A-Z]{1,5})\b/)?.[1] ?? null,
  };
}

/**
 * Which forms carry terms worth parsing a cover for.
 *
 * 8-A12B, RW and AW are collected by the ingest because they decide MEMBERSHIP,
 * but none of them carries a price -- fetching their covers would be pure spend.
 */
export const TERMS_BEARING_FORM = /^(424B[14]|S-1\/A|F-1\/A)$/;
