// The /stock/[symbol] "About" block, composed from free sources.
//
// ── WHAT THIS REPLACED ────────────────────────────────────────────────────
// fetchCompanyProfile in app/stock/[symbol]/page.tsx read FMP's stable/profile
// for every row in the block. Brief 2026-09-22 PR 2 moves each row to a source
// that survives the FMP exit:
//
//   Heading name    Nasdaq Trader directory → committed name snapshot → the
//                   filer's own entity name from the stored SEC set
//   Sector/Industry resolveProfile (FMP cache → static snapshot → SIC leg)
//   Market cap      cover-page shares × the page's own price (secValuation)
//   52-week range   high/low of the last 252 daily bars the page already loads
//   Exchange        SEC's ticker file (data/sec/company-tickers.json)
//   Country         SEC submissions business address (data/sec/registrants.json)
//   Description     the company's own annual report (10-K Item 1 / 20-F Item
//                   4.B), committed as data/sec/descriptions.json — PR 3 (#518);
//                   none means no paragraph, never an FMP fallback
//
// IPO date and Website are hidden (HIDDEN_PROFILE_ROWS in CompanyProfile.tsx):
// no free source for the first, and the second is blank on all 2,609 SEC
// registrant records (sec-registrants run 35773028028).
//
// PURE where it can be. `composeCompanyProfile` takes every input as an
// argument so the check suite can drive it with fixtures; the lookups below it
// read only committed files.
import registrantsFile from "@/data/sec/registrants.json";
import locationFile from "@/data/sec/edgar-location-codes.json";
import { symbolSpellings } from "@/lib/symbolSpellings.mjs";
import type { CompanyProfile, ProfileSource } from "@/app/components/CompanyProfile";
import type { ValuationInputs } from "./secValuation";
import { marketCap } from "./secValuation";
import { loadTickerMap } from "./secTickerMap";
import type { ResolvedProfile } from "./staticProfile";
import type { FilingDescription } from "./filingDescription";
import { descriptionAttribution, MONTHS } from "./filingDescription";

export type Registrant = {
  cik: string;
  sic: string | null;
  sicDescription: string | null;
  stateOrCountry: string | null;
  stateOfIncorporation: string | null;
  website: string | null;
  fiscalYearEnd: string | null;
  entityType: string | null;
  annualForm: string | null;
};

type RegistrantsFile = { asOf: string; rows: Record<string, Registrant> };
type LocationFile = { codes: Record<string, { name: string; iso: string | null; region: string | null }> };

const REGISTRANTS = registrantsFile as unknown as RegistrantsFile;
const LOCATIONS = (locationFile as unknown as LocationFile).codes;

export const REGISTRANTS_AS_OF: string = REGISTRANTS.asOf;

/** The committed registrant row for a symbol, trying its other spellings. */
export function registrantFor(symbol: string): Registrant | null {
  for (const s of symbolSpellings(symbol)) {
    const row = REGISTRANTS.rows[s];
    if (row) return row;
  }
  return null;
}

/**
 * Country, from the HEADQUARTERS address and not the state of incorporation.
 *
 * DEPARTURE FROM THE LITERAL FMP FIELD, flagged in the brief for the owner: a
 * Delaware-incorporated company headquartered in Israel reads "Israel" here,
 * which is what FMP showed and what a reader means by country. Incorporation
 * is the fallback only when no business address was filed.
 *
 * ISO alpha-2, matching FMP's "US"/"FR" style, where SEC's name matched the
 * runtime's ISO table; otherwise SEC's own country name. A code with no row in
 * the committed table yields null — never a guess.
 */
export function countryFor(reg: Registrant | null): string | null {
  const code = reg?.stateOrCountry ?? reg?.stateOfIncorporation ?? null;
  if (!code) return null;
  const loc = LOCATIONS[code.toUpperCase()];
  if (!loc) return null;
  return loc.iso ?? loc.name;
}

/**
 * Exchange from SEC's ticker file, uppercased to match what the page showed
 * ("NASDAQ", "NYSE"). SEC records OTC and CBOE too, and a blank for some
 * filers — a blank hides the row rather than printing a placeholder.
 */
export function exchangeFor(symbol: string): string | null {
  const map = loadTickerMap().map;
  for (const s of symbolSpellings(symbol)) {
    const e = map.get(s);
    if (e) return e.exchange ? e.exchange.toUpperCase() : null;
  }
  return null;
}

/**
 * The 52-week range from bars the page already loaded. 252 trading days is a
 * year; fewer bars than that is a range over what exists, which for a recent
 * listing is still the true range since listing — but under ~a month it is not
 * a meaningful "52-week" figure and the row hides.
 */
export const RANGE_BARS = 252;
export const RANGE_MIN_BARS = 20;
export function fiftyTwoWeekRange(
  points: { close: number; high?: number; low?: number }[]
): { low: number; high: number } | null {
  const window = points.slice(-RANGE_BARS).filter((p) => Number.isFinite(p.close));
  if (window.length < RANGE_MIN_BARS) return null;
  let low = Infinity;
  let high = -Infinity;
  for (const p of window) {
    const lo = Number.isFinite(p.low) ? (p.low as number) : p.close;
    const hi = Number.isFinite(p.high) ? (p.high as number) : p.close;
    if (lo < low) low = lo;
    if (hi > high) high = hi;
  }
  return Number.isFinite(low) && Number.isFinite(high) ? { low, high } : null;
}

export type ComposeInputs = {
  symbol: string;
  /** Nasdaq Trader live directory, "" on a miss. */
  directoryName: string;
  /** Committed Nasdaq Trader snapshot, "" on a miss. */
  snapshotName: string;
  /** The stored SEC set's entityName, or null. */
  entityName: string | null;
  /**
   * The company's own description from its latest annual report
   * (lib/server/filingDescription.ts), or null — which renders no paragraph.
   * Replaced FMP's description, the last FMP field on the page (PR 3, #518).
   */
  filingDescription: FilingDescription | null;
  taxonomy: ResolvedProfile;
  /**
   * When the answering taxonomy leg's classification was captured
   * (classificationAsOf in staticProfile.ts), YYYY-MM-DD, or null.
   */
  classificationAsOf: string | null;
  valuation: ValuationInputs | null;
  price: number | null;
  points: { close: number; high?: number; low?: number }[];
  exchange: string | null;
  registrant: Registrant | null;
};

/** "2026-09-13" → "13 Sep 2026". Parsed by hand: no time zone can move the day. */
export function dayMonthYear(isoDate: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate ?? ""));
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : null;
}

/**
 * The profile the component renders, with where each row came from.
 *
 * MARKET CAP ON A REFUSAL IS NULL, so the row hides. The earnings page prints
 * refusals in words; the stat card has no room for "the ADS ratio makes the
 * share count incomparable", and a stat grid of refusals reads as broken
 * (brief §2.1).
 */
export function composeCompanyProfile(i: ComposeInputs): CompanyProfile {
  const cap = i.valuation ? marketCap(i.valuation, i.price) : null;
  const range = fiftyTwoWeekRange(i.points);
  const name = i.directoryName || i.snapshotName || i.entityName || null;
  const country = countryFor(i.registrant);

  const sources: ProfileSource[] = [];
  const add = (field: string, source: string) => sources.push({ field, source });
  if (name) add("Name", i.directoryName || i.snapshotName ? "Nasdaq Trader symbol directory" : "SEC EDGAR");
  if (i.taxonomy.sector || i.taxonomy.industry) {
    // ONE WORDING WHICHEVER LEG ANSWERED — the FMP cache, the 2026-09-13
    // snapshot, or the SIC leg — dated by that leg's own capture date
    // (classificationAsOf). Facts, not prose; the owner asked for no FMP
    // attribution but the description's, so it is credited by its date, in
    // the owner's wording. No date means no credit, never a borrowed date.
    const asOf = dayMonthYear(i.classificationAsOf);
    if (asOf) add("Sector and industry", `classification as of ${asOf}`);
  }
  if (cap?.ok) add("Market cap", "shares from SEC EDGAR, price from market data");
  if (range) add("52-week range", "daily price history");
  if (i.exchange) add("Exchange", "SEC EDGAR");
  if (country) add("Country", "SEC EDGAR");
  // THE DESCRIPTION CARRIES ITS OWN ATTRIBUTION, under the paragraph, in the
  // owner's wording ("From Apple Inc.'s 10-K, filed Oct 2025"), so it is not
  // repeated in the per-row source line.

  return {
    companyName: name,
    description: i.filingDescription?.text ?? null,
    descriptionAttribution: i.filingDescription ? descriptionAttribution(name, i.filingDescription) : null,
    sector: i.taxonomy.sector,
    industry: i.taxonomy.industry,
    ceo: null,
    website: i.registrant?.website ?? null,
    employees: null,
    exchange: i.exchange,
    country,
    ipoDate: null,
    isin: null,
    cusip: null,
    marketCap: cap?.ok ? cap.val : null,
    beta: null,
    price: i.price,
    rangeLow: range?.low ?? null,
    rangeHigh: range?.high ?? null,
    lastDividend: null,
    currency: "USD",
    sources,
  };
}
