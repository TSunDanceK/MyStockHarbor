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

const PREFERRED_OR_WARRANT = /\bpreferred\b|\bdepositary shares\b|\bwarrants?\b/i;

/** True for an exchange-traded note or other debt listing, by its committed name. */
export function isDebtListing(symbol: string): boolean {
  const name = snapshotCompanyName(symbol);
  if (!name) return false;
  return securityKindFromName(name) === "derivative-of-issuer" && !PREFERRED_OR_WARRANT.test(name);
}
