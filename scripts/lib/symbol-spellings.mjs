// Every spelling one ticker wears, in one place.
//
// THE PROBLEM, NOW SEEN THREE TIMES. The same security is spelled differently by
// every source this project joins against:
//
//   repo / universe      BRK.B     MER-PK    EP-PC     MKC-V
//   Nasdaq Trader        BRK.B?    BAC$K     T$A       ...$<series>
//   SEC ticker file      BRK-B     (absent -- preferreds resolve to the parent)
//
// Dot-versus-dash was handled by a local `alts()` in listing-split.mjs, copied
// into listing-venue-diff.mjs, and written a third time inline in
// sec-window-fixture.mjs. The DOLLAR form appears in none of them.
//
// WHY THAT IS DANGEROUS RATHER THAN MERELY UNTIDY. The preferred/baby-bond
// exclusion test joins the universe against nasdaqtraded.txt's Security Name to
// decide whether a symbol is a preferred. Nasdaq Trader spells suffixed
// preferreds with "$" (BAC$K) and the universe spells them with a dash
// (MER-PK), so a naive join returns NULL for exactly those rows -- and a null
// Security Name reads as "no name, so not a preferred".
//
// The test then PASSES THROUGH the securities it exists to catch, fails open,
// and is indistinguishable from a working test that found nothing. Callers must
// treat an unresolved name as UNKNOWN, never as "common stock" -- see
// `classifySecurityName` below.
//
// AND THE TWO SHAPES DIFFER, so a spot check misleads: suffixed preferreds
// (MER-PK, MKC-V, EP-PC) need the "$" form, while baby bonds carry plain
// alphabetic tickers (TBB, PFH, UNMA) and join correctly as-is. Checking TBB
// alone passes and says nothing about the suffixed half.

/**
 * Candidate spellings for one ticker, most-likely first, de-duplicated.
 *
 * Deliberately GENERATIVE rather than a lookup table: a table of known
 * preferreds is a September 2026 snapshot that returns a wrong answer silently
 * forever, which this repo has already refused twice.
 */
export function symbolSpellings(symbol) {
  const raw = String(symbol ?? "").trim().toUpperCase();
  if (!raw) return [];
  const out = [raw];
  const push = (s) => {
    if (s && s !== raw && !out.includes(s)) out.push(s);
  };

  // 1. Dot/dash, the pair the existing copies handled.
  push(raw.replace(/\./g, "-"));
  push(raw.replace(/-/g, "."));

  // 2. The DOLLAR forms. "-P<series>" is the universe's spelling for a preferred
  //    series (MER-PK = series K); Nasdaq Trader writes "$<series>". Emitted
  //    before the looser rule below so the more specific pattern is tried first.
  push(raw.replace(/-P([A-Z])$/, "$$$1"));

  // 3. The looser suffix rule, for share classes and non-P series that Nasdaq
  //    may also write with "$": MKC-V -> MKC$V, PBR-A -> PBR$A. Generated
  //    rather than assumed correct -- an extra candidate that matches nothing
  //    costs one map lookup, while a missing one fails open.
  push(raw.replace(/[.-]([A-Z])$/, "$$$1"));

  return out;
}

/** First hit across every spelling. Returns the value AND which spelling won. */
export function lookupBySpelling(map, symbol) {
  for (const spelling of symbolSpellings(symbol)) {
    if (map.has(spelling)) return { value: map.get(spelling), matched: spelling };
  }
  return null;
}

/**
 * KNOWN-GOOD MATCH, EVERYTHING ELSE NOT-COMMON. Inverted deliberately.
 *
 * The first version enumerated BAD words -- preferred, warrant, unit, notes.
 * Measured against the real file, "Preferred" appears in ONE of six
 * non-common securities:
 *
 *   EP$C   El Paso Corporation Preferred Stock                        <- the only one
 *   MER$K  Bank of America ... Income Capital Obligation Notes due 2066
 *   TBB    AT&T Inc. 5.350% Global Notes due 2066
 *   PFH    Prudential Financial 4.125% Junior Subordinated Notes due 2060
 *   UNMA   Unum Group 6.250% Junior Subordinated Notes due 2058
 *   EMBJ   Embraer S.A. Common Stock                                   <- actually common
 *
 * A positive list of bad words catches one in six and requires enumerating
 * every way a note can be named -- "Income Capital Obligation Notes" being the
 * one nobody would have guessed. Matching a known-good pattern instead needs no
 * such enumeration: the set of names a COMMON share carries is small and stable.
 *
 * THREE STATES, NOT TWO. "unknown" (the join failed) is kept distinct from
 * "not-common" (the join succeeded and it is a note) because they mean different
 * things in a report, even though both exclude. Returning "common" for either is
 * the fail-open path that makes the whole exclusion test useless.
 */
const COMMON_EQUITY_NAME = [
  /\bcommon stock\b/i,
  /\bcommon shares?\b/i,
  /\bordinary shares?\b/i,
  // "Class C Capital Stock" (GOOG), "Class A Common Stock" (BRK.A). The
  // qualifier is REQUIRED: a bare /Stock/ would accept "Preferred Stock", and
  // a bare /Class .* Stock/ would accept a hypothetical "Class A Preferred
  // Stock".
  /\bclass\s+[A-Z0-9]+\s+(?:common|capital|ordinary)\s+(?:stock|shares?)\b/i,
];

export function classifySecurityName(securityName) {
  if (securityName == null || String(securityName).trim() === "") return "unknown";
  const name = String(securityName);
  return COMMON_EQUITY_NAME.some((re) => re.test(name)) ? "common" : "not-common";
}

/**
 * A finer label for REPORTING only -- never for the include/exclude decision,
 * which is classifySecurityName's. Anything it cannot name is "other", not
 * "common": the same inversion, so a security type nobody enumerated does not
 * silently become an included symbol.
 */
export function describeSecurityName(securityName) {
  if (classifySecurityName(securityName) === "unknown") return "unknown";
  const name = String(securityName);
  if (classifySecurityName(name) === "common") return "common";
  if (/\bwarrants?\b/i.test(name)) return "warrant";
  if (/\bunits?\b/i.test(name)) return "unit";
  if (/\bnotes?\b|\bdebentures?\b/i.test(name)) return "note";
  if (/\bpreferred\b|\bdepositary shares\b/i.test(name)) return "preferred";
  return "other";
}
