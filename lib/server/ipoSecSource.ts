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
  indexByCik,
  isAlreadyListed,
  isFundEntity,
  normaliseCik,
  warnIfEntityFilterMatchedNothing,
} from "./ipoExclusions";
import { resolveTickerMap } from "./secTickerMap";
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

/**
 * Split one window of filer records into the page's two tables.
 *
 * Pure, and deliberately so: every exclusion above is a rule that has already
 * been wrong once, and a pure function is one a test can hold to a fixture.
 */
export async function buildSecIpoTables(
  records: IpoFilerRecord[],
  windowDays: number,
  now = new Date()
): Promise<SecIpoTables> {
  const { map: tickerMap } = await resolveTickerMap();
  // Inverted once here, because the file is symbol-keyed and every lookup below
  // is by CIK. See indexByCik's header for why a direct map.has(cik) compiles
  // and silently matches nothing.
  const listedByCik = indexByCik(tickerMap);

  const upcoming: ConfirmedIpo[] = [];
  const recent: ConfirmedIpo[] = [];
  let entityMatches = 0;
  let entityCandidates = 0;

  const recentCutoff = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);

  for (const record of records) {
    const final = lastOf(record, FINAL_PROSPECTUS);

    if (final) {
      // ── LOWER TABLE. Priced and listed.
      if (final.date < recentCutoff) continue;
      if (!hasTerms(record.terms)) continue;
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
    if (!hasTerms(record.terms)) continue;

    // (a) + (c): already listed on a major exchange, OR quoted on OTC and
    // uplisting. One membership test does both -- the map carries 2,500 OTC rows.
    if (isAlreadyListed(record.cik, listedByCik)) continue;

    // (b) ETF / commodity trust. Counted whether or not it matches, because the
    // count is what the zero-match warning below is computed from.
    entityCandidates += 1;
    if (isFundEntity(record.sic, record.company)) {
      entityMatches += 1;
      continue;
    }

    if (isWithdrawn(record, amendment.date)) continue;
    if (isStale(amendment.date, now)) continue;

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

  return { upcoming, recent };
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
