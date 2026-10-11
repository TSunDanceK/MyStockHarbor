// A LISTING NAME WITHOUT ITS SECURITY-CLASS SUFFIX (#552 COWORK #23).
//
// The exchange directory names a security, not a company: "Cintas Corporation
// - Common Stock", "Alphabet Inc. - Class A Common Stock", "Unilever PLC -
// American Depositary Shares". A reader wants the company, so the part after
// the last " - " is dropped when, and only when, it describes a security
// class. A name whose own text carries a dash ("Coca-Cola Consolidated") keeps
// it, and a suffix that is not a class (a place, a brand) is left alone.
// PURE: no I/O.
// Words that make a " - …" suffix a description of the SECURITY. Measured on
// the committed directory snapshot (data/company-names.json): "Common Stock"
// 711, "Class A Common Stock" 117, "Ordinary Shares" 51, "American Depositary
// Shares" 41, and a long tail of units, notes, ADSs and preferreds.
const SECURITY_WORDS =
  /\b(?:stock|shares?|units?|warrants?|rights|adss?|notes|preferred|depositary|depository|registry|closed end fund|interests?)\b/i;
const CLASS_ONLY = /^(?:class|series)\s+[a-z0-9]+$/i;

/**
 * THE SAME SUFFIX WITH NO DASH (#552 COWORK #174): the committed directory
 * snapshot writes most names as "Nike, Inc. Common Stock", "Accenture plc
 * Class A Ordinary Shares (Ireland)", "Banco De Chile ADS" — 1,403 of its
 * 2,610 rows. Anchored on a phrase that can only describe a security (a class
 * of common equity, a depositary share, a unit), from that phrase to the end.
 * Preferred stock, notes and debentures are left alone: they are not a
 * company's common listing, and their name says so.
 */
const NO_DASH_SECURITY =
  /(?<!Preferred)\s+(?:New\s+)?(?:(?:Sponsored|Sponosred|Global|NY|Corporate)\s+)?(?:(?:Class|Series)\s+[A-Z0-9]+\s+)?(?:New York Registry Shares|Registry Shares|(?:Exchangeable\s+)?Limited Voting Shares|Subordinate Voting Shares|Shares of Beneficial Interest|Common Stock|Common Shares|Common [Uu]nits?|Ordinary Shares?|Ordinary share|American Depositary (?:Shares?|Receipts?)|Depositary Shares|ADRs?|ADSs?|Limited Partnership Units|Units|Class [A-Z] [Ss]hares)\b.*$/;

export function cleanListingName(name: string): string {
  const s = String(name ?? "").trim();
  const at = s.lastIndexOf(" - ");
  if (at > 0) {
    const suffix = s.slice(at + 3).trim();
    return SECURITY_WORDS.test(suffix) || CLASS_ONLY.test(suffix) ? s.slice(0, at).trim() : s;
  }
  const bare = s.replace(NO_DASH_SECURITY, "").trim();
  return bare || s;
}
