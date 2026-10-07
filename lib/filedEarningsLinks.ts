// WHICH SYMBOLS GET AN "EARNINGS" LINK (#552 COWORK #197). Pure, client-safe.
//
// The rule: link /stock/SYM/earnings only when SYM has a stored SEC fact set
// with at least one filed period. Otherwise the link is left out -- not shown
// disabled. A fund never has one (companyfacts has nothing for an ETF), so a
// listed fund is false whatever the list says.
//
// The list itself is built server-side (lib/server/filedEarnings.ts, one cached
// read of the fact-set index) and reaches a client component through
// useFiledEarnings (app/components/useFiledEarnings.ts). Both end in
// hasFiledEarningsIn below, so a server page and a client row decide alike.
// scripts/check-earnings-link-gate.mjs fails on any earnings href that is not
// gated by a hasFiledEarnings call.
import { uniqueEtfs } from "./curatedSymbols";
import { toDashed, toDotted } from "./symbolSpellings.mjs";

const FUNDS = new Set<string>(uniqueEtfs);

/** BRK.B and BRK-B are one company: a set is keyed by whichever spelling wrote it. */
export function filedSpellings(symbol: string): string[] {
  const raw = String(symbol ?? "").trim().toUpperCase();
  return [...new Set([raw, toDashed(raw), toDotted(raw)])];
}

/** One of the funds the site lists (the same list as secColdFetch.isSiteFund). */
export function isListedFund(symbol: string): boolean {
  return FUNDS.has(String(symbol ?? "").trim().toUpperCase());
}

/**
 * THE PREDICATE. `filed` is the set of symbols with a filed fact set, or null
 * when it is not known (still loading, or the read failed). Unknown is false:
 * the rule is "only when", so a link waits for the list rather than guessing.
 */
export function hasFiledEarningsIn(filed: ReadonlySet<string> | null, symbol: string | null | undefined): boolean {
  if (!filed || !symbol) return false;
  if (isListedFund(symbol)) return false;
  return filedSpellings(symbol).some((s) => filed.has(s));
}

/**
 * The filed list from the two stored sets: every indexed fact set less the
 * ones stored with no filed period (the empty answer -- 26 of 1,732 on
 * 2026-10-07, SKHY among them). Funds are dropped here too.
 */
export function filedFromIndex(indexed: Iterable<string>, empty: Iterable<string>): string[] {
  const none = new Set<string>();
  for (const s of empty) none.add(String(s).toUpperCase());
  const out = new Set<string>();
  for (const s of indexed) {
    const sym = String(s).toUpperCase();
    if (!sym || none.has(sym) || isListedFund(sym)) continue;
    out.add(sym);
  }
  return [...out].sort();
}
