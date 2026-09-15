// Who does NOT belong in the Upcoming IPOs table.
//
// The upper table shows companies that have filed to list and set terms but have
// not priced. Three quite different things look exactly like that from the filing
// index alone, and each needs its own rule. Measured over 2026-05-17..2026-09-14
// (relay run 34894303457), 228 companies matched "amendment, no 424B" and only
// 53 were actually upcoming IPOs.
//
//   (a) ALREADY LISTED, filing a resale or follow-on -- 172 of 228, by far the
//       largest class. An issuer already trading is not an upcoming IPO.
//   (b) ETF / commodity trust -- files S-1 and 8-A12B exactly like an operating
//       company does. "T. Rowe Price Active Crypto ETF" under Upcoming IPOs is
//       wrong in a way readers notice.
//   (c) UPLISTING FROM OTC -- an OTC-quoted issuer moving to Nasdaq/NYSE. NOT a
//       first sale to the public. **Needs no rule of its own**: see below.
//
// RW/AW withdrawal and the staleness cap live in ipoCalendar.ts alongside the
// constant they key off; this file is only about what a company IS.
import type { TickerEntry } from "./secTickerMap";
// How stale a "terms set, not yet priced" filing may be before the upper table
// drops it. OWNER DECISION, 2026-09-14.
//
// WHY A CAP IS NEEDED AT ALL. A shelved deal has exactly the same shape as a live
// one -- terms filed, no final prospectus -- so without this it sits under
// "Upcoming IPOs" forever, and the page states something false about a company
// for as long as the page exists. The formal withdrawal form (RW/AW) does NOT
// solve it: measured over 2026-05-17..2026-09-14 it caught 3 of 56. Issuers that
// lose their window overwhelmingly just stop filing. THE CAP IS THE PRIMARY
// MECHANISM AND RW/AW IS THE EDGE CASE, not the other way round.
//
// WHY 45 AND NOT THE MEDIAN. Measured amendment -> final prospectus was a median
// of 7 days and an upper bound of 14. This is keyed off the UPPER BOUND, not the
// median: 45 is a bit over 3x the longest gap actually observed, so a live deal
// is very unlikely to be cut. Keying off the median would have cut live deals.
//
// The population it was chosen against (53 companies, after removing 172
// already-listed issuers filing resales and 3 withdrawals):
//
//     <=7d    1    2%        <=45d   +7   40%   <<< the cap
//     <=14d   5   11%        <=60d  +10   58%
//     <=21d   3   17%        <=90d  +11   79%
//     <=30d   5   26%       <=120d  +11  100%
//
// THAT 100% AT 120 DAYS IS AN ARTEFACT. The measurement window was 120 days, so
// nothing older was visible -- the real tail is longer. Do not read the table as
// evidence that no deal goes quiet for more than four months.
export const IPO_TERMS_MAX_AGE_DAYS = 45;


// ── (a) and (c): one join does both ────────────────────────────────────────
//
// WHY (c) NEEDS NO CODE. company_tickers_exchange.json was measured on
// 2026-09-14 to carry 2,500 rows labelled `OTC`, alongside 4,367 Nasdaq, 3,299
// NYSE and 44 CBOE. So an OTC-quoted issuer is IN the map, and the same
// membership test that catches (a) catches (c). Eloxx Pharmaceuticals (CIK
// 1035354, ELOX) -- the uplisting that prompted the question -- is present.
//
// ── THE WRONG SIGNAL, WRITTEN DOWN BECAUSE IT LOOKS RIGHT ──────────────────
// data.sec.gov/submissions/CIK*.json also has a `tickers` array, and reaching
// for it here is the mistake waiting to be made. THAT FIELD IS THE PROPOSED
// SYMBOL FROM THE REGISTRATION STATEMENT, NOT EVIDENCE OF TRADING.
//
// Measured: Web3Labs Global (CIK 2091521) carries `MDAT` and CopperTech Metals
// (CIK 2093018) carries `CUX` on their submissions records, and BOTH ARE GENUINE
// FIRST-TIME IPOs -- covers state no public market exists, all shares newly
// issued, no selling stockholders, oldest filing on each CIK a confidential DRS,
// and neither has ever filed a 424B4 or an 8-A12B. Excluding them on the
// submissions ticker would have deleted two real IPOs from the page. The ticker
// map was RIGHT to omit them.
//
// THE RELIABLE PAIR IS: membership in company_tickers_exchange.json, AND an
// 8-A12B on the filing history. A proposed symbol is an intention; those two
// together are the event.
// ── THE MAP IS KEYED BY SYMBOL, NOT BY CIK ─────────────────────────────────
//
// company_tickers_exchange.json is symbol -> { cik, exchange }, so the CIK is in
// the VALUE. This has to be inverted before it can answer "is this filer
// listed?", and getting that wrong is invisible:
//
//   tickerMap.has(cik)   // compiles, and is ALWAYS FALSE
//
// A Map<string, …> accepts any string key, so the type system cannot object. The
// filter would then exclude nobody, and all 172 already-listed issuers in a
// 120-day window would pour into the Upcoming IPOs table looking like a busy
// market. (This exact line was written and caught only because an adjacent
// property access failed to compile -- the join itself type-checked fine.)
//
// One inversion per build, not per row.
export function indexByCik(
  tickerMap: Map<string, TickerEntry>
): Map<string, { symbol: string; exchange: string | null }> {
  const byCik = new Map<string, { symbol: string; exchange: string | null }>();
  for (const [symbol, entry] of tickerMap) {
    if (!entry?.cik) continue;
    // Keep the FIRST symbol seen for a CIK. Dual-class issuers appear several
    // times (one row per share class); any of them proves the filer is listed,
    // which is all this index is asked for.
    const key = normaliseCik(entry.cik);
    if (!byCik.has(key)) byCik.set(key, { symbol, exchange: entry.exchange });
  }
  return byCik;
}

export function isAlreadyListed(
  cik: string,
  byCik: Map<string, { symbol: string; exchange: string | null }>
): boolean {
  // Join on CIK, NEVER on name. `ITG, Inc./DE/` (CIK 2110117) is a 2026
  // registrant and is NOT Investment Technology Group (CIK 920424, acquired by
  // Virtu in 2019) -- a name join merges two unrelated companies.
  //
  // Note also that filing history is NOT a listing test: DEEP FISSION's CIK
  // 1918102 was formerly the shell Surfside Acquisition and filed 10-Qs through
  // 2023, yet its 2026 offering is a genuine underwritten IPO. Membership is the
  // test; history is not.
  return byCik.has(normaliseCik(cik));
}

export function normaliseCik(cik: string): string {
  // The map keys on the unpadded number; index rows and submissions pad to 10.
  return String(Number(cik));
}

// ── (b) ETF / commodity trust ──────────────────────────────────────────────
//
// A CONJUNCTION, AND DELIBERATELY NOT EITHER HALF ALONE.
//
// SIC alone is too broad: 6199 "Finance Services" is where the crypto ETFs sit,
// but legitimate fintech IPOs live there too, and a blanket 6199 exclusion would
// quietly delete them.
//
// Name alone is too broad in the other direction: a REIT called "X Realty Trust"
// matches /Trust/ and is a perfectly real IPO. (It is also SIC 6798, so the
// conjunction lets it through from both sides.)
//
// Together they are narrow: a 6199 filer whose name announces it is a fund.
const ENTITY_EXCLUDED_SIC = new Set([
  "6199", // Finance Services -- where the crypto ETFs and trusts actually sit
  "6726", // Investment offices NEC
  "6221", // Commodity contracts
]);

// NEVER ADD 6770 TO THE SET ABOVE.
//
// 6770 is "Blank Checks", i.e. SPACs, AND A SPAC IPO IS A REAL IPO. Measured in
// the same window: 7 of the 53 genuine upcoming IPOs were 6770 filers and 5 of
// those survive the staleness cap. Excluding 6770 would delete roughly an eighth
// of the page's upper table at a stroke, and more in a SPAC-heavy quarter --
// Phase 0's own sample was 8 SPACs in 20 amendments.
//
// This is a named constant rather than a comment because the failure mode is a
// future reader tidying three finance SIC codes into "the finance SIC codes".
// scripts/check-ipo-exclusions.mjs asserts the two sets stay disjoint.
export const NEVER_EXCLUDED_SIC = new Set(["6770"]);

const FUND_NAME = /\b(ETF|Trust|Fund|Shares|Index)\b/i;

export function isFundEntity(sic: string | null, company: string): boolean {
  if (!sic) return false;
  if (NEVER_EXCLUDED_SIC.has(sic)) return false; // belt and braces; see above
  return ENTITY_EXCLUDED_SIC.has(sic) && FUND_NAME.test(company);
}

// ── The instrumentation, which matters more than the codes ─────────────────
//
// THIS RULE IS SIZED ON n=2. It is a heuristic to be MONITORED, not trusted.
//
// The two entities it was built against are `Canary Staked INJ ETF` and
// `Bitwise NEAR ETF`, both SIC 6199. That is a thin basis for a filter, and the
// filter's failure mode is silent: a rule that matches nothing looks exactly
// like a rule that had nothing to match.
//
// THIS HAS ALREADY HAPPENED ONCE. The first version of this rule used SIC 6726
// and 6221 -- reasonable-looking codes that matched ZERO rows in a 120-day
// window, because the real filers are 6199. Had it shipped, it would have
// excluded nothing, left both ETFs sitting in Upcoming IPOs, and looked correct
// to anyone reading the code. It must not be possible for that to happen twice.
//
// So: crypto ETF and trust S-1 filings are near-continuous in this market. Zero
// matches across a full 90-day window means THE RULE BROKE -- a SIC code moved,
// a naming convention shifted, or the field stopped being populated -- not that
// the market went quiet. Same reasoning and same shape as
// warnIfImplausiblyEmpty() in feedCache.ts.
export function warnIfEntityFilterMatchedNothing(
  matched: number,
  candidatesConsidered: number,
  windowDays: number
): void {
  if (windowDays < 90) return; // a short window legitimately sees none
  if (candidatesConsidered === 0) return; // nothing to filter; not a signal
  if (matched > 0) return;

  console.warn(
    `[ipo:entity-filter] matched 0 of ${candidatesConsidered} candidates across ` +
      `${windowDays} days. Crypto ETF/trust S-1 filings are near-continuous, so ` +
      `zero almost certainly means THE RULE BROKE, not that none were filed. ` +
      `Check whether the SIC codes still hold (this rule was sized on n=2, both ` +
      `SIC 6199) before assuming a quiet market. The previous version of this ` +
      `rule used 6726/6221 and matched nothing at all.`
  );
}
