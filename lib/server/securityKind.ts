// Does this security's economics match the issuer's financial statements?
//
// ── THE LIVE BUG ──────────────────────────────────────────────────────────
// A CIK identifies a FILER, not a security. Preferreds, baby bonds and
// warrants resolve to the parent's CIK, so extraction keyed on ticker stores
// the parent's financials under the derivative's symbol:
//
//   MER-PK -> CIK 0000070858 -> Bank of America
//
// /stock/MER-PK/earnings renders Bank of America's revenue, EPS, margins and
// cash flow. Complete, plausible, and entirely wrong. Sixteen other symbols
// share that one CIK. Measured over the committed map: 2,764 of 7,710
// exchange-listed symbols (35.8%) share a CIK with something.
//
// ── WHY NOT classifySecurityName, WHICH ALREADY EXISTS ────────────────────
// scripts/lib/symbol-spellings.mjs has a classifier, and reusing it here was
// the obvious move. MEASURED AGAINST THE REAL POPULATION IT IS THE WRONG
// TEST, and the failure is not subtle:
//
//   ET     "Energy Transfer LP Common Units"                  -> unit
//   MPLX   "MPLX LP Common Units Representing Limited ..."    -> unit
//   BEP    "Brookfield Renewable Partners L.P. ... Units"     -> unit
//   ASML   "ASML Holding N.V. - New York Registry Shares"     -> unknown
//   BN     "Brookfield Corporation Class A Limited Voting..." -> unknown
//
// All five are operating companies whose own filings describe exactly those
// securities. Excluding them would delete real companies from the site.
//
// That classifier answers "is this common stock?", for news-query
// suppression, where over-flagging costs a warning. THIS question is the
// brief's: "do the issuer's statements describe this security's economics?"
// An LP unit's do. A New York Registry Share's do. A note's do not.
//
// ── SO THE TEST IS POSITIVE, NOT RESIDUAL ─────────────────────────────────
// Exclusion requires a POSITIVE match on debt/preferred/warrant wording.
// Nothing is excluded for failing to look like common stock, which is what
// dropped ET and ASML. ADR wording is checked FIRST because an ADR prospectus
// line routinely contains "depositary shares" and "right to receive", and the
// ADR reading must win -- AMX's name contains "the right to receive twenty
// (20) Series B Shares" and it is not a rights issue.
//
// Measured over the 479 exchange-listed shared-CIK symbols carrying a
// Security Name: 75 excluded, 404 kept, and every named probe lands correctly
// (MER-PK, TBB, CTA-PA, EP-PC out; ET, MPLX, BEP, BIP, ASML, AEG, BN, KOF,
// AMX, BABA, BHP, MKC-V, BRK-A, GOOG, BAC in).
import { loadTickerMap } from "./secTickerMap";
import { snapshotCompanyName } from "./companyNameSnapshot";

/**
 * ADR/registry-share wording. CHECKED BEFORE EVERYTHING ELSE.
 *
 * These names quote the deposit agreement, so they carry the vocabulary of
 * every other category -- "Depositary Shares", "the right to receive", unit
 * compositions. An ADR of an operating company is that company for our
 * purposes: BABA, BHP and KOF all belong on the site.
 */
const ADR_WORDING =
  /american depositary|\bADRs?\b|\bADSs?\b|new york registry|registry shares/i;

/**
 * Debt. The MER-PK and TBB case, and the one with real users on it.
 * "Capital securities" and "trust preferred" are the bank-holding-company
 * spellings of the same instrument.
 */
const DEBT_WORDING =
  /\bnotes?\b|\bdebentures?\b|\bsubordinated\b|\bbonds?\b|\bcapital securities\b|\btrust preferred\b/i;

/**
 * Debt acronyms that carry no debt word. "ZONES" (zero-premium exchangeable
 * subordinated notes: CCZ, "Comcast Holdings ZONES") is Comcast's debt, not its
 * equity (Relay B, #552 COWORK #26). CASE-SENSITIVE on purpose: the acronym is
 * written in capitals, and "zones" in lower case is an ordinary word.
 */
const DEBT_ACRONYMS = /\bZONES\b/;

/** Preferred equity, including the depositary-share wrapper around it. */
const PREFERRED_WORDING = /\bpreferred\b|\bdepositary shares\b/i;

const WARRANT_WORDING = /\bwarrants?\b/i;

export type SecurityKind =
  /** The issuer's statements describe this security. Render it. */
  | "issuer-equity"
  /** Debt, preferred or a warrant of another issuer. Do NOT render. */
  | "derivative-of-issuer"
  /** No Security Name on file, so the question cannot be answered. */
  | "unverifiable";

/**
 * Classify from the Nasdaq Security Name alone.
 *
 * `null`/blank is `unverifiable`, NOT `issuer-equity`, and that inversion is
 * the whole point. The brief records the trap: a join that returns null for
 * suffixed preferreds makes a missing name read as "no name, so not a
 * preferred", and the test then passes through exactly the securities it
 * exists to catch -- fail-open, and indistinguishable from a working test
 * that found nothing.
 */
export function securityKindFromName(securityName: string | null | undefined): SecurityKind {
  if (securityName == null || String(securityName).trim() === "") return "unverifiable";
  const name = String(securityName);
  if (ADR_WORDING.test(name)) return "issuer-equity";
  if (DEBT_WORDING.test(name) || DEBT_ACRONYMS.test(name) || PREFERRED_WORDING.test(name) || WARRANT_WORDING.test(name)) {
    return "derivative-of-issuer";
  }
  return "issuer-equity";
}

export type ExtractionVerdict =
  | { admit: true }
  | { admit: false; reason: "derivative-of-issuer" | "unverifiable"; cik: string; siblings: string[] };

export type ExtractionInputs = {
  symbol: string;
  /** Every symbol resolving to the same CIK, this one included. */
  cikGroup: string[];
  securityName: string | null;
  cik: string | null;
};

/**
 * THE GUARD. Shared CIK is the trigger; the Security Name is the disposition.
 *
 * A SYMBOL THAT SHARES ITS CIK WITH NOTHING IS ALWAYS ADMITTED, whatever its
 * name says. A lone filer's statements are its own by construction, and a
 * name-only rule would refuse standalone note issuers and closed-end funds
 * that legitimately have nobody to be confused with.
 *
 * UNVERIFIABLE REFUSES ONLY ON A SHARED CIK, and the measurement is why that
 * is not over-broad: name coverage over the analysis universe is 100 of 100,
 * and 12 of 12 for its shared-CIK members. Every unverifiable symbol is
 * therefore OFF-universe, reachable only by a direct request through the cold
 * path -- which is the same door MER-PK comes through. Refusing an
 * off-universe page is cheap; rendering another company's financials is not.
 */
export function admitForExtraction(inputs: ExtractionInputs): ExtractionVerdict {
  const siblings = inputs.cikGroup.filter(
    (s) => s.toUpperCase() !== inputs.symbol.trim().toUpperCase()
  );
  if (!inputs.cik || siblings.length === 0) return { admit: true };

  const kind = securityKindFromName(inputs.securityName);
  if (kind === "issuer-equity") return { admit: true };
  return { admit: false, reason: kind, cik: inputs.cik, siblings };
}

/**
 * The words shown instead of a financial page. NOT a 404: these tickers
 * genuinely trade, and a 404 on a real security is its own wrong answer.
 */
export function refusalWords(v: Extract<ExtractionVerdict, { admit: false }>): string {
  if (v.reason === "derivative-of-issuer") {
    const parent = v.siblings[0];
    return (
      `This security is debt, preferred stock or a warrant issued by another company` +
      (parent ? `, filed under the same SEC registrant as ${parent}` : "") +
      `. Its financial statements are that company's, not this security's, so they are not shown here.`
    );
  }
  return (
    "This ticker shares an SEC registrant with other securities, and the security type " +
    "could not be established, so financial statements are not shown. They would be the " +
    "registrant's rather than this security's."
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// THE RENDER-PATH ENTRY POINT.
//
// NO NETWORK AND NO REDIS, deliberately, and for the reason secColdFetch's own
// CIK gate states: this runs on every cold render, and a gate that depends on
// an external fetch is a gate that opens when that fetch is slow. A gate that
// opens is this bug returning.
//
// Both inputs are already committed and already have synchronous loaders --
// loadTickerMap (validated on load, ~10,400 registrants) and
// snapshotCompanyName (2,610 names, keyed in the directory's own spelling with
// the dot/dash rewrite handled). Nothing new is fetched or stored.

/** CIK -> every symbol resolving to it. Built once from the committed map. */
let cikIndex: Map<string, string[]> | null = null;

function cikGroups(): Map<string, string[]> {
  if (cikIndex) return cikIndex;
  const built = new Map<string, string[]>();
  const { present, map } = loadTickerMap();
  if (present) {
    for (const [symbol, entry] of map) {
      const cik = entry?.cik;
      if (!cik) continue;
      const list = built.get(cik);
      if (list) list.push(symbol);
      else built.set(cik, [symbol]);
    }
  }
  // CACHED ONLY ONCE THE MAP WAS PRESENT. Caching an empty index built from a
  // missing file would make every later call admit everything -- fail-open,
  // permanently, from one unlucky first call.
  if (present) cikIndex = built;
  return built;
}

/** Test seam: drop the memoised index so a reload is observable. */
export function resetCikGroupsForTest(): void {
  cikIndex = null;
}

/**
 * The gate, for a symbol and nothing else.
 *
 * Returns `{ admit: true }` for every symbol that does not share its CIK, which
 * is the overwhelming majority, before any name lookup happens.
 */
export function admitSymbolForExtraction(symbol: string, cik: string | null): ExtractionVerdict {
  const clean = String(symbol ?? "").trim().toUpperCase();
  if (!cik) return { admit: true };
  const group = cikGroups().get(cik) ?? [];
  if (group.length < 2) return { admit: true };
  return admitForExtraction({
    symbol: clean,
    cik,
    cikGroup: group,
    securityName: snapshotCompanyName(clean) || null,
  });
}
