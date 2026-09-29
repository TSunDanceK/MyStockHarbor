// Which pool symbols the Tiingo jobs fetch (#553 COWORK #60).
//
// DEBT IS NOT PRICED AS EQUITY. CCZ ("Comcast Holdings ZONES") and the other
// exchange-traded notes (TBB, MER-PK) sit in the price pool, but a note's
// price is not a stock chart: Cowork ruled them out of the Tiingo universe and
// of every price-based screen and signal.
//
// NOT A NEW CLASSIFIER: A's securityKindFromName (lib/server/securityKind.ts)
// already calls these "derivative-of-issuer", including CCZ by its debt-acronym
// rule. That verdict also covers preferreds and warrants, which DO trade as
// their own securities and keep a quote and a chart, so those two wordings are
// let back in here and only debt is dropped.
import { securityKindFromName } from "../securityKind";
import { snapshotCompanyName } from "../companyNameSnapshot";
import { planListingChanges, tickersByCik } from "../secListing";
import { lookupBySpelling } from "../../symbolSpellings.mjs";

const PREFERRED_OR_WARRANT = /\bpreferred\b|\bdepositary shares\b|\bwarrants?\b/i;

/** True for an exchange-traded note or other debt listing, by its committed name. */
export function isDebtListing(symbol: string): boolean {
  const name = snapshotCompanyName(symbol);
  if (!name) return false;
  return securityKindFromName(name) === "derivative-of-issuer" && !PREFERRED_OR_WARRANT.test(name);
}

/**
 * A RETICKERED SYMBOL IS NEVER SENT (#553 COWORK #70). BK and EQR sat in the
 * pool after SEC moved their CIKs to BNY and VMRK; Tiingo answered the dead
 * tickers with an empty series and 5 stale rows, and we blamed Tiingo.
 *
 * Pure. A symbol SEC's live map no longer lists is dropped when the CIK it was
 * last seen under now lists ANY other ticker (the rename sweep's own rule,
 * #593's planListingChanges: a rename, a deferred rename, an ambiguous or an
 * already-present successor). Nothing else is judged here: a symbol with no
 * CIK on record (ETFs, indices, funds SEC's company file never carries) or a
 * CIK SEC lists nothing for is left as it was -- the min-bars guard handles a
 * short answer. No live map (file missing or rejected): the guard is off and
 * says so, rather than dropping the whole universe.
 */
export function retickeredOut(
  symbols: string[],
  live: { present: boolean; map: Map<string, { cik: string }> },
  lastSeen: Map<string, string>
): { keep: string[]; dropped: { symbol: string; listed: string[] }[]; guard: "on" | "off (no ticker map)" } {
  if (!live.present) return { keep: symbols, dropped: [], guard: "off (no ticker map)" };
  const unlisted = symbols.filter((s) => !lookupBySpelling(live.map, s));
  const changes = planListingChanges(unlisted, {
    cikOf: (s) => lastSeen.get(s) ?? null,
    byCik: tickersByCik(live.map as Parameters<typeof tickersByCik>[0]),
    universe: symbols,
    max: Number.POSITIVE_INFINITY,
  });
  const dropped: { symbol: string; listed: string[] }[] = [];
  for (const c of changes) {
    if (c.kind === "rename") dropped.push({ symbol: c.from, listed: [c.to] });
    else if (c.kind === "deferred") dropped.push({ symbol: c.symbol, listed: [c.to] });
    else if (c.listed?.length) dropped.push({ symbol: c.symbol, listed: c.listed });
  }
  const out = new Set(dropped.map((d) => d.symbol));
  return { keep: symbols.filter((s) => !out.has(s)), dropped, guard: "on" };
}

/**
 * THE POOL CLEANUP'S APPLY, BY REVIEWED LIST ONLY (#553 COWORK #73).
 *
 * Pure. `unlisted` is every pool field SEC's ticker file does not list at run
 * time; `reviewed` is the list the owner OKed from the dry run. The apply
 * deletes exactly the reviewed symbols that are still unlisted, and REFUSES --
 * deleting nothing -- if anything outside the reviewed list is unlisted too
 * (an ETF SEC's company file omits, added to the pool after the review, must
 * never be deleted by a run that was OKed for eight dead tickers). A reviewed
 * symbol SEC lists again is simply not deleted.
 */
export function planPoolDeletion(
  unlisted: string[],
  reviewed: string[]
): { ok: true; delete: string[] } | { ok: false; unreviewed: string[] } {
  const ok = new Set(reviewed.map((s) => s.trim().toUpperCase()).filter(Boolean));
  const unreviewed = unlisted.filter((s) => !ok.has(s.toUpperCase()));
  if (unreviewed.length) return { ok: false, unreviewed };
  return { ok: true, delete: unlisted.filter((s) => ok.has(s.toUpperCase())) };
}
