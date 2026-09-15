// The SEC branch of the IPO calendar: who is listing, from filings alone.
//
// Public domain, $0, no terms problem, and it covers BOTH exchanges -- unlike
// Nasdaq's own feed, which was Nasdaq-only and is prohibited anyway
// (claude/nasdaq-licence-verdict-2026-09-14.md).
//
// ── WHAT THIS CANNOT DO, STATED FIRST ──────────────────────────────────────
// THERE IS NO EXPECTED LISTING DATE IN ANY FILING. Measured: the amendment that
// carries terms lands a median of 7 days before pricing and carries NO date; the
// final prospectus carries a date but lands a median of 2 days before trading
// (2 of 8 explicit, 3 of 8 derivable from the prospectus date). The date is an
// underwriter convention, not a filed fact.
//
// So the upper table is UNDATED BY CONSTRUCTION and its date column shows when
// terms were set, not when the company lists. That is the whole design: 32.4% of
// this page's named search impressions ask WHO is going public, not WHEN
// (claude/ipo-query-intent-measured-2026-09-14.md), and who is answerable.
//
// ── THE TWO TABLES ARE ONE DATASET ─────────────────────────────────────────
// A row's table is decided by its own filing history, not by a clock:
//
//   upper  terms filed (S-1/A, F-1/A), NO final prospectus yet
//   lower  a final prospectus (424B4, 424B1) inside the recent window
//
// A company moves from upper to lower WHEN ITS 424B APPEARS -- the event that
// actually changed. No second fetch, and no row in the wrong place on a day the
// data did not refresh.
import {
  IPO_TERMS_MAX_AGE_DAYS,
  isAlreadyListed,
  isFundEntity,
  normaliseCik,
  warnIfEntityFilterMatchedNothing,
} from "./ipoExclusions";
// TYPE-ONLY, and that matters: ipoCalendar imports buildSecIpoTables from this
// file, so a value import here would close a runtime require cycle. A type import
// is erased at compile time and cannot.
import type { ConfirmedIpo } from "./ipoCalendar";

/** One filer's filings inside the window, as the seeding step stores them. */
export type IpoFilerRecord = {
  cik: string;
  company: string;
  /** SIC from submissions.json. PARSED, never paraphrased -- see below. */
  sic: string | null;
  filings: { form: string; date: string }[];
  /** Cover-page terms, where the parser was confident. Null beats a guess. */
  terms: {
    priceRangeLow: number | null;
    priceRangeHigh: number | null;
    sharesOffered: number | null;
    exchange: string | null;
    proposedSymbol: string | null;
  } | null;
};

const AMENDMENT = /^(S-1\/A|F-1\/A)$/;
const FINAL_PROSPECTUS = /^424B[14]$/;
const WITHDRAWAL = /^(RW|AW)$/;
const EXCHANGE_REGISTRATION = /^8-A12B$/;

const lastOf = (r: IpoFilerRecord, re: RegExp) =>
  [...r.filings].filter((f) => re.test(f.form)).sort((a, b) => a.date.localeCompare(b.date)).pop() ?? null;

const daysBetween = (fromIso: string, to: Date) =>
  Math.round((to.getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / 86400000);

/**
 * Has this registration been called off?
 *
 * A WITHDRAWAL ONLY WITHDRAWS WHAT CAME BEFORE IT. Measured: four RW/AW filings
 * in the sample were dated BEFORE the amendment they would have been credited
 * against -- Kepler amended 2026-08-24 carrying an RW of 2026-05-19, Akari
 * amended 2026-06-26 carrying an RW of 2026-05-21. Those withdraw an EARLIER
 * registration while the live deal stands, so "has a withdrawal anywhere" would
 * have deleted live deals. The comparison is against the amendment's date.
 */
function isWithdrawn(record: IpoFilerRecord, amendmentDate: string): boolean {
  const w = lastOf(record, WITHDRAWAL);
  return Boolean(w && w.date >= amendmentDate);
}

/**
 * Terms set long enough ago that the deal is almost certainly shelved.
 *
 * THIS IS THE PRIMARY STALENESS MECHANISM, not a backstop. RW/AW caught 3 of 56
 * in the measured window -- about 5%. Issuers that lose their window
 * overwhelmingly just stop filing and never withdraw formally, so without the cap
 * ~95% of dead deals would sit under "Upcoming IPOs" indefinitely.
 */
function isStale(amendmentDate: string, now: Date): boolean {
  return daysBetween(amendmentDate, now) > IPO_TERMS_MAX_AGE_DAYS;
}

/**
 * A row with no deal terms at all is a bare registration, and the page's promise
 * -- in both tables -- is that a listing has real terms attached. Carried over
 * from the FMP parser unchanged in effect, changed in meaning: there it enforced
 * "priced", here it enforces "terms set".
 */
function hasTerms(t: IpoFilerRecord["terms"]): boolean {
  if (!t) return false;
  return (
    t.priceRangeLow !== null || t.priceRangeHigh !== null || t.sharesOffered !== null
  );
}

function toConfirmedIpo(
  record: IpoFilerRecord,
  date: string,
  symbol: string | null,
  exchange: string | null
): ConfirmedIpo {
  const t = record.terms;
  const low = t?.priceRangeLow ?? null;
  const high = t?.priceRangeHigh ?? null;
  const sharesOffered = t?.sharesOffered ?? null;
  return {
    // Identity is the CIK. The upper table's rows have no ticker.
    cik: normaliseCik(record.cik),
    symbol,
    company: record.company,
    date,
    exchange,
    priceRangeLow: low,
    priceRangeHigh: high,
    sharesOffered,
    // Same midpoint rule as the FMP branch, verified there against real rows.
    dealSize:
      sharesOffered !== null && low !== null && high !== null
        ? sharesOffered * ((low + high) / 2)
        : null,
    // NO FREE SOURCE CARRIES MARKET CAP -- not SEC (not a filed field), not
    // Nasdaq (absent from every bucket). The column is hidden rather than
    // populated with a guess.
    marketCap: null,
  };
}

export type SecIpoTables = { upcoming: ConfirmedIpo[]; recent: ConfirmedIpo[] };

/** Row counts at every stage. The seed prints this; nothing else reads it. */
export type SecIpoFunnel = {
  records: number;
  upperCandidates: number;
  lowerCandidates: number;
  droppedFollowOn: number;
  droppedNoTermsLower: number;
  droppedNoTerms: number;
  droppedAlreadyListed: number;
  droppedEntity: number;
  droppedWithdrawn: number;
  droppedStale: number;
  upcoming: number;
  recent: number;
};

/** CIK -> the listed symbol and exchange. Built by indexByCik(). */
export type ListedByCik = Map<string, { symbol: string; exchange: string | null }>;

/**
 * Split one window of filer records into the page's two tables.
 *
 * PURE AND SYNCHRONOUS, AND THAT IS LOAD-BEARING, NOT STYLE. This function is
 * the single classification path: the render calls it, and so does the seeding
 * script on a runner. If it resolved the ticker map itself it would drag in
 * @upstash/redis, and the relay's read-only job deliberately runs NO `npm ci` --
 * so the seed would have had to re-implement these rules, and seeded rows would
 * disagree with accumulated rows about what counts as an IPO. Both sets would
 * look plausible.
 *
 * So the caller resolves the map and passes the index in. Node's native type
 * stripping is what lets a plain .mjs on the runner import this file directly.
 */
export function buildSecIpoTables(
  records: IpoFilerRecord[],
  listedByCik: ListedByCik,
  windowDays: number,
  now = new Date()
): SecIpoTables & { funnel: SecIpoFunnel } {

  const upcoming: ConfirmedIpo[] = [];
  const recent: ConfirmedIpo[] = [];
  let entityMatches = 0;
  let entityCandidates = 0;
  // EVERY STAGE COUNTED, because "53 rows" on its own cannot be argued with and
  // the stages are where the rules that have been wrong twice actually live.
  const funnel: SecIpoFunnel = {
    records: records.length,
    upperCandidates: 0,
    lowerCandidates: 0,
    droppedFollowOn: 0,
    droppedNoTermsLower: 0,
    droppedNoTerms: 0,
    droppedAlreadyListed: 0,
    droppedEntity: 0,
    droppedWithdrawn: 0,
    droppedStale: 0,
    upcoming: 0,
    recent: 0,
  };

  const recentCutoff = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);

  for (const record of records) {
    const final = lastOf(record, FINAL_PROSPECTUS);

    if (final) {
      // ── LOWER TABLE. Priced and listed.
      if (final.date < recentCutoff) continue;
      funnel.lowerCandidates += 1;

      // A 424B FROM AN ALREADY-LISTED COMPANY IS A FOLLOW-ON, NOT AN IPO, and
      // the first seed run proved it: Aveanna Healthcare (AVAH, public since
      // 2021), ABVC Biopharma, Laser Photonics (LASE, 2022), Aptevo (APVO, 2016)
      // and Check-Cap all rendered under "Recent IPOs". Every one of them is a
      // seasoned issuer raising more money.
      //
      // THE TEST IS THE PAIR, NOT EITHER HALF. An 8-A12B is what registers a
      // class on an exchange for the first time, so it -- not the prospectus --
      // is the listing event. Membership in the ticker map alone cannot do it
      // (a company that IPO'd last week is in the map too, and belongs here);
      // the 8-A12B alone cannot do it either (ETFs and note programmes file
      // them). What identifies an IPO is the 8-A12B inside this window.
      if (!lastOf(record, EXCHANGE_REGISTRATION)) {
        funnel.droppedFollowOn += 1;
        continue;
      }

      if (!hasTerms(record.terms)) { funnel.droppedNoTermsLower += 1; continue; }
      // TICKER AND EXCHANGE COME FROM THE MAP, NOT THE COVER. Cover extraction
      // managed 5/8 on ticker; a company that has listed is in
      // company_tickers_exchange.json, which carries the exchange too. This is
      // the single biggest quality win available and it only works downwards --
      // a not-yet-listed company is not in the map, which is why the upper table
      // below still has to read the cover.
      const listed = listedByCik.get(normaliseCik(record.cik));
      recent.push(
        toConfirmedIpo(
          record,
          final.date,
          listed?.symbol ?? record.terms?.proposedSymbol ?? null,
          listed?.exchange ?? record.terms?.exchange ?? null
        )
      );
      continue;
    }

    // ── UPPER TABLE. Filed, terms set, not yet priced.
    const amendment = lastOf(record, AMENDMENT);
    if (!amendment) continue;
    funnel.upperCandidates += 1;

    // ── ORDER MATTERS, AND THE FIRST SEED RUN PROVED IT ────────────────────
    // These two ran AFTER the terms test and both reported 0 -- not because
    // they were broken, but because anything they would have caught had already
    // been dropped for having no parsed terms. A filter reporting zero because
    // something upstream ate its input is indistinguishable from a filter that
    // does not work, which is the trap this project has now hit four times
    // (claude/traps/a-filter-that-matches-nothing-looks-correct.md).
    //
    // Cheap, decisive exclusions first. Now their counts mean what they say,
    // and nothing pays to parse a cover for a row it is about to drop.

    // (a) + (c): already listed on a major exchange, OR quoted on OTC and
    // uplisting. One membership test does both -- the map carries 2,500 OTC rows.
    if (isAlreadyListed(record.cik, listedByCik)) { funnel.droppedAlreadyListed += 1; continue; }

    // (b) ETF / commodity trust. Counted whether or not it matches, because the
    // count is what the zero-match warning below is computed from.
    entityCandidates += 1;
    if (isFundEntity(record.sic, record.company)) {
      entityMatches += 1;
      funnel.droppedEntity += 1;
      continue;
    }

    if (!hasTerms(record.terms)) { funnel.droppedNoTerms += 1; continue; }

    if (isWithdrawn(record, amendment.date)) { funnel.droppedWithdrawn += 1; continue; }
    if (isStale(amendment.date, now)) { funnel.droppedStale += 1; continue; }

    upcoming.push(
      toConfirmedIpo(
        record,
        amendment.date,
        record.terms?.proposedSymbol ?? null,
        record.terms?.exchange ?? null
      )
    );
  }

  // A rule that matches nothing looks exactly like a rule with nothing to match.
  // The previous version of the entity filter (SIC 6726/6221) matched zero rows
  // in 120 days and would have shipped looking correct.
  warnIfEntityFilterMatchedNothing(entityMatches, entityCandidates, windowDays);

  // ── SORT: BOTH DESCENDING, FOR DIFFERENT REASONS ─────────────────────────
  // Do not collapse these into one shared comparator. They agree today by
  // coincidence of direction, not of meaning, and a future change to either
  // column's meaning should have to touch only its own line.
  //
  // UPPER: the date is the AMENDMENT date -- when terms were set, always in the
  // past. Descending puts the most recently amended first, i.e. the deal closest
  // to pricing. Ascending (which the FMP forward calendar correctly used, because
  // its date was a FUTURE listing date) would put the stalest filing at the top.
  upcoming.sort((a, b) => b.date.localeCompare(a.date));
  // LOWER: the date is the listing date. Most recently listed first, unchanged
  // from getRecentIpos()'s existing behaviour.
  recent.sort((a, b) => b.date.localeCompare(a.date));

  funnel.upcoming = upcoming.length;
  funnel.recent = recent.length;
  return { upcoming, recent, funnel };
}

/** Exported for the seeding step and for tests; not used by the render path. */
export const SEC_IPO_FORMS = [
  "S-1",
  "S-1/A",
  "F-1",
  "F-1/A",
  "424B4",
  "424B1",
  "8-A12B",
  "RW",
  "AW",
] as const;

export { AMENDMENT, FINAL_PROSPECTUS, WITHDRAWAL, EXCHANGE_REGISTRATION };
