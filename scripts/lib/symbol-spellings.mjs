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
// `classifyUnresolvedIsNotCommon` below.
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
 * THE RULE A CALLER MUST NOT GET WRONG, stated as code so it can be cited.
 *
 * An unresolved Security Name means the join failed, NOT that the security is
 * common stock. Returning "common" here is the fail-open path that makes the
 * whole exclusion test useless while reporting success.
 */
export function classifyUnresolvedIsNotCommon(securityName) {
  if (securityName == null || String(securityName).trim() === "") return "unknown";
  const name = String(securityName);
  if (/\bwarrant/i.test(name)) return "warrant";
  if (/\bunits?\b|tangible equity unit/i.test(name)) return "unit";
  if (/preferred|depositary shares/i.test(name)) return "preferred";
  if (/\bnotes? due\b|\bdebenture/i.test(name)) return "baby-bond";
  if (/common stock|capital stock|ordinary shares|common shares/i.test(name)) return "common";
  return "unknown";
}
